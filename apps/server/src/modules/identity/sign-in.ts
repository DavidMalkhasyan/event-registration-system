import type { AppContext } from '../../composition/context.js';
import { hashToken, hmac, maskEmail, normalizeEmail, randomToken, safeEqual } from '../../platform/crypto.js';
import { AppError, InvalidLinkError } from '../../platform/errors.js';
import { RULES } from '../../platform/ratelimit.js';
import { decisionTime, withAccountLocks } from '../../platform/tx.js';
import { findToken } from '../access-tokens/tokens.js';
import { recordAudit } from '../audit/audit.js';
import { enqueue } from '../messaging/outbox.js';
import { SESSION_ABSOLUTE_MS } from './sessions.js';

const SIGN_IN_TTL_MS = 15 * 60_000; // FR-ORG-3 c, R55
const PRE_SESSION_MAX_MS = 15 * 60_000;

/** TX-A01: always the same response, whether or not an account exists (FR-ORG-3 a). */
export async function requestSignIn(ctx: AppContext, rawEmail: string, ip: string, correlationId: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const perAddress = await ctx.limiter.hit(RULES.signInPerAddress, email);
  const perIp = await ctx.limiter.hit(RULES.signInPerIp, ip);
  if (!perAddress.allowed || !perIp.allowed) {
    throw new AppError(429, 'rate_limited', { retryAfterSeconds: Math.max(perAddress.retryAfterSeconds, perIp.retryAfterSeconds) });
  }
  await withAccountLocks(ctx.db, [email], async ({ trx, now }) => {
    const account = await trx
      .selectFrom('app.accounts')
      .select('id')
      .where('email', '=', email)
      .forUpdate()
      .executeTakeFirst();
    await trx
      .updateTable('app.sign_in_requests')
      .set({ status: 'replaced', ended_at: now })
      .where('email', '=', email)
      .where('status', '=', 'active')
      .execute();
    const expiresAt = new Date(now.getTime() + SIGN_IN_TTL_MS);
    const request = await trx
      .insertInto('app.sign_in_requests')
      .values({ email, account_id: account?.id ?? null, purpose: 'sign_in', reauth_session_id: null, created_at: now, expires_at: expiresAt })
      .returning('id')
      .executeTakeFirstOrThrow();
    await enqueue(trx, {
      type: 'sign_in',
      logicalKey: `sign_in:${request.id}`,
      recipientEmail: email,
      now,
      horizonAt: new Date(expiresAt.getTime() - 2 * 60_000),
      accountId: account?.id ?? null,
      signInRequestId: request.id,
      correlationId,
    });
  });
}

interface ActiveRequest {
  id: string;
  email: string;
  purpose: 'sign_in' | 'reauth';
  expiresAt: Date;
}

async function activeRequestForToken(ctx: AppContext, rawToken: string): Promise<ActiveRequest | null> {
  const token = await findToken(ctx.db, 'sign_in', rawToken);
  if (!token?.sign_in_request_id) return null;
  const request = await ctx.db
    .selectFrom('app.sign_in_requests')
    .select(['id', 'email', 'purpose', 'status', 'expires_at'])
    .where('id', '=', token.sign_in_request_id)
    .executeTakeFirst();
  if (!request || request.status !== 'active') return null;
  const now = await decisionTime(ctx.db);
  if (now >= request.expires_at) return null;
  return { id: request.id, email: request.email, purpose: request.purpose, expiresAt: request.expires_at };
}

export interface SignInLinkView {
  maskedEmail: string;
  purpose: 'sign_in' | 'reauth';
  preSessionToken: string;
  nonce: string;
}

/** GET /api/links/sign-in: read-only; issues the pre-session token (ADR-010 §4). */
export async function resolveSignInLink(ctx: AppContext, rawToken: string): Promise<SignInLinkView> {
  const request = await activeRequestForToken(ctx, rawToken);
  if (!request) throw new InvalidLinkError();
  const now = await decisionTime(ctx.db);
  const exp = Math.floor(Math.min(now.getTime() + PRE_SESSION_MAX_MS, request.expiresAt.getTime()) / 1000);
  const nonce = randomToken();
  const mac = hmac(ctx.config.PRESESSION_SECRET, 'ers/presession/v1', nonce, request.id, String(exp));
  return { maskedEmail: maskEmail(request.email), purpose: request.purpose, preSessionToken: `v1.1.${exp}.${mac}`, nonce };
}

/** POST /api/links/sign-in/confirm (TX-A02). Returns the raw session ID for the cookie. */
export async function confirmSignIn(
  ctx: AppContext,
  rawToken: string,
  nonce: string | undefined,
  preSessionToken: string | undefined,
): Promise<{ sessionId: string; maxAgeSeconds: number }> {
  const request = await activeRequestForToken(ctx, rawToken);
  if (!request) throw new InvalidLinkError();

  // Pre-session anti-forgery check, bound to this request and this browser's nonce.
  const parts = (preSessionToken ?? '').split('.');
  const now0 = await decisionTime(ctx.db);
  const exp = Number(parts[2]);
  const valid =
    parts.length === 4 &&
    parts[0] === 'v1' &&
    parts[1] === '1' &&
    !!nonce &&
    Number.isFinite(exp) &&
    exp * 1000 > now0.getTime() &&
    safeEqual(parts[3]!, hmac(ctx.config.PRESESSION_SECRET, 'ers/presession/v1', nonce, request.id, String(exp)));
  if (!valid) throw new AppError(403, 'csrf_failed');

  const rawSession = randomToken();
  const result = await withAccountLocks(ctx.db, [request.email], async ({ trx, now }) => {
    // Level 2: the account row, creating it on first sign-in under the address lock (NFR-CON-7 c).
    await trx
      .insertInto('app.accounts')
      .values({ email: request.email, created_at: now })
      .onConflict((oc) => oc.column('email').doNothing())
      .execute();
    const account = await trx
      .selectFrom('app.accounts')
      .select('id')
      .where('email', '=', request.email)
      .forUpdate()
      .executeTakeFirstOrThrow();
    // Level 3: the request row; the first confirmation uses it up (FR-ORG-3 e).
    const current = await trx
      .selectFrom('app.sign_in_requests')
      .select(['status', 'expires_at', 'purpose', 'reauth_session_id'])
      .where('id', '=', request.id)
      .forUpdate()
      .executeTakeFirst();
    if (!current || current.status !== 'active' || now >= current.expires_at) return null;
    await trx
      .updateTable('app.sign_in_requests')
      .set({ status: 'used', used_at: now, ended_at: now, account_id: account.id })
      .where('id', '=', request.id)
      .execute();
    const absolute = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    const session = await trx
      .insertInto('app.organizer_sessions')
      .values({
        account_id: account.id,
        session_hash: hashToken('organizer_session', rawSession)!,
        created_from_request_id: request.id,
        created_at: now,
        authenticated_at: now,
        last_seen_at: now,
        absolute_expires_at: absolute,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (current.purpose === 'reauth' && current.reauth_session_id) {
      await trx
        .updateTable('app.organizer_sessions')
        .set({ revoked_at: now, revoke_reason: 'reauth_replaced' })
        .where('id', '=', current.reauth_session_id)
        .where('revoked_at', 'is', null)
        .execute();
    }
    await recordAudit(trx, {
      now,
      action: 'signin_confirmed',
      actorKind: 'account',
      actorAccountId: account.id,
      subjectId: session.id,
      outcome: 'success',
    });
    return { maxAgeSeconds: Math.floor(SESSION_ABSOLUTE_MS / 1000) };
  });
  if (!result) throw new InvalidLinkError();
  return { sessionId: rawSession, maxAgeSeconds: result.maxAgeSeconds };
}

export function safeTokensEqual(a: string, b: string): boolean {
  return safeEqual(a, b);
}
