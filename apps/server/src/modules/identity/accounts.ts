import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { hashToken, maskEmail, normalizeEmail, randomToken } from '../../platform/crypto.js';
import { AppError, InvalidLinkError } from '../../platform/errors.js';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  dummyPasswordHash,
  hashPassword,
  verifyPassword,
} from '../../platform/passwords.js';
import { RULES } from '../../platform/ratelimit.js';
import { decisionTime, withAccountLocks, type Tx } from '../../platform/tx.js';
import { findToken } from '../access-tokens/tokens.js';
import { recordAudit } from '../audit/audit.js';
import { enqueue } from '../messaging/outbox.js';
import { SESSION_ABSOLUTE_MS, sessionStillValid, type OrganizerPrincipal } from './sessions.js';
import { insertSignInRequest } from './sign-in.js';

// Organizer accounts with passwords (K-709, amendment A-3, PD-89). Organizations register with a
// contact person and a password; the address is confirmed by an emailed link; the organization then
// waits for a Super Admin's approval (K-710) before it can create or manage events. Passwords are
// Argon2id (platform/passwords.ts). Responses never reveal whether an address has an account.

export const passwordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

export const organizationRegistrationSchema = z
  .object({
    organizationName: z.string().trim().min(1).max(200),
    contactName: z.string().trim().min(1).max(200),
    email: z.email().max(254),
    password: passwordSchema,
    description: z.string().trim().max(2000).optional(),
  })
  .strict();

export const passwordSignInSchema = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(PASSWORD_MAX) })
  .strict();

async function limit(ctx: AppContext, rules: [rule: (typeof RULES)[keyof typeof RULES], key: string][]) {
  let retry = 0;
  let allowed = true;
  for (const [rule, key] of rules) {
    const r = await ctx.limiter.hit(rule, key);
    if (!r.allowed) {
      allowed = false;
      retry = Math.max(retry, r.retryAfterSeconds);
    }
  }
  if (!allowed) throw new AppError(429, 'rate_limited', { retryAfterSeconds: retry });
}

/**
 * POST /api/organizations/registrations. Always 202 with the same body. A new address gets an account
 * (with its password hash), a `pending_verification` organization owned by it, and a verification
 * link; an address that already has an account gets a notice instead, and nothing is changed.
 */
export async function registerOrganization(
  ctx: AppContext,
  input: z.infer<typeof organizationRegistrationSchema>,
  ip: string,
  correlationId: string,
): Promise<void> {
  const email = normalizeEmail(input.email);
  await limit(ctx, [
    [RULES.organizationRegistrationPerIp, ip],
    [RULES.organizationRegistrationPerAddress, email],
  ]);
  // Hashed before the lock (CPU), and for existing addresses too, so both paths take as long.
  const passwordHash = await hashPassword(input.password);
  await withAccountLocks(ctx.db, [email], async ({ trx, now }) => {
    const existing = await trx
      .selectFrom('app.accounts')
      .select('id')
      .where('email', '=', email)
      .forUpdate()
      .executeTakeFirst();
    if (existing) {
      await enqueue(trx, {
        type: 'account_exists_notice',
        logicalKey: `account_exists_notice:${existing.id}:${randomToken()}`,
        recipientEmail: email,
        now,
        accountId: existing.id,
        correlationId,
      });
      return;
    }
    const account = await trx
      .insertInto('app.accounts')
      .values({
        email,
        created_at: now,
        display_name: input.contactName,
        password_hash: passwordHash,
        password_changed_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const organization = await trx
      .insertInto('app.organizations')
      .values({
        name: input.organizationName,
        description: input.description || null,
        status: 'pending_verification',
        created_at: now,
        updated_at: now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('app.organization_memberships')
      .values({ organization_id: organization.id, account_id: account.id, role: 'owner', created_at: now })
      .execute();
    await insertSignInRequest(trx, now, {
      email,
      accountId: account.id,
      purpose: 'verify_email',
      reauthSessionId: null,
      correlationId,
    });
    await recordAudit(trx, {
      now,
      action: 'organization_registered',
      actorKind: 'account',
      actorAccountId: account.id,
      subjectId: organization.id,
      outcome: 'pending_verification',
    });
  });
}

/** An address is confirmed: the account is verified and its pending organizations await approval. */
async function markEmailVerified(trx: Tx, accountId: string, now: Date): Promise<void> {
  await trx
    .updateTable('app.accounts')
    .set({ email_verified_at: now })
    .where('id', '=', accountId)
    .where('email_verified_at', 'is', null)
    .execute();
  await trx
    .updateTable('app.organizations')
    .set({ status: 'pending_approval', email_verified_at: now, submitted_at: now, updated_at: now })
    .where('status', '=', 'pending_verification')
    .where('id', 'in', (eb) =>
      eb
        .selectFrom('app.organization_memberships')
        .select('organization_id')
        .where('account_id', '=', accountId)
        .where('role', '=', 'owner'),
    )
    .execute();
}

type AccountLinkType = 'account_verification' | 'password_reset';
const PURPOSE: Record<AccountLinkType, 'verify_email' | 'reset_password'> = {
  account_verification: 'verify_email',
  password_reset: 'reset_password',
};

async function activeAccountRequest(ctx: AppContext, type: AccountLinkType, raw: string) {
  const token = await findToken(ctx.db, type, raw);
  if (!token?.sign_in_request_id) return null;
  const request = await ctx.db
    .selectFrom('app.sign_in_requests')
    .select(['id', 'email', 'purpose', 'status', 'expires_at', 'account_id'])
    .where('id', '=', token.sign_in_request_id)
    .executeTakeFirst();
  if (!request || request.status !== 'active' || request.purpose !== PURPOSE[type] || !request.account_id)
    return null;
  if ((await decisionTime(ctx.db)) >= request.expires_at) return null;
  return { id: request.id, email: request.email, accountId: request.account_id };
}

/** GET /api/links/account-verification and /password-reset: read-only views of a valid link. */
export async function resolveAccountLink(ctx: AppContext, type: AccountLinkType, raw: string) {
  const request = await activeAccountRequest(ctx, type, raw);
  if (!request) throw new InvalidLinkError();
  const org = await ctx.db
    .selectFrom('app.organization_memberships as m')
    .innerJoin('app.organizations as o', 'o.id', 'm.organization_id')
    .select(['o.name'])
    .where('m.account_id', '=', request.accountId)
    .where('m.role', '=', 'owner')
    .orderBy('o.created_at')
    .executeTakeFirst();
  return { maskedEmail: maskEmail(request.email), organizationName: org?.name ?? null };
}

/** Uses up the link's request under the address lock; null when it is no longer usable. */
async function useRequest(trx: Tx, requestId: string, now: Date): Promise<boolean> {
  const current = await trx
    .selectFrom('app.sign_in_requests')
    .select(['status', 'expires_at'])
    .where('id', '=', requestId)
    .forUpdate()
    .executeTakeFirst();
  if (!current || current.status !== 'active' || now >= current.expires_at) return false;
  await trx
    .updateTable('app.sign_in_requests')
    .set({ status: 'used', used_at: now, ended_at: now })
    .where('id', '=', requestId)
    .execute();
  return true;
}

/** POST /api/links/account-verification/confirm: the address is confirmed; the organization awaits approval. */
export async function confirmAccountVerification(
  ctx: AppContext,
  raw: string,
): Promise<{ state: 'awaiting_approval' }> {
  const request = await activeAccountRequest(ctx, 'account_verification', raw);
  if (!request) throw new InvalidLinkError();
  const ok = await withAccountLocks(ctx.db, [request.email], async ({ trx, now }) => {
    if (!(await useRequest(trx, request.id, now))) return false;
    await markEmailVerified(trx, request.accountId, now);
    await recordAudit(trx, {
      now,
      action: 'account_email_verified',
      actorKind: 'account',
      actorAccountId: request.accountId,
      outcome: 'success',
    });
    return true;
  });
  if (!ok) throw new InvalidLinkError();
  return { state: 'awaiting_approval' };
}

/**
 * POST /api/auth/password-reset-requests. Always 202. An existing account gets a reset link, also when
 * it has no password yet: that is how organizers from before K-709 set their first password.
 */
export async function requestPasswordReset(
  ctx: AppContext,
  rawEmail: string,
  ip: string,
  correlationId: string,
): Promise<void> {
  const email = normalizeEmail(rawEmail);
  await limit(ctx, [
    [RULES.passwordResetPerAddress, email],
    [RULES.signInPerIp, ip],
  ]);
  await withAccountLocks(ctx.db, [email], async ({ trx, now }) => {
    const account = await trx
      .selectFrom('app.accounts')
      .select('id')
      .where('email', '=', email)
      .forUpdate()
      .executeTakeFirst();
    if (!account) return;
    await insertSignInRequest(trx, now, {
      email,
      accountId: account.id,
      purpose: 'reset_password',
      reauthSessionId: null,
      correlationId,
    });
    await recordAudit(trx, {
      now,
      action: 'password_reset_requested',
      actorKind: 'account',
      actorAccountId: account.id,
      outcome: 'success',
    });
  });
}

/**
 * POST /api/links/password-reset/confirm: sets the new password, confirms the address (the link proved
 * it), and ends every session of the account, so a stolen session or old password stops working.
 */
export async function confirmPasswordReset(
  ctx: AppContext,
  raw: string,
  body: unknown,
): Promise<{ state: 'password_changed' }> {
  const request = await activeAccountRequest(ctx, 'password_reset', raw);
  if (!request) throw new InvalidLinkError();
  const { password } = z.object({ password: passwordSchema }).strict().parse(body);
  const passwordHash = await hashPassword(password);
  const ok = await withAccountLocks(ctx.db, [request.email], async ({ trx, now }) => {
    if (!(await useRequest(trx, request.id, now))) return false;
    await trx
      .updateTable('app.accounts')
      .set({ password_hash: passwordHash, password_changed_at: now })
      .where('id', '=', request.accountId)
      .execute();
    await markEmailVerified(trx, request.accountId, now);
    await trx
      .updateTable('app.organizer_sessions')
      .set({ revoked_at: now, revoke_reason: 'password_reset' })
      .where('account_id', '=', request.accountId)
      .where('revoked_at', 'is', null)
      .execute();
    await recordAudit(trx, {
      now,
      action: 'password_changed',
      actorKind: 'account',
      actorAccountId: request.accountId,
      outcome: 'success',
    });
    return true;
  });
  if (!ok) throw new InvalidLinkError();
  return { state: 'password_changed' };
}

/**
 * POST /api/auth/password-sessions. One answer, 401 invalid_credentials, for an unknown address, a
 * wrong password and an account without a password (each path verifies one Argon2id hash). Only the
 * holder of the right password learns that the address still needs verification (403).
 */
export async function passwordSignIn(
  ctx: AppContext,
  input: z.infer<typeof passwordSignInSchema>,
  ip: string,
): Promise<{ sessionId: string; maxAgeSeconds: number }> {
  const email = normalizeEmail(input.email);
  await limit(ctx, [
    [RULES.passwordSignInPerAddress, email],
    [RULES.passwordSignInPerIp, ip],
  ]);
  const account = await ctx.db
    .selectFrom('app.accounts')
    .select(['id', 'password_hash', 'email_verified_at'])
    .where('email', '=', email)
    .executeTakeFirst();
  const matches = await verifyPassword(account?.password_hash ?? (await dummyPasswordHash()), input.password);
  if (!account?.password_hash || !matches) throw new AppError(401, 'invalid_credentials');
  if (!account.email_verified_at) throw new AppError(403, 'email_verification_required');

  const rawSession = randomToken();
  const created = await withAccountLocks(ctx.db, [email], async ({ trx, now }) => {
    // A reset that finished after the check above revoked every session; this one must not outlive it.
    const current = await trx
      .selectFrom('app.accounts')
      .select('password_hash')
      .where('id', '=', account.id)
      .forUpdate()
      .executeTakeFirst();
    if (current?.password_hash !== account.password_hash) return false;
    const session = await trx
      .insertInto('app.organizer_sessions')
      .values({
        account_id: account.id,
        session_hash: hashToken('organizer_session', rawSession)!,
        created_from_request_id: null,
        auth_method: 'password',
        created_at: now,
        authenticated_at: now,
        last_seen_at: now,
        absolute_expires_at: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      now,
      action: 'signin_password',
      actorKind: 'account',
      actorAccountId: account.id,
      subjectId: session.id,
      outcome: 'success',
    });
    return true;
  });
  if (!created) throw new AppError(401, 'invalid_credentials');
  return { sessionId: rawSession, maxAgeSeconds: Math.floor(SESSION_ABSOLUTE_MS / 1000) };
}

/** POST /api/auth/password-reauthentication (FR-ORG-5 with passwords): the session counts as recent again. */
export async function passwordReauthentication(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  body: unknown,
): Promise<void> {
  const { password } = z
    .object({ password: z.string().min(1).max(PASSWORD_MAX) })
    .strict()
    .parse(body);
  await limit(ctx, [[RULES.reauthPerAccount, principal.accountId]]);
  const account = await ctx.db
    .selectFrom('app.accounts')
    .select('password_hash')
    .where('id', '=', principal.accountId)
    .executeTakeFirst();
  const matches = await verifyPassword(account?.password_hash ?? (await dummyPasswordHash()), password);
  if (!account?.password_hash || !matches) throw new AppError(401, 'invalid_credentials');
  const ok = await withAccountLocks(ctx.db, [principal.email], async ({ trx, now }) => {
    if (!(await sessionStillValid(trx, principal.sessionId, now))) return false;
    await trx
      .updateTable('app.organizer_sessions')
      .set({ authenticated_at: now })
      .where('id', '=', principal.sessionId)
      .execute();
    await recordAudit(trx, {
      now,
      action: 'reauth_password',
      actorKind: 'account',
      actorAccountId: principal.accountId,
      outcome: 'success',
    });
    return true;
  });
  if (!ok) throw new AppError(401, 'unauthenticated');
}
