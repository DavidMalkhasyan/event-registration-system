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
import { manageableOrganizationIds, organizationForNewEvent } from '../organizations/access.js';
import {
  LOCATION_COLUMNS,
  locationColumns,
  locationSchema,
  locationView,
  type LocationRow,
} from './location.js';
import { imagesOf, publicImages } from '../media/images.js';

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
    organizationId: z.uuid().optional(),
    /** K-711: optional venue. */
    location: locationSchema.nullable().optional(),
  })
  .strict();
export type EventCreateInput = z.infer<typeof eventCreateSchema>;

interface EventRow extends LocationRow {
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
  ...LOCATION_COLUMNS,
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
    location: locationView(row),
    locationVersion: row.location_version,
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
    ...(input.location ? { location: input.location } : {}),
  };
  const fingerprint = sha256(canonicalJson(normalized));

  return withTransaction(ctx.db, async ({ trx, now }) => {
    if (resolved.instant <= now) throw new AppError(422, 'start_not_in_future');
    // K-708: the event belongs to an active organization of which the creator is a member.
    const organizationId = await organizationForNewEvent(trx, principal.accountId, input.organizationId);
    const inserted = await trx
      .insertInto('app.events')
      .values({
        owner_account_id: principal.accountId,
        organization_id: organizationId,
        creation_request_id: input.requestId,
        creation_fingerprint: fingerprint,
        public_id: publicId(),
        title: normalized.title,
        description: normalized.description,
        starts_at: resolved.instant,
        time_zone: input.timeZone,
        capacity: input.capacity,
        ...locationColumns(input.location ?? null),
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
    .where('organization_id', 'in', manageableOrganizationIds(ctx.db, principal.accountId))
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
  const images = await imagesOf(ctx.db, ids);
  return {
    items: rows.map((r) => ({
      ...eventView(ctx, r, now),
      coverThumbnailUrl: images.get(r.id)!.find((i) => i.role === 'cover')?.thumbnailUrl ?? null,
      waitlistedCount: counts.get(r.id)!.waitlisted,
      checkedInCount: counts.get(r.id)!.checkedIn,
    })),
    nextCursor: null,
  };
}

/** Another organization's event and an unknown event look the same: 404 (AC-155, K-708). */
export async function getOwnedEvent(ctx: AppContext, principal: OrganizerPrincipal, eventId: string) {
  if (!z.uuid().safeParse(eventId).success) throw new AppError(404, 'not_found');
  const row = await ctx.db
    .selectFrom('app.events')
    .select(EVENT_COLUMNS)
    .where('id', '=', eventId)
    .where('organization_id', 'in', manageableOrganizationIds(ctx.db, principal.accountId))
    .executeTakeFirst();
  if (!row) throw new AppError(404, 'not_found');
  const images = (await imagesOf(ctx.db, [row.id])).get(row.id)!;
  return {
    ...eventView(ctx, row, await decisionTime(ctx.db)),
    cover: images.find((i) => i.role === 'cover') ?? null, // K-713: the workspace header
  };
}

/**
 * Public availability (PD-81): aggregate counts only, never identities. The counts describe committed
 * state; the seat or waiting-list place is still decided by TX-R02 when the visitor confirms their email
 * (FR-REG-2), so the free-seat figure is an estimate. Outside the open phase no counts are published.
 */
export type RegistrationMode = 'seats_available' | 'waiting_list' | 'closed';

export interface PublicAvailability {
  registrationMode: RegistrationMode;
  capacity: number | null;
  confirmedCount: number | null;
  waitlistedCount: number | null;
  estimatedAvailableSeats: number | null;
}

export async function getPublicEvent(ctx: AppContext, id: string) {
  // One statement, so the counts come from one snapshot; registrations_ix07 serves the waiting-list count.
  const row = await ctx.db
    .selectFrom('app.events as e')
    .select((eb) => [
      'e.id',
      'e.title',
      'e.description',
      'e.starts_at',
      'e.time_zone',
      'e.status',
      'e.capacity',
      'e.confirmed_count',
      ...LOCATION_COLUMNS.map((c) => `e.${c}` as const),
      eb
        .selectFrom('app.registrations as r')
        .select((r) => r.fn.countAll<number>().as('n'))
        .whereRef('r.event_id', '=', 'e.id')
        .where('r.state', '=', 'WAITLISTED')
        .as('waitlisted_count'),
    ])
    .where('e.public_id', '=', id)
    .executeTakeFirst();
  if (!row) throw new AppError(404, 'not_found');
  const now = await decisionTime(ctx.db);
  const phase = eventPhase(row.status, row.starts_at, now);
  const free = Math.max(0, row.capacity - row.confirmed_count);
  // The same rule TX-R02 applies: a seat while confirmed < capacity, otherwise the waiting list.
  const availability: PublicAvailability =
    phase === 'registration_open'
      ? {
          registrationMode: free > 0 ? 'seats_available' : 'waiting_list',
          capacity: row.capacity,
          confirmedCount: row.confirmed_count,
          waitlistedCount: Number(row.waitlisted_count ?? 0),
          estimatedAvailableSeats: free,
        }
      : {
          registrationMode: 'closed',
          capacity: null,
          confirmedCount: null,
          waitlistedCount: null,
          estimatedAvailableSeats: null,
        };
  return {
    title: row.title,
    description: row.description,
    startsAt: row.starts_at.toISOString(),
    timeZone: row.time_zone,
    location: locationView(row),
    images: publicImages((await imagesOf(ctx.db, [row.id])).get(row.id)!),
    phase,
    availability,
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

/** Largest page of the participant list (K-723); the client follows `nextCursor` to the end. */
export const PARTICIPANT_PAGE_MAX = 1000;

export const participantPageSchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PARTICIPANT_PAGE_MAX).optional(),
});

// The keyset cursor: the last row's creation time (as PostgreSQL text, keeping microseconds) and id.
function encodeParticipantCursor(createdKey: string, id: string): string {
  return Buffer.from(JSON.stringify([createdKey, id])).toString('base64url');
}

function decodeParticipantCursor(cursor: string): { createdKey: string; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    const parsed = z.tuple([z.string().max(64), z.uuid()]).parse(value);
    if (Number.isNaN(Date.parse(parsed[0]))) throw new Error('not a time');
    return { createdKey: parsed[0], id: parsed[1] };
  } catch {
    throw new AppError(422, 'validation_failed', { errors: [{ field: 'cursor', code: 'invalid_cursor' }] });
  }
}

/**
 * Owner-only participant list (FR-DSH-4), in pages ordered by registration time (K-723: an event may
 * have up to 100,000 registrations; before, the list stopped silently at 1,000). Waiting-list positions
 * are counted over the whole event, not the page.
 */
export async function listParticipants(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  page: z.infer<typeof participantPageSchema> = {},
) {
  await getOwnedEvent(ctx, principal, eventId);
  const limit = page.limit ?? PARTICIPANT_PAGE_MAX;
  const after = page.cursor ? decodeParticipantCursor(page.cursor) : null;
  const rows = await sql<{
    id: string;
    email: string;
    state: string;
    end_reason: string | null;
    waitlist_seq: number | null;
    created_key: string;
    position: number | null;
    checked_in_at: Date | null;
    check_in_id: string | null;
  }>`
    SELECT * FROM (
      SELECT r.id, r.email, r.state, r.end_reason, r.waitlist_seq, r.created_at, r.created_at::text AS created_key,
        -- K-723: the waiting-list position in one pass (a per-row count was quadratic in the list's length).
        CASE WHEN r.state = 'WAITLISTED' THEN
          (count(*) FILTER (WHERE r.state = 'WAITLISTED')
            OVER (ORDER BY r.waitlist_seq NULLS LAST ROWS UNBOUNDED PRECEDING))::int END AS position,
        c.checked_in_at, c.id AS check_in_id
      FROM app.registrations r
      LEFT JOIN app.tickets t ON t.registration_id = r.id
      LEFT JOIN app.check_ins c ON c.ticket_id = t.id AND c.undone_at IS NULL
      WHERE r.event_id = ${eventId}
    ) participants
    ${after ? sql`WHERE (created_at, id) > (${after.createdKey}::timestamptz, ${after.id}::uuid)` : sql``}
    ORDER BY created_at, id
    LIMIT ${limit + 1}`.execute(ctx.db);
  const pageRows = rows.rows.slice(0, limit);
  const last = pageRows.at(-1);
  const ids = pageRows.map((r) => r.id);
  const issues = ids.length
    ? await ctx.db
        .selectFrom('app.outbox_messages')
        .select(['registration_id', 'message_type', 'status', 'settled_at', 'last_error_code'])
        .where('event_id', '=', eventId)
        .where('registration_id', 'in', ids)
        .where('status', 'in', ['FAILED', 'UNCONFIRMED'])
        .execute()
    : [];
  // K-402: provider evidence after acceptance (bounced, complained), from the generations' facts.
  const evidence = ids.length
    ? await ctx.db
        .selectFrom('app.outbox_messages as m')
        .innerJoin('app.outbox_generations as g', 'g.outbox_id', 'm.id')
        .select([
          'm.registration_id',
          'm.message_type',
          'g.bounced_at',
          'g.complained_at',
          'g.failure_reason',
        ])
        .where('m.event_id', '=', eventId)
        .where('m.registration_id', 'in', ids)
        .where((eb) => eb.or([eb('g.bounced_at', 'is not', null), eb('g.complained_at', 'is not', null)]))
        .execute()
    : [];
  return {
    items: pageRows.map((r) => ({
      registrationId: r.id,
      email: r.email,
      state: r.state,
      // Why an ended registration ended (K-703): kept in the list, so cancelled people stay visible.
      ...(r.end_reason ? { endReason: r.end_reason } : {}),
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
        }))
        .concat(
          evidence
            .filter((e) => e.registration_id === r.id)
            .map((e) => ({
              messageType: e.message_type,
              sendState: 'ACCEPTED',
              label: e.bounced_at ? 'bounced' : 'complained',
              ...(e.failure_reason ? { reason: e.failure_reason } : {}),
              at: (e.bounced_at ?? e.complained_at)!.toISOString(),
              anomaly: false,
            })),
        ),
    })),
    nextCursor: rows.rows.length > limit && last ? encodeParticipantCursor(last.created_key, last.id) : null,
  };
}
