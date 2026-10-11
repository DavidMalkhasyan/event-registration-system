import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { ticketCode } from '../../platform/crypto.js';
import { AppError, InvalidLinkError } from '../../platform/errors.js';
import { checkInWindow, cutoffOf, resolveLocalStart } from '../../platform/time.js';
import { decisionTime, withEventLock, type LockedEvent, type Tx } from '../../platform/tx.js';
import { findToken, type TokenRow } from '../access-tokens/tokens.js';
import { recordAudit } from '../audit/audit.js';
import { sessionStillValid, type OrganizerPrincipal } from '../identity/sessions.js';
import { enqueue, type MessageType } from '../messaging/outbox.js';

const DAY_MS = 24 * 3_600_000;
export const TRANSFER_STATEMENT = 'This ticket can be transferred, but it admits one person, once.';

// ---------------------------------------------------------------- reminders (FR-NTF-1 to FR-NTF-3)

/** One reminder fan-out task per schedule version, due at Start − 24 h (U-26 makes it idempotent). */
export async function scheduleReminderTask(
  trx: Tx,
  eventId: string,
  version: number,
  startsAt: Date,
  now: Date,
): Promise<void> {
  await trx
    .insertInto('app.scheduled_tasks')
    .values({
      kind: 'reminder_fanout',
      event_id: eventId,
      schedule_version: version,
      due_at: new Date(startsAt.getTime() - DAY_MS),
      params: '{}',
      created_at: now,
    })
    .onConflict((oc) => oc.columns(['kind', 'event_id', 'schedule_version']).doNothing())
    .execute();
}

/**
 * One cutoff task per schedule version, due at the cutoff (F8, TX-J03; U-26 makes it idempotent).
 * `waitlistClosedByChange`: the version's change email already told waiting participants that
 * registration is closed (FR-NTF-4), so the task sends no separate "waiting list closed" email.
 */
export async function scheduleCutoffTask(
  trx: Tx,
  eventId: string,
  version: number,
  startsAt: Date,
  now: Date,
  waitlistClosedByChange = false,
): Promise<void> {
  await trx
    .insertInto('app.scheduled_tasks')
    .values({
      kind: 'cutoff_processing',
      event_id: eventId,
      schedule_version: version,
      due_at: cutoffOf(startsAt),
      params: JSON.stringify(waitlistClosedByChange ? { waitlist_closed_by_change: true } : {}),
      created_at: now,
    })
    .onConflict((oc) => oc.columns(['kind', 'event_id', 'schedule_version']).doNothing())
    .execute();
}

/**
 * Enqueues a message for one registration. If it must occupy the reminder slot (decision time
 * ≥ Start − 24 h, FR-NTF-2 a), the slot is claimed by uniqueness in the same transaction (FR-NTF-2a).
 */
export async function enqueueWithSlotRule(
  trx: Tx,
  input: {
    type: Extract<MessageType, 'ticket_confirmation' | 'promotion' | 'event_change'>;
    filledBy: 'ticket' | 'promotion' | 'event_change';
    logicalKey: string;
    event: { id: string; starts_at: Date; schedule_version: number };
    registrationId: string;
    email: string;
    now: Date;
    occupiesSlot: boolean;
    payload?: Record<string, unknown>;
    correlationId: string;
  },
): Promise<void> {
  const id = randomUUID();
  if (input.occupiesSlot) {
    await trx
      .insertInto('app.reminder_slots')
      .values({
        registration_id: input.registrationId,
        schedule_version: input.event.schedule_version,
        event_id: input.event.id,
        outbox_message_id: id,
        filled_by: input.filledBy,
        created_at: input.now,
      })
      .onConflict((oc) => oc.columns(['registration_id', 'schedule_version']).doNothing())
      .execute();
  }
  await enqueue(trx, {
    id,
    type: input.type,
    logicalKey: input.logicalKey,
    recipientEmail: input.email,
    now: input.now,
    eventId: input.event.id,
    registrationId: input.registrationId,
    scheduleVersion: input.event.schedule_version,
    ...(input.payload ? { payload: input.payload } : {}),
    correlationId: input.correlationId,
  });
}

export function withinReminderWindow(startsAt: Date, now: Date): boolean {
  return now.getTime() >= startsAt.getTime() - DAY_MS;
}

// ---------------------------------------------------------------- promotion (FR-WL-2, BR-4 to BR-6)

export async function insertTicket(
  trx: Tx,
  registrationId: string,
  eventId: string,
  now: Date,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inserted = await trx
      .insertInto('app.tickets')
      .values({ registration_id: registrationId, event_id: eventId, code: ticketCode(), issued_at: now })
      .onConflict((oc) => oc.column('code').doNothing())
      .returning('code')
      .executeTakeFirst();
    if (inserted) return inserted.code;
  }
  throw new Error('could not allocate a unique ticket code');
}

/** Fills free seats FIFO from the waiting list, only before the cutoff. Must run under the exclusive event lock. */
export async function promoteFifo(
  trx: Tx,
  eventId: string,
  now: Date,
  correlationId: string,
): Promise<string[]> {
  const event = await trx
    .selectFrom('app.events')
    .select(['id', 'status', 'starts_at', 'capacity', 'confirmed_count', 'schedule_version'])
    .where('id', '=', eventId)
    .executeTakeFirstOrThrow();
  const free = event.capacity - event.confirmed_count;
  if (free <= 0 || event.status !== 'SCHEDULED' || now >= cutoffOf(event.starts_at)) return [];
  const heads = await trx
    .selectFrom('app.registrations')
    .select(['id', 'email'])
    .where('event_id', '=', eventId)
    .where('state', '=', 'WAITLISTED')
    .orderBy('waitlist_seq')
    .limit(free)
    .execute();
  const promoted: string[] = [];
  for (const head of heads) {
    await trx
      .updateTable('app.registrations')
      .set({ state: 'CONFIRMED', confirmed_at: now, updated_at: now })
      .where('id', '=', head.id)
      .where('state', '=', 'WAITLISTED')
      .execute();
    await insertTicket(trx, head.id, eventId, now);
    await enqueueWithSlotRule(trx, {
      type: 'promotion',
      filledBy: 'promotion',
      logicalKey: `promotion:${head.id}`,
      event,
      registrationId: head.id,
      email: head.email,
      now,
      occupiesSlot: withinReminderWindow(event.starts_at, now),
      correlationId,
    });
    promoted.push(head.id);
  }
  return promoted;
}

// ---------------------------------------------------------------- management link (FR-SELF-1 to FR-SELF-3)

interface ManagedRegistration {
  token: TokenRow;
  registration: { id: string; email: string; state: string; waitlist_seq: number | null; event_id: string };
}

async function managedRegistration(
  db: AppContext['db'] | Tx,
  raw: string,
): Promise<ManagedRegistration | null> {
  const token = await findToken(db, 'management', raw);
  if (!token?.registration_id || token.revoked_at) return null;
  const registration = await db
    .selectFrom('app.registrations')
    .select(['id', 'email', 'state', 'waitlist_seq', 'event_id'])
    .where('id', '=', token.registration_id)
    .executeTakeFirst();
  // FR-LNK-6: an ended registration's management link is just another invalid link.
  if (!registration || !['CONFIRMED', 'WAITLISTED'].includes(registration.state)) return null;
  return { token, registration };
}

async function positionOf(db: AppContext['db'] | Tx, eventId: string, seq: number): Promise<number> {
  const row = await sql<{ p: number }>`SELECT count(*)::int AS p FROM app.registrations
    WHERE event_id = ${eventId} AND state = 'WAITLISTED' AND waitlist_seq <= ${seq}`.execute(db);
  return row.rows[0]?.p ?? 1;
}

/** GET /api/links/manage: read-only management view (FR-SELF-1, FR-WL-7). */
export async function managementView(ctx: AppContext, raw: string) {
  const found = await managedRegistration(ctx.db, raw);
  if (!found) throw new InvalidLinkError();
  const event = await ctx.db
    .selectFrom('app.events')
    .select(['title', 'starts_at', 'time_zone', 'status'])
    .where('id', '=', found.registration.event_id)
    .executeTakeFirstOrThrow();
  const now = await decisionTime(ctx.db);
  if (event.status !== 'SCHEDULED' || now > checkInWindow(event.starts_at).closes)
    throw new InvalidLinkError();
  const summary = { title: event.title, startsAt: event.starts_at.toISOString(), timeZone: event.time_zone };
  const beforeStart = now < event.starts_at;
  if (found.registration.state === 'CONFIRMED') {
    const ticket = await ctx.db
      .selectFrom('app.tickets as t')
      .leftJoin('app.check_ins as c', (join) =>
        join.onRef('c.ticket_id', '=', 't.id').on('c.undone_at', 'is', null),
      )
      .select(['t.code', 'c.id as check_in_id'])
      .where('t.registration_id', '=', found.registration.id)
      .executeTakeFirstOrThrow();
    return {
      state: 'CONFIRMED' as const,
      event: summary,
      ticket: { code: ticket.code },
      checkedIn: !!ticket.check_in_id,
      transferStatement: TRANSFER_STATEMENT,
      actions: { cancel: beforeStart && !ticket.check_in_id },
    };
  }
  return {
    state: 'WAITLISTED' as const,
    event: summary,
    position: await positionOf(ctx.db, found.registration.event_id, found.registration.waitlist_seq!),
    positionMayChange: true,
    actions: { cancel: beforeStart },
  };
}

/** GET /api/links/ticket: read-only share view (FR-SHR-2, FR-SHR-4, FR-SHR-8). Never checks in. */
export async function shareView(ctx: AppContext, raw: string) {
  const token = await findToken(ctx.db, 'share', raw);
  if (!token?.registration_id || token.revoked_at) throw new InvalidLinkError();
  const row = await ctx.db
    .selectFrom('app.registrations as r')
    .innerJoin('app.events as e', 'e.id', 'r.event_id')
    .leftJoin('app.tickets as t', 't.registration_id', 'r.id')
    .leftJoin('app.check_ins as c', (join) =>
      join.onRef('c.ticket_id', '=', 't.id').on('c.undone_at', 'is', null),
    )
    .select(['r.state', 'e.title', 'e.starts_at', 'e.time_zone', 'e.status', 't.code', 'c.id as check_in_id'])
    .where('r.id', '=', token.registration_id)
    .executeTakeFirst();
  const now = await decisionTime(ctx.db);
  if (!row || now > checkInWindow(row.starts_at).closes) throw new InvalidLinkError(); // FR-LNK-5
  const event = { title: row.title, startsAt: row.starts_at.toISOString(), timeZone: row.time_zone };
  if (row.state !== 'CONFIRMED' || row.status !== 'SCHEDULED' || !row.code)
    return { state: 'not_available' as const, event };
  if (row.check_in_id) return { state: 'checked_in' as const, event, transferStatement: TRANSFER_STATEMENT };
  return {
    state: 'valid' as const,
    event,
    ticket: { code: row.code },
    transferStatement: TRANSFER_STATEMENT,
  };
}

/** TX-R03: participant cancellation with FIFO promotion in the same transaction (FR-SELF-2, FR-WL-2, BR-5). */
export async function cancelByManagementLink(
  ctx: AppContext,
  raw: string,
  body: unknown,
  correlationId: string,
) {
  const found = await managedRegistration(ctx.db, raw);
  if (!found) throw new InvalidLinkError();
  // The token is checked before the body, so a malformed body never reveals token validity (ADR-017).
  z.object({ confirmed: z.literal(true) })
    .strict()
    .parse(body);
  const outcome = await withEventLock(
    ctx.db,
    found.registration.event_id,
    'exclusive',
    async ({ trx, now, event }) => {
      const current = await managedRegistration(trx, raw); // re-validate under the lock (NFR-CON-4 b)
      if (!current || event.status !== 'SCHEDULED') return null;
      if (now >= event.starts_at) return 'closed' as const;
      const reg = current.registration;
      if (reg.state === 'CONFIRMED') {
        const checkedIn = await trx
          .selectFrom('app.check_ins as c')
          .innerJoin('app.tickets as t', 't.id', 'c.ticket_id')
          .select('c.id')
          .where('t.registration_id', '=', reg.id)
          .where('c.undone_at', 'is', null)
          .executeTakeFirst();
        if (checkedIn) return 'checked_in' as const;
      }
      // The decrement runs before any promotion increments (NFR-CON-4 f).
      await trx
        .updateTable('app.registrations')
        .set({ state: 'CANCELLED', ended_at: now, end_reason: 'participant_cancelled', updated_at: now })
        .where('id', '=', reg.id)
        .execute();
      await enqueue(trx, {
        type: 'registration_cancelled',
        logicalKey: `registration_cancelled:${reg.id}`,
        recipientEmail: reg.email,
        now,
        eventId: event.id,
        registrationId: reg.id,
        payload: { previousState: reg.state },
        correlationId,
      });
      const promoted = reg.state === 'CONFIRMED' ? await promoteFifo(trx, event.id, now, correlationId) : [];
      await recordAudit(trx, {
        now,
        action: 'registration_cancel',
        actorKind: 'participant_link',
        eventId: event.id,
        registrationId: reg.id,
        outcome: 'success',
        details: { previousState: reg.state, promoted: promoted.length },
      });
      return { result: 'cancelled' as const, previousState: reg.state as 'CONFIRMED' | 'WAITLISTED' };
    },
  );
  if (!outcome) throw new InvalidLinkError();
  if (outcome === 'closed') throw new AppError(409, 'cancellation_closed');
  if (outcome === 'checked_in') throw new AppError(409, 'ticket_checked_in');
  return outcome;
}

// ---------------------------------------------------------------- reschedule (FR-EVT-6, BR-12 to BR-15)

export const rescheduleSchema = z
  .object({
    localStart: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    utcOffset: z
      .string()
      .regex(/^[+-]\d{2}:\d{2}$/)
      .optional(),
    expectedScheduleVersion: z.number().int().min(1),
  })
  .strict();

/** TX-E04: the time zone is preserved (API-D5); every confirmed and waitlisted participant gets a change email. */
export async function rescheduleEvent(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  input: z.infer<typeof rescheduleSchema>,
  correlationId: string,
) {
  if (!z.uuid().safeParse(eventId).success) throw new AppError(404, 'not_found');
  const zone = await ctx.db
    .selectFrom('app.events')
    .select('time_zone')
    .where('id', '=', eventId)
    .executeTakeFirst();
  if (!zone) throw new AppError(404, 'not_found');
  const resolved = resolveLocalStart(input.localStart, zone.time_zone, input.utcOffset);
  if (resolved.kind === 'nonexistent') throw new AppError(422, 'nonexistent_local_time');
  if (resolved.kind === 'ambiguous')
    throw new AppError(422, 'ambiguous_local_time', { offsets: resolved.offsets });

  const result = await withEventLock(ctx.db, eventId, 'exclusive', async ({ trx, now, event }) => {
    if (event.owner_account_id !== principal.accountId) return 'not_found' as const;
    if (!(await sessionStillValid(trx, principal.sessionId, now))) return 'unauthenticated' as const;
    if (event.status !== 'SCHEDULED') return 'not_scheduled' as const;
    if (now >= event.starts_at) return 'started' as const;
    if (resolved.instant.getTime() === event.starts_at.getTime()) return 'unchanged' as const;
    if (event.schedule_version !== input.expectedScheduleVersion) return { mismatch: event.schedule_version };
    if (resolved.instant <= now) return 'past' as const;

    const version = event.schedule_version + 1;
    await trx
      .updateTable('app.events')
      .set({ starts_at: resolved.instant, schedule_version: version, updated_at: now })
      .where('id', '=', eventId)
      .execute();
    const updated = { id: eventId, starts_at: resolved.instant, schedule_version: version };
    const closedNow = now >= cutoffOf(resolved.instant);
    const affected = await trx
      .selectFrom('app.registrations')
      .select(['id', 'email', 'state'])
      .where('event_id', '=', eventId)
      .where('state', 'in', ['CONFIRMED', 'WAITLISTED'])
      .orderBy('id')
      .execute();
    for (const reg of affected) {
      await enqueueWithSlotRule(trx, {
        type: 'event_change',
        filledBy: 'event_change',
        logicalKey: `event_change:${reg.id}:${version}`,
        event: updated,
        registrationId: reg.id,
        email: reg.email,
        now,
        // FR-NTF-3: within 24 h of the new Start the change email is the reminder for confirmed participants.
        occupiesSlot: reg.state === 'CONFIRMED' && withinReminderWindow(resolved.instant, now),
        payload: { registrationClosed: reg.state === 'WAITLISTED' && closedNow },
        correlationId,
      });
    }
    await scheduleReminderTask(trx, eventId, version, resolved.instant, now);
    await scheduleCutoffTask(trx, eventId, version, resolved.instant, now, closedNow);
    await promoteFifo(trx, eventId, now, correlationId); // BR-15: moving later can reopen promotion
    await recordAudit(trx, {
      now,
      action: 'reschedule',
      actorKind: 'owner',
      actorAccountId: principal.accountId,
      eventId,
      outcome: 'success',
      details: { scheduleVersion: version, notified: affected.length },
    });
    return 'rescheduled' as const;
  });
  if (result === null || result === 'not_found') throw new AppError(404, 'not_found');
  if (result === 'unauthenticated') throw new AppError(401, 'unauthenticated');
  if (result === 'not_scheduled') throw new AppError(409, 'event_not_scheduled');
  if (result === 'started') throw new AppError(409, 'event_started');
  if (result === 'past') throw new AppError(422, 'start_not_in_future');
  if (typeof result === 'object')
    throw new AppError(409, 'schedule_version_mismatch', { currentScheduleVersion: result.mismatch });
  return result;
}

export type { LockedEvent };
