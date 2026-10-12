import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { AppError, InvalidLinkError } from '../../platform/errors.js';
import { RULES } from '../../platform/ratelimit.js';
import { checkInWindow } from '../../platform/time.js';
import { withEventLock, type LockedEvent, type Tx } from '../../platform/tx.js';
import { findToken, issueTokenWithId, type TokenRow } from '../access-tokens/tokens.js';
import { recordAudit } from '../audit/audit.js';
import { enqueue } from '../messaging/outbox.js';

// Participant self-service through the management link (K-405): ticket resend (TX-P01, FR-SELF-4),
// share-link issuance (TX-P02, FR-SHR-1) and link rotation (TX-P03, FR-ROT-1 to FR-ROT-11).
// The management token is the only authority (FR-LNK-10 c); share tokens never work here, because
// tokens are looked up by the route's type (FR-SHR-3). Every state change runs under the exclusive
// event lock, so it is serialized with cancellation, promotion, event cancellation and deletion.

const ALREADY_REPLACED_WINDOW_MS = 15 * 60_000; // FR-ROT-11 (a)

export const resendSchema = z.object({ requestId: z.uuid() }).strict();
export const rotationSchema = z
  .object({ linkType: z.enum(['management', 'share']), requestId: z.uuid(), confirmed: z.literal(true) })
  .strict();

interface ActiveRegistration {
  id: string;
  email: string;
  state: 'CONFIRMED' | 'WAITLISTED';
}

/**
 * Re-validates a management token under the event lock: not revoked, its registration still
 * CONFIRMED or WAITLISTED (FR-LNK-6), the event SCHEDULED, the check-in window not ended (FR-LNK-5).
 * Anything else is just an invalid link (FR-LNK-7).
 *
 * `validAtSubmission` (rotation only, PD-52): FR-ROT-9 and AC-75 require two rotations submitted at
 * the same time with two different valid tokens to both succeed in commit order. So a token that was
 * valid when the request was submitted, and was revoked meanwhile by a concurrent ROTATION (not by
 * anything else), still authorizes it. A token already revoked at submission never does.
 */
async function activeRegistration(
  trx: Tx,
  token: TokenRow,
  event: LockedEvent,
  now: Date,
  validAtSubmission = false,
): Promise<ActiveRegistration | null> {
  const current = await trx
    .selectFrom('app.access_tokens')
    .select(['revoked_at', 'revoke_reason'])
    .where('id', '=', token.id)
    .executeTakeFirst();
  if (!current) return null;
  if (current.revoked_at && !(validAtSubmission && current.revoke_reason === 'rotated')) return null;
  if (event.status !== 'SCHEDULED' || now > checkInWindow(event.starts_at).closes) return null;
  const registration = await trx
    .selectFrom('app.registrations')
    .select(['id', 'email', 'state'])
    .where('id', '=', token.registration_id!)
    .executeTakeFirst();
  if (!registration || (registration.state !== 'CONFIRMED' && registration.state !== 'WAITLISTED'))
    return null;
  return registration as ActiveRegistration;
}

/** The management token the request was sent with, revoked or not (FR-ROT-11 needs both). */
async function managementToken(ctx: AppContext, raw: string): Promise<TokenRow> {
  const token = await findToken(ctx.db, 'management', raw);
  if (!token?.registration_id || !token.event_id) throw new InvalidLinkError();
  return token;
}

async function hitLimit(
  ctx: AppContext,
  rule: (typeof RULES)[keyof typeof RULES],
  key: string,
  code: 'resend_limit' | 'rotation_limit',
) {
  const limit = await ctx.limiter.hit(rule, key);
  if (!limit.allowed) throw new AppError(429, code, { retryAfterSeconds: limit.retryAfterSeconds });
}

/** POST /api/links/manage/resend (API #9, TX-P01): a ticket email, idempotent per request ID. */
export async function requestTicketResend(
  ctx: AppContext,
  raw: string,
  body: unknown,
  correlationId: string,
) {
  const token = await managementToken(ctx, raw);
  if (token.revoked_at) throw new InvalidLinkError();
  const input = resendSchema.parse(body); // after the token, so a bad body never reveals token validity
  await hitLimit(ctx, RULES.ticketResendPerRegistration, token.registration_id!, 'resend_limit');
  const outcome = await withEventLock(ctx.db, token.event_id!, 'exclusive', async ({ trx, now, event }) => {
    const registration = await activeRegistration(trx, token, event, now);
    if (!registration) return 'invalid' as const;
    if (registration.state !== 'CONFIRMED') return 'not_confirmed' as const;
    await enqueue(trx, {
      type: 'ticket_resend',
      logicalKey: `ticket_resend:${registration.id}:${input.requestId}`, // a retry creates nothing new
      recipientEmail: registration.email,
      now,
      eventId: event.id,
      registrationId: registration.id,
      requestRef: input.requestId,
      correlationId,
    });
    return 'queued' as const;
  });
  if (outcome === null || outcome === 'invalid') throw new InvalidLinkError();
  if (outcome === 'not_confirmed') throw new AppError(409, 'not_confirmed');
  return { result: 'queued' as const };
}

/** POST /api/links/manage/share-links (API #10, TX-P02): every delivery of a link is a new issuance (FR-LNK-2). */
export async function issueShareLink(ctx: AppContext, raw: string) {
  const token = await managementToken(ctx, raw);
  if (token.revoked_at) throw new InvalidLinkError();
  const outcome = await withEventLock(ctx.db, token.event_id!, 'exclusive', async ({ trx, now, event }) => {
    const registration = await activeRegistration(trx, token, event, now);
    if (!registration) return 'invalid' as const;
    if (registration.state !== 'CONFIRMED') return 'not_confirmed' as const;
    const share = await issueTokenWithId(trx, {
      type: 'share',
      now,
      registrationId: registration.id,
      eventId: event.id,
      via: 'page',
    });
    return { raw: share.raw };
  });
  if (outcome === null || outcome === 'invalid') throw new InvalidLinkError();
  if (outcome === 'not_confirmed') throw new AppError(409, 'not_confirmed');
  return { shareLink: `${ctx.config.PUBLIC_ORIGIN}/ticket#t=${outcome.raw}` };
}

/**
 * POST /api/links/manage/rotations (API #11, TX-P03). One transaction (FR-ROT-3): issue exactly one
 * new token, record the request (U-20 makes request IDs single-use forever), revoke every other
 * unrevoked token of that type for the registration, and for management rotations queue the
 * "management link replaced" email (FR-ROT-5). The other link type, the ticket code, the state, the
 * waiting-list position and the reminder slots never change (FR-ROT-4). If anything fails, nothing
 * changes (FR-ROT-6).
 */
export async function rotateLink(ctx: AppContext, raw: string, body: unknown, correlationId: string) {
  const token = await managementToken(ctx, raw);
  const input = rotationSchema.parse(body);
  await hitLimit(
    ctx,
    RULES.rotationPerRegistrationAndType,
    `${token.registration_id}:${input.linkType}`,
    'rotation_limit',
  );

  let outcome;
  try {
    outcome = await withEventLock(ctx.db, token.event_id!, 'exclusive', async ({ trx, now, event }) => {
      // FR-ROT-11: a request ID that already has a committed rotation decides the outcome, with no write.
      const previous = await trx
        .selectFrom('app.rotation_requests')
        .select(['authorizing_token_id', 'decided_at'])
        .where('registration_id', '=', token.registration_id!)
        .where('request_id', '=', input.requestId)
        .executeTakeFirst();
      if (previous) {
        const current = await trx
          .selectFrom('app.access_tokens')
          .select('revoked_at')
          .where('id', '=', token.id)
          .executeTakeFirst();
        if (
          previous.authorizing_token_id === token.id &&
          current?.revoked_at &&
          now.getTime() < previous.decided_at.getTime() + ALREADY_REPLACED_WINDOW_MS
        )
          return { kind: 'already_replaced' as const }; // (a)
        if (await activeRegistration(trx, token, event, now)) return { kind: 'already_processed' as const }; // (c)
        return { kind: 'invalid' as const }; // (b)
      }

      const registration = await activeRegistration(trx, token, event, now, !token.revoked_at);
      if (!registration) return { kind: 'invalid' as const }; // FR-ROT-9, FR-LNK-6
      if (input.linkType === 'share' && registration.state !== 'CONFIRMED')
        return { kind: 'not_available' as const }; // FR-ROT-1: waiting-list entries have no share link

      const issued = await issueTokenWithId(trx, {
        type: input.linkType,
        now,
        registrationId: registration.id,
        eventId: event.id,
        via: 'page',
      });
      const outboxId = input.linkType === 'management' ? randomUUID() : null;
      await trx
        .insertInto('app.rotation_requests')
        .values({
          registration_id: registration.id,
          event_id: event.id,
          request_id: input.requestId,
          link_type: input.linkType,
          authorizing_token_id: token.id,
          new_token_id: issued.id,
          decided_at: now,
          outbox_message_id: outboxId,
        })
        .execute();
      await trx
        .updateTable('app.access_tokens')
        .set({ revoked_at: now, revoke_reason: 'rotated' })
        .where('registration_id', '=', registration.id)
        .where('token_type', '=', input.linkType)
        .where('revoked_at', 'is', null)
        .where('id', '!=', issued.id)
        .execute();
      if (outboxId) {
        // FR-ROT-5, FR-NTF-13: to the verified registrant address only; its link is issued at send time.
        await enqueue(trx, {
          id: outboxId,
          type: 'management_link_replaced',
          logicalKey: `management_link_replaced:${registration.id}:${input.requestId}`,
          recipientEmail: registration.email,
          now,
          eventId: event.id,
          registrationId: registration.id,
          requestRef: input.requestId,
          correlationId,
        });
      }
      // FR-ROT-10: registration, link type, time and outcome; never a token or a hash.
      await recordAudit(trx, {
        now,
        action: 'link_rotated',
        actorKind: 'participant_link',
        eventId: event.id,
        registrationId: registration.id,
        outcome: 'success',
        details: { linkType: input.linkType },
      });
      return { kind: 'rotated' as const, raw: issued.raw };
    });
  } catch (error) {
    if (error instanceof AppError || error instanceof InvalidLinkError) throw error;
    // FR-ROT-6: the transaction rolled back, so nothing changed and every existing link still works.
    throw new AppError(503, 'rotation_not_applied');
  }
  if (outcome === null || outcome.kind === 'invalid') throw new InvalidLinkError();
  if (outcome.kind === 'already_processed') throw new AppError(409, 'request_already_processed');
  if (outcome.kind === 'not_available') throw new AppError(409, 'rotation_not_available');
  if (outcome.kind === 'already_replaced') return { result: 'already_replaced' as const };
  const path = input.linkType === 'management' ? 'manage' : 'ticket';
  return {
    result: 'rotated' as const,
    linkType: input.linkType,
    newLink: `${ctx.config.PUBLIC_ORIGIN}/${path}#t=${outcome.raw}`,
    replacementEmailQueued: input.linkType === 'management',
  };
}
