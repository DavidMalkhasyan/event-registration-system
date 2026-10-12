import { sql } from 'kysely';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { canonicalJson, publicId, sha256 } from '../../platform/crypto.js';
import { AppError } from '../../platform/errors.js';
import { decisionTime, withTransaction } from '../../platform/tx.js';
import {
  checkInWindow,
  cutoffOf,
  eventPhase,
  isValidTimeZone,
  resolveLocalStart,
} from '../../platform/time.js';
import type { OrganizerPrincipal } from '../identity/sessions.js';
import { scheduleCutoffTask, scheduleReminderTask } from './lifecycle.js';

export const eventCreateSchema = z
  .object({
    requestId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    localStart: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    timeZone: z.string().min(1).max(64),
    utcOffset: z
      .string()
      .regex(/^[+-]\d{2}:\d{2}$/)
      .optional(),
    capacity: z.number().int().min(1).max(100_000),
  })
  .strict();
export type EventCreateInput = z.infer<typeof eventCreateSchema>;

interface EventRow {
  id: string;
  public_id: string;
  title: string;
  description: string | null;
  starts_at: Date;
  time_zone: string;
  capacity: number;
  confirmed_count: number;
  status: 'SCHEDULED' | 'CANCELLED';
  schedule_version: number;
  created_at: Date;
  cancelled_at: Date | null;
}

const EVENT_COLUMNS = [
  'id',
  'public_id',
  'title',
  'description',
  'starts_at',
  'time_zone',
  'capacity',
  'confirmed_count',
  'status',
  'schedule_version',
  'created_at',
  'cancelled_at',
] as const;

export function eventView(ctx: AppContext, row: EventRow, now: Date) {
  const window = checkInWindow(row.starts_at);
  return {
    id: row.id,
    publicId: row.public_id,
    publicUrl: `${ctx.config.PUBLIC_ORIGIN}/e/${row.public_id}`,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    timeZone: row.time_zone,
    capacity: row.capacity,
    confirmedCount: row.confirmed_count,
    status: row.status,
    phase: eventPhase(row.status, row.starts_at, now),
    scheduleVersion: row.schedule_version,
    cutoffAt: cutoffOf(row.starts_at).toISOString(),
    checkInOpensAt: window.opens.toISOString(),
    checkInClosesAt: window.closes.toISOString(),
    createdAt: row.created_at.toISOString(),
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
  };
}

/** TX-E01 (D-17): idempotent per organizer and client request ID, with a normalized fingerprint. */
export async function createEvent(ctx: AppContext, principal: OrganizerPrincipal, input: EventCreateInput) {
  if (!isValidTimeZone(input.timeZone)) {
    throw new AppError(422, 'validation_failed', {
      errors: [{ field: 'timeZone', code: 'invalid_time_zone' }],
    });
  }
  const resolved = resolveLocalStart(input.localStart, input.timeZone, input.utcOffset);
  if (resolved.kind === 'nonexistent') throw new AppError(422, 'nonexistent_local_time');
  if (resolved.kind === 'ambiguous')
    throw new AppError(422, 'ambiguous_local_time', { offsets: resolved.offsets });

  const normalized = {
    title: input.title,
    description: input.description ?? null,
    localStart: input.localStart,
    timeZone: input.timeZone,
    utcOffset: input.utcOffset ?? null,
    capacity: input.capacity,
  };
  const fingerprint = sha256(canonicalJson(normalized));

  return withTransaction(ctx.db, async ({ trx, now }) => {
    if (resolved.instant <= now) throw new AppError(422, 'start_not_in_future');
    const inserted = await trx
      .insertInto('app.events')
      .values({
        owner_account_id: principal.accountId,
        creation_request_id: input.requestId,
        creation_fingerprint: fingerprint,
        public_id: publicId(),
        title: normalized.title,
        description: normalized.description,
        starts_at: resolved.instant,
        time_zone: input.timeZone,
        capacity: input.capacity,
        created_at: now,
        updated_at: now,
      })
      .onConflict((oc) => oc.columns(['owner_account_id', 'creation_request_id']).doNothing())
      .returning(EVENT_COLUMNS)
      .executeTakeFirst();
    if (inserted) {
      // Only the first, inserting request creates tasks, so identical retries create none (AC-185).
      await scheduleReminderTask(trx, inserted.id, 1, inserted.starts_at, now);
      await scheduleCutoffTask(trx, inserted.id, 1, inserted.starts_at, now);
      return { created: true, event: eventView(ctx, inserted, now), now };
    }

    const existing = await trx
      .selectFrom('app.events')
      .select([...EVENT_COLUMNS, 'creation_fingerprint'])
      .where('owner_account_id', '=', principal.accountId)
      .where('creation_request_id', '=', input.requestId)
      .executeTakeFirstOrThrow();
    if (!existing.creation_fingerprint.equals(fingerprint)) throw new AppError(409, 'request_id_reused');
    return { created: false, event: eventView(ctx, existing, now), now };
  });
}

export async function listEvents(ctx: AppContext, principal: OrganizerPrincipal) {
  const now = await decisionTime(ctx.db);
  const rows = await ctx.db
    .selectFrom('app.events')
    .select(EVENT_COLUMNS)
    .where('owner_account_id', '=', principal.accountId)
    .orderBy('starts_at', 'desc')
    .limit(200)
    .execute();
  // Per-event waiting and checked-in counts for the global dashboard (PD-67), from current state only.
  const ids = rows.map((r) => r.id);
  const counts = new Map<string, { waitlisted: number; checkedIn: number }>(
    ids.map((id) => [id, { waitlisted: 0, checkedIn: 0 }]),
  );
  if (ids.length > 0) {
    const waiting = await sql<{ event_id: string; n: number }>`
      SELECT event_id, count(*)::int AS n FROM app.registrations
      WHERE event_id = ANY(${ids}::uuid[]) AND state = 'WAITLISTED' GROUP BY event_id`.execute(ctx.db);
    const checked = await sql<{ event_id: string; n: number }>`
      SELECT event_id, count(*)::int AS n FROM app.check_ins
      WHERE event_id = ANY(${ids}::uuid[]) AND undone_at IS NULL GROUP BY event_id`.execute(ctx.db);
    for (const r of waiting.rows) counts.get(r.event_id)!.waitlisted = r.n;
    for (const r of checked.rows) counts.get(r.event_id)!.checkedIn = r.n;
  }
  return {
    items: rows.map((r) => ({
      ...eventView(ctx, r, now),
      waitlistedCount: counts.get(r.id)!.waitlisted,
      checkedInCount: counts.get(r.id)!.checkedIn,
    })),
    nextCursor: null,
  };
}

/** Another owner's event and an unknown event look the same: 404 (AC-155). */
export async function getOwnedEvent(ctx: AppContext, principal: OrganizerPrincipal, eventId: string) {
  if (!z.uuid().safeParse(eventId).success) throw new AppError(404, 'not_found');
  const row = await ctx.db
    .selectFrom('app.events')
    .select(EVENT_COLUMNS)
    .where('id', '=', eventId)
    .where('owner_account_id', '=', principal.accountId)
    .executeTakeFirst();
  if (!row) throw new AppError(404, 'not_found');
  return eventView(ctx, row, await decisionTime(ctx.db));
}

export async function getPublicEvent(ctx: AppContext, id: string) {
  const row = await ctx.db
    .selectFrom('app.events')
    .select(['title', 'description', 'starts_at', 'time_zone', 'status'])
    .where('public_id', '=', id)
    .executeTakeFirst();
  if (!row) throw new AppError(404, 'not_found');
  const now = await decisionTime(ctx.db);
  return {
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    timeZone: row.time_zone,
    phase: eventPhase(row.status, row.starts_at, now),
  };
}

/** Dashboard counts from committed state (FR-DSH-1, FR-DSH-3). */
export async function dashboard(ctx: AppContext, principal: OrganizerPrincipal, eventId: string) {
  const event = await getOwnedEvent(ctx, principal, eventId);
  const counts = await sql<{ waitlisted: number; checked_in: number }>`
    SELECT
      (SELECT count(*) FROM app.registrations WHERE event_id = ${eventId} AND state = 'WAITLISTED')::int AS waitlisted,
      (SELECT count(*) FROM app.check_ins WHERE event_id = ${eventId} AND undone_at IS NULL)::int AS checked_in`.execute(
    ctx.db,
  );
  const failures = await ctx.db
    .selectFrom('app.outbox_messages')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('event_id', '=', eventId)
    .where('status', 'in', ['FAILED', 'UNCONFIRMED'])
    .executeTakeFirstOrThrow();
  return {
    phase: event.phase,
    counts: {
      confirmed: event.confirmedCount,
      waitlisted: counts.rows[0]?.waitlisted ?? 0,
      checkedIn: counts.rows[0]?.checked_in ?? 0,
    },
    emailIssueCount: Number(failures.n),
  };
}

/** Owner-only participant list (FR-DSH-4). Delivery labels cover our send states only until webhooks exist. */
export async function listParticipants(ctx: AppContext, principal: OrganizerPrincipal, eventId: string) {
  await getOwnedEvent(ctx, principal, eventId);
  const rows = await sql<{
    id: string;
    email: string;
    state: string;
    waitlist_seq: number | null;
    position: number | null;
    checked_in_at: Date | null;
    check_in_id: string | null;
  }>`
    SELECT r.id, r.email, r.state, r.waitlist_seq,
      CASE WHEN r.state = 'WAITLISTED' THEN
        (SELECT count(*) FROM app.registrations w
          WHERE w.event_id = r.event_id AND w.state = 'WAITLISTED' AND w.waitlist_seq <= r.waitlist_seq)::int END AS position,
      c.checked_in_at, c.id AS check_in_id
    FROM app.registrations r
    LEFT JOIN app.tickets t ON t.registration_id = r.id
    LEFT JOIN app.check_ins c ON c.ticket_id = t.id AND c.undone_at IS NULL
    WHERE r.event_id = ${eventId}
    ORDER BY r.created_at
    LIMIT 1000`.execute(ctx.db);
  const issues = await ctx.db
    .selectFrom('app.outbox_messages')
    .select(['registration_id', 'message_type', 'status', 'settled_at', 'last_error_code'])
    .where('event_id', '=', eventId)
    .where('status', 'in', ['FAILED', 'UNCONFIRMED'])
    .execute();
  return {
    items: rows.rows.map((r) => ({
      registrationId: r.id,
      email: r.email,
      state: r.state,
      ...(r.position ? { position: r.position } : {}),
      ...(r.checked_in_at ? { checkedInAt: r.checked_in_at.toISOString(), checkInId: r.check_in_id } : {}),
      emailIssues: issues
        .filter((i) => i.registration_id === r.id)
        .map((i) => ({
          messageType: i.message_type,
          sendState: i.status,
          label: i.status === 'FAILED' ? 'failed' : 'delivery_outcome_unknown',
          ...(i.last_error_code ? { reason: i.last_error_code } : {}),
          at: (i.settled_at ?? new Date()).toISOString(),
          anomaly: false,
        })),
    })),
    nextCursor: null,
  };
}
