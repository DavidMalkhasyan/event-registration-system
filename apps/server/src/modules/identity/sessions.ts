import type { FastifyRequest } from 'fastify';
import type { AppContext } from '../../composition/context.js';
import { hashToken, hmac, safeEqual } from '../../platform/crypto.js';
import { AppError } from '../../platform/errors.js';
import { decisionTime, type Tx } from '../../platform/tx.js';
import { STAFF_COOKIE, resolveStaff } from './staff-sessions.js';

// FR-ORG-4, ADR-010 §3 and §5.
export const ORG_COOKIE = '__Host-ers_org';
export const PRESESSION_COOKIE = '__Host-ers_presession';
export const SESSION_ABSOLUTE_MS = 720 * 3_600_000;
export const SESSION_IDLE_MS = 168 * 3_600_000;
const LAST_SEEN_THROTTLE_MS = 5 * 60_000;
export const RECENT_AUTH_MS = 15 * 60_000;

export interface OrganizerPrincipal {
  sessionId: string;
  accountId: string;
  email: string;
  authenticatedAt: Date;
  absoluteExpiresAt: Date;
}

export function csrfTokenFor(secret: string, kind: 'org' | 'staff', sessionId: string): string {
  return `v1.1.${hmac(secret, 'ers/csrf/v1', kind, sessionId)}`;
}

/** Resolves the organizer session cookie (hash lookup, revocation, idle and absolute expiry). */
export async function resolveOrganizer(
  ctx: AppContext,
  request: FastifyRequest,
): Promise<OrganizerPrincipal | null> {
  const raw = request.cookies[ORG_COOKIE];
  if (!raw) return null;
  const hash = hashToken('organizer_session', raw);
  if (!hash) return null;
  const row = await ctx.db
    .selectFrom('app.organizer_sessions as s')
    .innerJoin('app.accounts as a', 'a.id', 's.account_id')
    .select([
      's.id',
      's.account_id',
      's.authenticated_at',
      's.last_seen_at',
      's.absolute_expires_at',
      's.revoked_at',
      'a.email',
    ])
    .where('s.session_hash', '=', hash)
    .executeTakeFirst();
  if (!row || row.revoked_at) return null;
  const now = await decisionTime(ctx.db);
  if (now >= row.absolute_expires_at || now.getTime() >= row.last_seen_at.getTime() + SESSION_IDLE_MS)
    return null;
  if (now.getTime() - row.last_seen_at.getTime() > LAST_SEEN_THROTTLE_MS) {
    // Own single-row transaction, never inside an event lock (FR-ORG-4, NFR-CON-7 g).
    await ctx.db
      .updateTable('app.organizer_sessions')
      .set({ last_seen_at: now })
      .where('id', '=', row.id)
      .where('last_seen_at', '<', new Date(now.getTime() - LAST_SEEN_THROTTLE_MS))
      .execute();
  }
  return {
    sessionId: row.id,
    accountId: row.account_id,
    email: row.email,
    authenticatedAt: row.authenticated_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}

/** Route guard: organizer session required; state changes also need the CSRF header (AC-85). */
export async function requireOrganizer(
  ctx: AppContext,
  request: FastifyRequest,
  options: { csrf: boolean },
): Promise<OrganizerPrincipal> {
  const principal = await resolveOrganizer(ctx, request);
  if (!principal) {
    // API_DESIGN §5.1 (AC-26, AC-151): a staff-only caller is authenticated, but not allowed here.
    if (request.cookies[STAFF_COOKIE] && (await resolveStaff(ctx, request)))
      throw new AppError(403, 'forbidden');
    throw new AppError(401, 'unauthenticated');
  }
  if (options.csrf) {
    const header = request.headers['x-csrf-token'];
    const expected = csrfTokenFor(ctx.config.CSRF_SECRET, 'org', principal.sessionId);
    if (typeof header !== 'string' || !safeEqual(header, expected)) throw new AppError(403, 'csrf_failed');
  }
  return principal;
}

export type RecentAuthentication = 'recent' | 'unauthenticated' | 'reauthentication_required';

/**
 * FR-ORG-5, ADR-010 §8: whether the session was authenticated within the last 15 minutes.
 * Must run INSIDE the locked transaction of the protected operation (event cancellation and
 * deletion: after the event lock), with that transaction's decision time `now`, never with a
 * browser timestamp or an earlier check. The session row is read FOR SHARE, so a concurrent
 * re-authentication (which revokes this session in TX-A02) is serialized with the operation:
 * whichever commits first wins. Recent means `now < authenticated_at + 15 min`; at exactly
 * 15 minutes, re-authentication is required.
 */
export async function recentAuthentication(
  trx: Tx,
  sessionId: string,
  now: Date,
): Promise<RecentAuthentication> {
  const row = await trx
    .selectFrom('app.organizer_sessions')
    .select(['revoked_at', 'absolute_expires_at', 'authenticated_at'])
    .where('id', '=', sessionId)
    .forShare()
    .executeTakeFirst();
  if (!row || row.revoked_at || now >= row.absolute_expires_at) return 'unauthenticated';
  return now.getTime() < row.authenticated_at.getTime() + RECENT_AUTH_MS
    ? 'recent'
    : 'reauthentication_required';
}

/** Throws the matching 401 unless the session is recently authenticated (see recentAuthentication). */
export async function requireRecentAuthentication(trx: Tx, sessionId: string, now: Date): Promise<void> {
  const status = await recentAuthentication(trx, sessionId, now);
  if (status === 'unauthenticated') throw new AppError(401, 'unauthenticated');
  if (status === 'reauthentication_required') throw new AppError(401, 'reauthentication_required');
}

/** Re-check after the event lock (FR-ORG-4: revocation applies to every later authorization check). */
export async function sessionStillValid(trx: Tx, sessionId: string, now: Date): Promise<boolean> {
  const row = await trx
    .selectFrom('app.organizer_sessions')
    .select(['revoked_at', 'absolute_expires_at'])
    .where('id', '=', sessionId)
    .executeTakeFirst();
  return !!row && !row.revoked_at && now < row.absolute_expires_at;
}
