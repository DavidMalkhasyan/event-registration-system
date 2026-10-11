import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { normalizeTicketCode } from '../../platform/crypto.js';
import { AppError } from '../../platform/errors.js';
import { RULES } from '../../platform/ratelimit.js';
import type { CheckInOutcome } from '../../platform/schema.js';
import { checkInWindow } from '../../platform/time.js';
import { withEventLock } from '../../platform/tx.js';
import { sessionStillValid, type OrganizerPrincipal } from '../identity/sessions.js';

export const checkInSchema = z.object({ code: z.string().min(1).max(32), requestId: z.uuid() }).strict();

export interface CheckInResult {
  outcome: CheckInOutcome;
  firstCheckedInAt?: string;
}

/** TX-C01: atomic check-in, idempotent by request ID (FR-CHK-1 to FR-CHK-5, BR-7, D-5). Owner path. */
export async function checkInAsOwner(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  input: z.infer<typeof checkInSchema>,
): Promise<CheckInResult> {
  if (!z.uuid().safeParse(eventId).success) throw new AppError(404, 'not_found');
  const code = normalizeTicketCode(input.code);
  // Plain lookup before the transaction (NFR-CON-4 b).
  const ticket = await ctx.db
    .selectFrom('app.tickets')
    .select(['id', 'event_id', 'registration_id'])
    .where('code', '=', code)
    .executeTakeFirst();

  const result = await withEventLock(ctx.db, eventId, 'exclusive', async ({ trx, now, event }) => {
    if (event.owner_account_id !== principal.accountId) return 'not_found' as const;
    if (!(await sessionStillValid(trx, principal.sessionId, now))) return 'unauthenticated' as const;

    const previous = await trx
      .selectFrom('app.check_in_requests')
      .select(['principal_id', 'outcome', 'first_checked_in_at'])
      .where('event_id', '=', eventId)
      .where('request_id', '=', input.requestId)
      .executeTakeFirst();
    if (previous) {
      if (previous.principal_id !== principal.sessionId) return 'conflict' as const;
      return {
        outcome: previous.outcome,
        ...(previous.first_checked_in_at
          ? { firstCheckedInAt: previous.first_checked_in_at.toISOString() }
          : {}),
      };
    }

    let outcome: CheckInOutcome;
    let firstCheckedInAt: Date | null = null;
    const window = checkInWindow(event.starts_at);
    if (!ticket) outcome = 'INVALID_CODE';
    else if (ticket.event_id !== eventId) outcome = 'WRONG_EVENT';
    else if (event.status === 'CANCELLED') outcome = 'EVENT_CANCELLED';
    else {
      const registration = await trx
        .selectFrom('app.registrations')
        .select('state')
        .where('id', '=', ticket.registration_id)
        .executeTakeFirstOrThrow();
      if (registration.state !== 'CONFIRMED') outcome = 'TICKET_CANCELLED';
      else if (now < window.opens || now > window.closes) outcome = 'OUTSIDE_CHECK_IN_WINDOW';
      else {
        const inserted = await trx
          .insertInto('app.check_ins')
          .values({
            ticket_id: ticket.id,
            event_id: eventId,
            checked_in_at: now,
            actor_kind: 'owner',
            actor_account_id: principal.accountId,
          })
          .onConflict((oc) => oc.column('ticket_id').where('undone_at', 'is', null).doNothing())
          .returning('checked_in_at')
          .executeTakeFirst();
        if (inserted) outcome = 'CHECKED_IN';
        else {
          outcome = 'ALREADY_CHECKED_IN';
          const existing = await trx
            .selectFrom('app.check_ins')
            .select('checked_in_at')
            .where('ticket_id', '=', ticket.id)
            .where('undone_at', 'is', null)
            .executeTakeFirstOrThrow();
          firstCheckedInAt = existing.checked_in_at;
        }
      }
    }
    await trx
      .insertInto('app.check_in_requests')
      .values({
        event_id: eventId,
        request_id: input.requestId,
        principal_kind: 'owner',
        principal_id: principal.sessionId,
        ticket_id: ticket && ticket.event_id === eventId ? ticket.id : null,
        outcome,
        first_checked_in_at: firstCheckedInAt,
        created_at: now,
      })
      .execute();
    return { outcome, ...(firstCheckedInAt ? { firstCheckedInAt: firstCheckedInAt.toISOString() } : {}) };
  });

  if (result === null || result === 'not_found') throw new AppError(404, 'not_found');
  if (result === 'unauthenticated') throw new AppError(401, 'unauthenticated');
  if (result === 'conflict') throw new AppError(409, 'request_id_conflict');
  if (result.outcome === 'INVALID_CODE' || result.outcome === 'WRONG_EVENT') {
    const limit = await ctx.limiter.hit(RULES.failedCheckInsPerSession, principal.sessionId);
    if (!limit.allowed)
      throw new AppError(429, 'rate_limited', { retryAfterSeconds: limit.retryAfterSeconds });
  }
  return result;
}
