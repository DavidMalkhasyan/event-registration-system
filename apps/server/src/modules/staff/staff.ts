import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { hashToken, normalizeEmail, randomToken } from '../../platform/crypto.js';
import { AppError, InvalidLinkError } from '../../platform/errors.js';
import { RULES } from '../../platform/ratelimit.js';
import { checkInWindow } from '../../platform/time.js';
import { decisionTime, withEventLock, type LockedEvent, type Tx } from '../../platform/tx.js';
import { findToken, type TokenRow } from '../access-tokens/tokens.js';
import { recordAudit } from '../audit/audit.js';
import { csrfTokenFor, sessionStillValid, type OrganizerPrincipal } from '../identity/sessions.js';
import { STAFF_SESSION_ABSOLUTE_MS, type StaffPrincipal } from '../identity/staff-sessions.js';
import { enqueue } from '../messaging/outbox.js';

// Staff invitations and sessions (K-406): FR-STAFF-1 to FR-STAFF-7, TX-S01 to TX-S03, API #14 to #16
// and #46 to #50, decisions PD-53 to PD-58. Every state change runs under the exclusive event lock,
// so it is serialized with check-in, cancellation and deletion.

export const INVITATION_TTL_MS = 168 * 3_600_000; // FR-STAFF-5: 7 days after issuance

export const inviteSchema = z.object({ email: z.email().max(254) }).strict();

function eventAllowsStaff(event: { status: string; starts_at: Date }, now: Date): boolean {
  return event.status === 'SCHEDULED' && now <= checkInWindow(event.starts_at).closes;
}

async function ownerTransaction<T>(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  fn: (args: { trx: Tx; now: Date; event: LockedEvent }) => Promise<T>,
): Promise<T> {
  if (!z.uuid().safeParse(eventId).success) throw new AppError(404, 'not_found');
  const result = await withEventLock(ctx.db, eventId, 'exclusive', async ({ trx, now, event }) => {
    if (event.owner_account_id !== principal.accountId) return { error: new AppError(404, 'not_found') };
    if (!(await sessionStillValid(trx, principal.sessionId, now)))
      return { error: new AppError(401, 'unauthenticated') };
    return { value: await fn({ trx, now, event }) };
  });
  if (result === null) throw new AppError(404, 'not_found');
  if ('error' in result) throw result.error;
  return result.value;
}

async function revokeInvitationTokens(
  trx: Tx,
  invitationIds: string[],
  reason: string,
  now: Date,
): Promise<void> {
  if (invitationIds.length === 0) return;
  await trx
    .updateTable('app.access_tokens')
    .set({ revoked_at: now, revoke_reason: reason })
    .where('staff_invitation_id', 'in', invitationIds)
    .where('revoked_at', 'is', null)
    .execute();
}

/**
 * Called by event cancellation (TX-E05) in its transaction (PD-58, FR-STAFF-5): pending invitations
 * are revoked and their tokens too. Staff sessions end by their validity rule (event not SCHEDULED).
 */
export async function revokeInvitationsOnCancellation(trx: Tx, eventId: string, now: Date): Promise<void> {
  const revoked = await trx
    .updateTable('app.staff_invitations')
    .set({ status: 'revoked', ended_at: now })
    .where('event_id', '=', eventId)
    .where('status', '=', 'pending')
    .returning('id')
    .execute();
  await revokeInvitationTokens(
    trx,
    revoked.map((r) => r.id),
    'event_cancelled',
    now,
  );
}

function invitationView(
  row: {
    id: string;
    invited_email: string;
    status: string;
    created_at: Date;
    expires_at: Date;
    accepted_at: Date | null;
  },
  event: { status: string; starts_at: Date },
  now: Date,
) {
  const allows = eventAllowsStaff(event, now);
  const expired = row.status === 'pending' && (now >= row.expires_at || !allows); // derived (FR-STAFF-5)
  const status = expired ? 'expired' : row.status;
  return {
    id: row.id,
    email: row.invited_email,
    status,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    ...(row.accepted_at ? { acceptedAt: row.accepted_at.toISOString() } : {}),
    canReinvite: allows && status !== 'pending',
  };
}

/** TX-S01 (API #48): invite or re-invite one address for this event (FR-STAFF-1, FR-STAFF-5). */
export async function inviteStaff(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  input: z.infer<typeof inviteSchema>,
  correlationId: string,
) {
  const email = normalizeEmail(input.email);
  // PD-55, keyed by owner and event, so nobody else's attempts can use up the owner's allowance.
  const limit = await ctx.limiter.hit(RULES.staffInvitationsPerEvent, `${principal.accountId}:${eventId}`);
  if (!limit.allowed) throw new AppError(429, 'rate_limited', { retryAfterSeconds: limit.retryAfterSeconds });
  return ownerTransaction(ctx, principal, eventId, async ({ trx, now, event }) => {
    if (event.status !== 'SCHEDULED') throw new AppError(409, 'event_not_scheduled');
    if (!eventAllowsStaff(event, now)) throw new AppError(409, 'check_in_window_ended');
    // U-17: a re-invitation replaces the pending invitation for the same address, and its links stop working.
    const replaced = await trx
      .updateTable('app.staff_invitations')
      .set({ status: 'replaced', ended_at: now })
      .where('event_id', '=', eventId)
      .where('invited_email', '=', email)
      .where('status', '=', 'pending')
      .returning('id')
      .execute();
    await revokeInvitationTokens(
      trx,
      replaced.map((r) => r.id),
      'invitation_replaced',
      now,
    );
    const invitation = await trx
      .insertInto('app.staff_invitations')
      .values({
        event_id: eventId,
        invited_email: email,
        created_at: now,
        expires_at: new Date(now.getTime() + INVITATION_TTL_MS),
      })
      .returning(['id', 'invited_email', 'status', 'created_at', 'expires_at', 'accepted_at'])
      .executeTakeFirstOrThrow();
    await enqueue(trx, {
      type: 'staff_invitation',
      logicalKey: `staff_invitation:${invitation.id}`,
      recipientEmail: email,
      now,
      horizonAt: new Date(
        Math.min(invitation.expires_at.getTime(), checkInWindow(event.starts_at).closes.getTime()),
      ),
      eventId,
      requestRef: invitation.id, // PD-54: the email references its invitation
      correlationId,
    });
    await recordAudit(trx, {
      now,
      action: 'staff_invited',
      actorKind: 'owner',
      actorAccountId: principal.accountId,
      eventId,
      subjectId: invitation.id,
      outcome: 'success',
    });
    return invitationView(invitation, event, now);
  });
}

/** API #47: the owner's staff list (FR-STAFF-5 to FR-STAFF-7). */
export async function staffOverview(ctx: AppContext, principal: OrganizerPrincipal, eventId: string) {
  if (!z.uuid().safeParse(eventId).success) throw new AppError(404, 'not_found');
  const event = await ctx.db
    .selectFrom('app.events')
    .select(['status', 'starts_at'])
    .where('id', '=', eventId)
    .where('owner_account_id', '=', principal.accountId)
    .executeTakeFirst();
  if (!event) throw new AppError(404, 'not_found');
  const now = await decisionTime(ctx.db);
  const invitations = await ctx.db
    .selectFrom('app.staff_invitations')
    .select(['id', 'invited_email', 'status', 'created_at', 'expires_at', 'accepted_at'])
    .where('event_id', '=', eventId)
    .orderBy('created_at', 'desc')
    .execute();
  const allows = eventAllowsStaff(event, now);
  const sessions = allows
    ? await ctx.db
        .selectFrom('app.staff_sessions')
        .select(['id', 'created_at', 'last_seen_at'])
        .where('event_id', '=', eventId)
        .where('revoked_at', 'is', null)
        .where('absolute_expires_at', '>', now)
        .where('last_seen_at', '>', new Date(now.getTime() - 168 * 3_600_000))
        .orderBy('created_at')
        .execute()
    : [];
  return {
    invitations: invitations.map((i) => invitationView(i, event, now)),
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.created_at.toISOString(),
      lastSeenAt: s.last_seen_at.toISOString(),
    })),
  };
}

/** TX-S03 (API #49): revoke a pending invitation; its links stop working immediately (FR-STAFF-5). */
export async function revokeInvitation(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  invitationId: string,
) {
  if (!z.uuid().safeParse(invitationId).success) throw new AppError(404, 'not_found');
  await ownerTransaction(ctx, principal, eventId, async ({ trx, now }) => {
    const invitation = await trx
      .selectFrom('app.staff_invitations')
      .select(['id', 'status'])
      .where('id', '=', invitationId)
      .where('event_id', '=', eventId)
      .executeTakeFirst();
    if (!invitation) throw new AppError(404, 'not_found');
    if (invitation.status !== 'pending') throw new AppError(409, 'invitation_not_pending');
    await trx
      .updateTable('app.staff_invitations')
      .set({ status: 'revoked', ended_at: now })
      .where('id', '=', invitationId)
      .execute();
    await revokeInvitationTokens(trx, [invitationId], 'invitation_revoked', now);
    await recordAudit(trx, {
      now,
      action: 'staff_invitation_revoked',
      actorKind: 'owner',
      actorAccountId: principal.accountId,
      eventId,
      subjectId: invitationId,
      outcome: 'success',
    });
  });
}

/**
 * TX-S03 (API #50): revoke one staff device session (FR-STAFF-3, FR-STAFF-6). Under the exclusive event
 * lock, so a check-in either commits before it or is rejected after it (AC-156). Idempotent.
 */
export async function revokeStaffSession(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  staffSessionId: string,
) {
  if (!z.uuid().safeParse(staffSessionId).success) throw new AppError(404, 'not_found');
  await ownerTransaction(ctx, principal, eventId, async ({ trx, now }) => {
    const session = await trx
      .selectFrom('app.staff_sessions')
      .select(['id', 'revoked_at'])
      .where('id', '=', staffSessionId)
      .where('event_id', '=', eventId)
      .executeTakeFirst();
    if (!session) throw new AppError(404, 'not_found');
    if (session.revoked_at) return;
    await trx
      .updateTable('app.staff_sessions')
      .set({ revoked_at: now, revoke_reason: 'owner_revoked' })
      .where('id', '=', staffSessionId)
      .execute();
    await recordAudit(trx, {
      now,
      action: 'staff_session_revoked',
      actorKind: 'owner',
      actorAccountId: principal.accountId,
      eventId,
      subjectId: staffSessionId,
      outcome: 'success',
    });
  });
}

/** An invitation token that can still be accepted (FR-STAFF-5); anything else is just an invalid link. */
async function usableInvitation(
  db: AppContext['db'] | Tx,
  token: TokenRow,
  now: Date,
  eventRow?: { status: string; starts_at: Date },
) {
  if (token.revoked_at || !token.staff_invitation_id || !token.event_id) return null;
  const invitation = await db
    .selectFrom('app.staff_invitations as i')
    .innerJoin('app.events as e', 'e.id', 'i.event_id')
    .select([
      'i.id',
      'i.status',
      'i.expires_at',
      'e.status as event_status',
      'e.starts_at',
      'e.title',
      'e.time_zone',
    ])
    .where('i.id', '=', token.staff_invitation_id)
    .executeTakeFirst();
  if (!invitation || invitation.status !== 'pending' || now >= invitation.expires_at) return null;
  const event = eventRow ?? { status: invitation.event_status, starts_at: invitation.starts_at };
  if (!eventAllowsStaff(event, now)) return null;
  return invitation;
}

/** GET/HEAD /api/links/invite (API #14, #15): read-only; opening never grants access (FR-STAFF-1, FR-LNK-9). */
export async function resolveInvitation(ctx: AppContext, raw: string) {
  const token = await findToken(ctx.db, 'staff_invitation', raw);
  if (!token) throw new InvalidLinkError();
  const invitation = await usableInvitation(ctx.db, token, await decisionTime(ctx.db));
  if (!invitation) throw new InvalidLinkError();
  return {
    event: {
      title: invitation.title,
      startsAt: invitation.starts_at.toISOString(),
      timeZone: invitation.time_zone,
    },
  };
}

/**
 * POST /api/links/invite/accept (API #16, TX-S02): the explicit "Accept" (FR-STAFF-1). Single use:
 * accepting twice grants access once (AC-82). Whoever accepts first gets the session (FR-STAFF-7).
 */
export async function acceptInvitation(ctx: AppContext, raw: string) {
  const token = await findToken(ctx.db, 'staff_invitation', raw);
  if (!token?.event_id) throw new InvalidLinkError();
  const rawSession = randomToken();
  const result = await withEventLock(ctx.db, token.event_id, 'exclusive', async ({ trx, now, event }) => {
    const current = await findToken(trx, 'staff_invitation', raw);
    if (!current) return null;
    const invitation = await usableInvitation(trx, current, now, event);
    if (!invitation) return null;
    await trx
      .updateTable('app.staff_invitations')
      .set({ status: 'accepted', accepted_at: now, ended_at: now })
      .where('id', '=', invitation.id)
      .execute();
    const absolute = new Date(now.getTime() + STAFF_SESSION_ABSOLUTE_MS);
    const session = await trx
      .insertInto('app.staff_sessions')
      .values({
        event_id: event.id,
        invitation_id: invitation.id,
        session_hash: hashToken('staff_session', rawSession)!,
        created_at: now,
        last_seen_at: now,
        absolute_expires_at: absolute,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      now,
      action: 'staff_invitation_accepted',
      actorKind: 'staff',
      actorStaffSessionId: session.id,
      eventId: event.id,
      subjectId: invitation.id,
      outcome: 'success',
    });
    // ADR-010 §3: the cookie lives until the earlier of the absolute expiry and the window's end.
    const until = Math.min(absolute.getTime(), checkInWindow(event.starts_at).closes.getTime());
    return { maxAgeSeconds: Math.max(1, Math.floor((until - now.getTime()) / 1000)) };
  });
  if (!result) throw new InvalidLinkError();
  return { sessionId: rawSession, maxAgeSeconds: result.maxAgeSeconds };
}

/** GET /api/staff/session (API #46): the staff device's event, window and anti-forgery token. No participant data. */
export async function staffSessionView(ctx: AppContext, principal: StaffPrincipal) {
  const event = await ctx.db
    .selectFrom('app.events')
    .select(['title', 'starts_at', 'time_zone'])
    .where('id', '=', principal.eventId)
    .executeTakeFirstOrThrow();
  const window = checkInWindow(event.starts_at);
  return {
    eventId: principal.eventId,
    event: { title: event.title, startsAt: event.starts_at.toISOString(), timeZone: event.time_zone },
    windowOpensAt: window.opens.toISOString(),
    windowClosesAt: window.closes.toISOString(),
    csrfToken: csrfTokenFor(ctx.config.CSRF_SECRET, 'staff', principal.staffSessionId),
  };
}
