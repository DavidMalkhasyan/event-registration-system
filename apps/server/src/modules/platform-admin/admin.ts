import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { hashToken, normalizeEmail, randomToken, safeEqual } from '../../platform/crypto.js';
import { AppError, problems } from '../../platform/errors.js';
import { PASSWORD_MAX, dummyPasswordHash, verifyPassword } from '../../platform/passwords.js';
import { RULES } from '../../platform/ratelimit.js';
import type { OrganizationStatus } from '../../platform/schema.js';
import { decisionTime } from '../../platform/tx.js';
import { recordAudit } from '../audit/audit.js';
import { enqueue } from '../messaging/outbox.js';
import { csrfTokenFor } from '../identity/sessions.js';

// The Super Admin area (K-710, amendment A-3, ADR-022, PD-90). Super Admins are not organizer
// accounts: their own table (created only by the operator command `pnpm admin:create`), their own
// sessions and cookie (SameSite=Strict), CSRF tokens of their own kind, and every decision audited
// with the admin's ID. They decide on organizations; they never act on events or participants.

export const ADMIN_COOKIE = '__Host-ers_admin';
export const ADMIN_SESSION_ABSOLUTE_MS = 12 * 3_600_000;
export const ADMIN_SESSION_IDLE_MS = 2 * 3_600_000;
const LAST_SEEN_THROTTLE_MS = 60_000;

export interface AdminPrincipal {
  sessionId: string;
  adminId: string;
  email: string;
  displayName: string;
}

export const adminSignInSchema = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(PASSWORD_MAX) })
  .strict();

/** POST /api/admin/sessions. One answer for an unknown address, a wrong password and a disabled admin. */
export async function adminSignIn(
  ctx: AppContext,
  input: z.infer<typeof adminSignInSchema>,
  ip: string,
): Promise<{ sessionId: string; maxAgeSeconds: number }> {
  const email = normalizeEmail(input.email);
  for (const [rule, key] of [
    [RULES.adminSignInPerAddress, email],
    [RULES.adminSignInPerIp, ip],
  ] as const) {
    const r = await ctx.limiter.hit(rule, key);
    if (!r.allowed) throw new AppError(429, 'rate_limited', { retryAfterSeconds: r.retryAfterSeconds });
  }
  const admin = await ctx.db
    .selectFrom('app.platform_admins')
    .select(['id', 'password_hash', 'disabled_at'])
    .where('email', '=', email)
    .executeTakeFirst();
  const matches = await verifyPassword(admin?.password_hash ?? (await dummyPasswordHash()), input.password);
  if (!admin || !matches || admin.disabled_at) throw new AppError(401, 'invalid_credentials');
  const raw = randomToken();
  await ctx.db.transaction().execute(async (trx) => {
    const now = await decisionTime(trx);
    const session = await trx
      .insertInto('app.platform_admin_sessions')
      .values({
        admin_id: admin.id,
        session_hash: hashToken('admin_session', raw)!,
        created_at: now,
        last_seen_at: now,
        absolute_expires_at: new Date(now.getTime() + ADMIN_SESSION_ABSOLUTE_MS),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await recordAudit(trx, {
      now,
      action: 'admin_signin',
      actorKind: 'platform_admin',
      actorAdminId: admin.id,
      subjectId: session.id,
      outcome: 'success',
    });
  });
  return { sessionId: raw, maxAgeSeconds: Math.floor(ADMIN_SESSION_ABSOLUTE_MS / 1000) };
}

async function resolveAdmin(ctx: AppContext, request: FastifyRequest): Promise<AdminPrincipal | null> {
  const raw = request.cookies[ADMIN_COOKIE];
  const hash = raw ? hashToken('admin_session', raw) : null;
  if (!hash) return null;
  const row = await ctx.db
    .selectFrom('app.platform_admin_sessions as s')
    .innerJoin('app.platform_admins as a', 'a.id', 's.admin_id')
    .select([
      's.id',
      's.admin_id',
      's.last_seen_at',
      's.absolute_expires_at',
      's.revoked_at',
      'a.email',
      'a.display_name',
      'a.disabled_at',
    ])
    .where('s.session_hash', '=', hash)
    .executeTakeFirst();
  if (!row || row.revoked_at || row.disabled_at) return null;
  const now = await decisionTime(ctx.db);
  if (now >= row.absolute_expires_at || now.getTime() >= row.last_seen_at.getTime() + ADMIN_SESSION_IDLE_MS)
    return null;
  if (now.getTime() - row.last_seen_at.getTime() > LAST_SEEN_THROTTLE_MS)
    await ctx.db
      .updateTable('app.platform_admin_sessions')
      .set({ last_seen_at: now })
      .where('id', '=', row.id)
      .execute();
  return { sessionId: row.id, adminId: row.admin_id, email: row.email, displayName: row.display_name };
}

/** Route guard for /api/admin/*: a Super Admin session; state changes also need its CSRF header. */
export async function requireAdmin(
  ctx: AppContext,
  request: FastifyRequest,
  options: { csrf: boolean },
): Promise<AdminPrincipal> {
  const principal = await resolveAdmin(ctx, request);
  if (!principal) throw new AppError(401, 'unauthenticated');
  if (options.csrf) {
    const header = request.headers['x-csrf-token'];
    const expected = csrfTokenFor(ctx.config.CSRF_SECRET, 'admin', principal.sessionId);
    if (typeof header !== 'string' || !safeEqual(header, expected)) throw new AppError(403, 'csrf_failed');
  }
  return principal;
}

export async function adminSignOut(ctx: AppContext, principal: AdminPrincipal): Promise<void> {
  await ctx.db
    .updateTable('app.platform_admin_sessions')
    .set({ revoked_at: await decisionTime(ctx.db), revoke_reason: 'sign_out' })
    .where('id', '=', principal.sessionId)
    .where('revoked_at', 'is', null)
    .execute();
}

// ---------------------------------------------------------------- organizations

const STATUSES = ['pending_verification', 'pending_approval', 'active', 'rejected', 'suspended'] as const;
export const organizationListSchema = z.object({ status: z.enum(STATUSES).optional() }).strict();

/** GET /api/admin/organizations: applications and organizations, with their owners' contacts. */
export async function listOrganizations(ctx: AppContext, status: OrganizationStatus | undefined) {
  let query = ctx.db
    .selectFrom('app.organizations as o')
    .select((eb) => [
      'o.id',
      'o.name',
      'o.description',
      'o.status',
      'o.created_at',
      'o.submitted_at',
      'o.decided_at',
      'o.decision_reason',
      eb
        .selectFrom('app.organization_memberships as m')
        .select(eb.fn.countAll<string>().as('n'))
        .whereRef('m.organization_id', '=', 'o.id')
        .as('member_count'),
      eb
        .selectFrom('app.events as e')
        .select(eb.fn.countAll<string>().as('n'))
        .whereRef('e.organization_id', '=', 'o.id')
        .as('event_count'),
    ])
    .orderBy('o.submitted_at', (ob) => ob.desc().nullsLast())
    .orderBy('o.created_at', 'desc')
    .limit(500);
  if (status) query = query.where('o.status', '=', status);
  const rows = await query.execute();
  const owners = rows.length
    ? await ctx.db
        .selectFrom('app.organization_memberships as m')
        .innerJoin('app.accounts as a', 'a.id', 'm.account_id')
        .select(['m.organization_id', 'a.email', 'a.display_name', 'a.email_verified_at'])
        .where('m.role', '=', 'owner')
        .where(
          'm.organization_id',
          'in',
          rows.map((r) => r.id),
        )
        .execute()
    : [];
  const counts = await ctx.db
    .selectFrom('app.organizations')
    .select(['status', (eb) => eb.fn.countAll<string>().as('n')])
    .groupBy('status')
    .execute();
  return {
    counts: Object.fromEntries(STATUSES.map((s) => [s, Number(counts.find((c) => c.status === s)?.n ?? 0)])),
    organizations: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      submittedAt: r.submitted_at?.toISOString() ?? null,
      decidedAt: r.decided_at?.toISOString() ?? null,
      decisionReason: r.decision_reason,
      memberCount: Number(r.member_count ?? 0),
      eventCount: Number(r.event_count ?? 0),
      owners: owners
        .filter((o) => o.organization_id === r.id)
        .map((o) => ({ email: o.email, name: o.display_name, emailVerified: !!o.email_verified_at })),
    })),
  };
}

/** GET /api/admin/organizations/:id/audit: the decisions and registration steps of one organization. */
export async function organizationAudit(ctx: AppContext, organizationId: string) {
  const rows = await ctx.db
    .selectFrom('app.audit_records as r')
    .leftJoin('app.platform_admins as a', 'a.id', 'r.actor_admin_id')
    .select(['r.id', 'r.occurred_at', 'r.action', 'r.actor_kind', 'r.outcome', 'r.details', 'a.display_name'])
    .where('r.subject_id', '=', organizationId)
    .orderBy('r.occurred_at', 'desc')
    .limit(100)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    occurredAt: r.occurred_at.toISOString(),
    action: r.action,
    actorKind: r.actor_kind,
    adminName: r.display_name,
    outcome: r.outcome,
    reason: typeof r.details.reason === 'string' ? r.details.reason : null,
  }));
}

export type Decision = 'approve' | 'reject' | 'suspend' | 'reinstate';

// From which state each decision is possible, and where it leads. Reasons are required for the
// decisions that take access away; they are sent to the owners.
const TRANSITIONS: Record<Decision, { from: OrganizationStatus; to: OrganizationStatus; reason: boolean }> = {
  approve: { from: 'pending_approval', to: 'active', reason: false },
  reject: { from: 'pending_approval', to: 'rejected', reason: true },
  suspend: { from: 'active', to: 'suspended', reason: true },
  reinstate: { from: 'suspended', to: 'active', reason: false },
};

export const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'suspend', 'reinstate']),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();

/**
 * POST /api/admin/organizations/:id/decisions. The organization row is locked; a decision that does
 * not fit its current state is refused (409 invalid_transition), so two admins deciding at once
 * cannot both succeed. The owners are told through the outbox, in the same transaction.
 */
export async function decideOrganization(
  ctx: AppContext,
  principal: AdminPrincipal,
  organizationId: string,
  input: z.infer<typeof decisionSchema>,
  correlationId: string,
): Promise<{ status: OrganizationStatus }> {
  const rule = TRANSITIONS[input.decision];
  const reason = input.reason || null;
  if (rule.reason && !reason) throw problems.validation([{ field: 'reason', code: 'required' }]);
  return ctx.db.transaction().execute(async (trx) => {
    const now = await decisionTime(trx);
    const org = await trx
      .selectFrom('app.organizations')
      .select(['id', 'name', 'status'])
      .where('id', '=', organizationId)
      .forUpdate()
      .executeTakeFirst();
    if (!org) throw new AppError(404, 'not_found');
    if (org.status !== rule.from) throw new AppError(409, 'invalid_transition', { status: org.status });
    await trx
      .updateTable('app.organizations')
      .set({
        status: rule.to,
        decided_at: now,
        decided_by_admin_id: principal.adminId,
        decision_reason: reason,
        updated_at: now,
      })
      .where('id', '=', org.id)
      .where('status', '=', rule.from) // with the row lock above, a second guard against a lost update
      .execute();
    await recordAudit(trx, {
      now,
      action: `organization_${input.decision}`,
      actorKind: 'platform_admin',
      actorAdminId: principal.adminId,
      subjectId: org.id,
      outcome: rule.to,
      details: reason ? { from: org.status, reason } : { from: org.status },
    });
    const owners = await trx
      .selectFrom('app.organization_memberships as m')
      .innerJoin('app.accounts as a', 'a.id', 'm.account_id')
      .select(['a.id', 'a.email'])
      .where('m.organization_id', '=', org.id)
      .where('m.role', '=', 'owner')
      .execute();
    for (const owner of owners)
      await enqueue(trx, {
        type: 'organization_decision',
        logicalKey: `organization_decision:${org.id}:${owner.id}:${randomToken()}`,
        recipientEmail: owner.email,
        now,
        accountId: owner.id,
        correlationId,
        payload: { decision: input.decision, organizationName: org.name, reason },
      });
    return { status: rule.to };
  });
}
