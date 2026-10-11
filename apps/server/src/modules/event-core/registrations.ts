import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { AppContext } from '../../composition/context.js';
import { normalizeEmail } from '../../platform/crypto.js';
import { AppError, InvalidLinkError } from '../../platform/errors.js';
import { RULES } from '../../platform/ratelimit.js';
import { cutoffOf } from '../../platform/time.js';
import { decisionTime, withEventLock, type LockedEvent, type Tx } from '../../platform/tx.js';
import { findToken, issueToken, revokeRegistrationTokens, type TokenRow } from '../access-tokens/tokens.js';
import { enqueue } from '../messaging/outbox.js';
import { enqueueWithSlotRule, insertTicket, TRANSFER_STATEMENT, withinReminderWindow } from './lifecycle.js';

/** TX-R01: submit or resubmit. The response never reveals whether the address is registered (FR-REG-8). */
export async function submitRegistration(
  ctx: AppContext,
  publicEventId: string,
  rawEmail: string,
  ip: string,
  correlationId: string,
): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const event = await ctx.db.selectFrom('app.events').select('id').where('public_id', '=', publicEventId).executeTakeFirst();
  if (!event) throw new AppError(404, 'not_found');
  const perIp = await ctx.limiter.hit(RULES.registrationPerIp, ip);
  const perAddress = await ctx.limiter.hit(RULES.registrationPerAddress, `${event.id}:${email}`);
  if (!perIp.allowed || !perAddress.allowed) {
    throw new AppError(429, 'rate_limited', { retryAfterSeconds: Math.max(perIp.retryAfterSeconds, perAddress.retryAfterSeconds) });
  }

  const result = await withEventLock(ctx.db, event.id, 'exclusive', async ({ trx, now, event: locked }) => {
    if (locked.status !== 'SCHEDULED' || now >= cutoffOf(locked.starts_at)) return 'closed' as const;
    const active = await trx
      .selectFrom('app.registrations')
      .select(['id', 'state', 'verification_generation'])
      .where('event_id', '=', locked.id)
      .where('email', '=', email)
      .where('state', 'in', ['PENDING_VERIFICATION', 'CONFIRMED', 'WAITLISTED'])
      .executeTakeFirst();
    const horizon = new Date(Math.min(now.getTime() + 6 * 3_600_000, cutoffOf(locked.starts_at).getTime()));

    if (!active) {
      const created = await trx
        .insertInto('app.registrations')
        .values({ event_id: locked.id, email, created_at: now, updated_at: now })
        .returning('id')
        .executeTakeFirstOrThrow();
      await enqueue(trx, {
        type: 'verification',
        logicalKey: `verification:${created.id}:1`,
        recipientEmail: email,
        now,
        horizonAt: horizon,
        eventId: locked.id,
        registrationId: created.id,
        verificationGeneration: 1,
        correlationId,
      });
    } else if (active.state === 'PENDING_VERIFICATION') {
      // FR-REG-7: a fresh link; every earlier verification token is revoked.
      const generation = active.verification_generation + 1;
      await trx
        .updateTable('app.registrations')
        .set({ verification_generation: generation, updated_at: now })
        .where('id', '=', active.id)
        .execute();
      await revokeRegistrationTokens(trx, active.id, 'verification', 'resubmitted', now);
      await enqueue(trx, {
        type: 'verification',
        logicalKey: `verification:${active.id}:${generation}`,
        recipientEmail: email,
        now,
        horizonAt: horizon,
        eventId: locked.id,
        registrationId: active.id,
        verificationGeneration: generation,
        correlationId,
      });
    } else {
      // FR-REG-8: no new record; an access email goes to the address owner.
      const submissionId = randomUUID();
      await enqueue(trx, {
        type: 'existing_access',
        logicalKey: `existing_access:${active.id}:${submissionId}`,
        recipientEmail: email,
        now,
        eventId: locked.id,
        registrationId: active.id,
        requestRef: submissionId,
        correlationId,
      });
    }
    return 'ok' as const;
  });
  if (result === null) throw new AppError(404, 'not_found');
  if (result === 'closed') throw new AppError(409, 'registration_closed');
}

interface VerificationContext {
  token: TokenRow;
  registration: { id: string; email: string; state: string; verified_at: Date | null };
}

async function verificationContext(db: AppContext['db'] | Tx, raw: string): Promise<VerificationContext | null> {
  const token = await findToken(db, 'verification', raw);
  if (!token?.registration_id) return null;
  const registration = await db
    .selectFrom('app.registrations')
    .select(['id', 'email', 'state', 'verified_at'])
    .where('id', '=', token.registration_id)
    .executeTakeFirst();
  return registration ? { token, registration } : null;
}

/** The verification link's window: 24 h from issuance or the current cutoff, whichever is first (FR-REG-3). */
function withinWindow(token: TokenRow, startsAt: Date, now: Date): boolean {
  return !token.revoked_at && !!token.expires_at && now < token.expires_at && now < cutoffOf(startsAt);
}

export interface EventSummary {
  title: string;
  startsAt: string;
  timeZone: string;
}

/** GET /api/links/verify: read-only (FR-REG-4, FR-REG-11, FR-REG-12). */
export async function resolveVerification(ctx: AppContext, raw: string) {
  const found = await verificationContext(ctx.db, raw);
  if (!found) throw new InvalidLinkError();
  const event = await ctx.db
    .selectFrom('app.events')
    .select(['title', 'starts_at', 'time_zone', 'status'])
    .where('id', '=', found.token.event_id!)
    .executeTakeFirstOrThrow();
  const now = await decisionTime(ctx.db);
  if (!withinWindow(found.token, event.starts_at, now)) throw new InvalidLinkError();
  const summary = { title: event.title, startsAt: event.starts_at.toISOString(), timeZone: event.time_zone };
  if (found.registration.verified_at) return { state: 'already_confirmed' as const, event: summary };
  if (found.registration.state !== 'PENDING_VERIFICATION' || event.status !== 'SCHEDULED') throw new InvalidLinkError();
  return { state: 'awaiting_confirmation' as const, event: summary };
}

async function waitlistPosition(trx: Tx, eventId: string, seq: number): Promise<number> {
  const row = await sql<{ position: number }>`
    SELECT count(*)::int AS position FROM app.registrations
    WHERE event_id = ${eventId} AND state = 'WAITLISTED' AND waitlist_seq <= ${seq}`.execute(trx);
  return row.rows[0]?.position ?? 1;
}

export type VerificationResult =
  | {
      result: 'confirmed';
      event: EventSummary;
      ticket: { code: string };
      links: { management: string; share: string };
      transferStatement: string;
    }
  | {
      result: 'waitlisted';
      event: EventSummary;
      position: number;
      positionMayChange: true;
      links: { management: string };
    }
  | { result: 'already_confirmed' };

/** TX-R02: confirmation decided atomically under the exclusive event lock (FR-REG-4, BR-1, EC-1). */
export async function confirmVerification(ctx: AppContext, raw: string, correlationId: string): Promise<VerificationResult> {
  const found = await verificationContext(ctx.db, raw);
  if (!found?.token.event_id) throw new InvalidLinkError();
  const origin = ctx.config.PUBLIC_ORIGIN;

  const outcome = await withEventLock(ctx.db, found.token.event_id, 'exclusive', async ({ trx, now, event }) => {
    // Re-check everything read before the lock (NFR-CON-4 b).
    const current = await verificationContext(trx, raw);
    if (!current || !withinWindow(current.token, event.starts_at, now)) return null;
    if (current.registration.verified_at) return { result: 'already_confirmed' } as const;
    if (current.registration.state !== 'PENDING_VERIFICATION' || event.status !== 'SCHEDULED') return null;
    const registrationId = current.registration.id;
    const summary = { title: event.title, startsAt: event.starts_at.toISOString(), timeZone: event.time_zone };

    if (event.confirmed_count < event.capacity) {
      await trx
        .updateTable('app.registrations')
        .set({ state: 'CONFIRMED', verified_at: now, confirmed_at: now, updated_at: now })
        .where('id', '=', registrationId)
        .execute();
      const code = await insertTicket(trx, registrationId, event.id, now);
      const management = await issueToken(trx, { type: 'management', now, registrationId, eventId: event.id, via: 'page' });
      const share = await issueToken(trx, { type: 'share', now, registrationId, eventId: event.id, via: 'page' });
      // FR-NTF-2: confirmed within 24 h of Start → the ticket email is this version's reminder.
      await enqueueWithSlotRule(trx, {
        type: 'ticket_confirmation',
        filledBy: 'ticket',
        logicalKey: `ticket_confirmation:${registrationId}`,
        event,
        registrationId,
        email: current.registration.email,
        now,
        occupiesSlot: withinReminderWindow(event.starts_at, now),
        correlationId,
      });
      return {
        result: 'confirmed',
        event: summary,
        ticket: { code },
        links: { management: `${origin}/manage#t=${management}`, share: `${origin}/ticket#t=${share}` },
        transferStatement: TRANSFER_STATEMENT,
      } as const;
    }

    const seq = await claimWaitlistSeq(trx, event);
    await trx
      .updateTable('app.registrations')
      .set({ state: 'WAITLISTED', verified_at: now, waitlisted_at: now, waitlist_seq: seq, updated_at: now })
      .where('id', '=', registrationId)
      .execute();
    const position = await waitlistPosition(trx, event.id, seq);
    const management = await issueToken(trx, { type: 'management', now, registrationId, eventId: event.id, via: 'page' });
    await enqueue(trx, {
      type: 'waitlist_confirmation',
      logicalKey: `waitlist_confirmation:${registrationId}`,
      recipientEmail: current.registration.email,
      now,
      eventId: event.id,
      registrationId,
      payload: { position },
      correlationId,
    });
    return {
      result: 'waitlisted',
      event: summary,
      position,
      positionMayChange: true,
      links: { management: `${origin}/manage#t=${management}` },
    } as const;
  });
  if (!outcome) throw new InvalidLinkError();
  return outcome;
}

async function claimWaitlistSeq(trx: Tx, event: LockedEvent): Promise<number> {
  const row = await sql<{ seq: number }>`
    UPDATE app.events SET next_waitlist_seq = next_waitlist_seq + 1 WHERE id = ${event.id}
    RETURNING next_waitlist_seq - 1 AS seq`.execute(trx);
  return row.rows[0]!.seq;
}
