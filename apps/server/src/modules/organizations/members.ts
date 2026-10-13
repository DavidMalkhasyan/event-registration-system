import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { normalizeEmail, randomToken } from '../../platform/crypto.js';
import type { Database } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { RULES } from '../../platform/ratelimit.js';
import type { OrganizationRole } from '../../platform/schema.js';
import { decisionTime, type Tx } from '../../platform/tx.js';
import { recordAudit } from '../audit/audit.js';
import { enqueue } from '../messaging/outbox.js';
import type { OrganizerPrincipal } from '../identity/sessions.js';

// Several organizers per organization (K-716, amendment A-3, PD-94). Roles: an owner manages
// everything, including owners; an admin manages events and the members who are not owners; a member
// manages events. Every organization keeps at least one owner. Invitations go to an email address and
// are accepted by the signed-in account whose verified address it is; nothing in the email grants
// access by itself. Membership changes lock the organization row, so concurrent changes serialize.

export const INVITATION_DAYS = 14;

export const inviteSchema = z
  .object({ email: z.email().max(254), role: z.enum(['admin', 'member']) })
  .strict();
export const roleChangeSchema = z.object({ role: z.enum(['owner', 'admin', 'member']) }).strict();

const uuid = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw new AppError(404, 'not_found');
};

interface Acting {
  role: OrganizationRole;
  name: string;
}

/**
 * Locks the organization and returns the caller's role in it. 404 when the caller is not a member (an
 * organization one does not belong to looks unknown); 403 organization_not_active when it is inactive.
 */
async function acting(trx: Tx, organizationId: string, accountId: string): Promise<Acting> {
  uuid(organizationId);
  const org = await trx
    .selectFrom('app.organizations')
    .select(['name', 'status'])
    .where('id', '=', organizationId)
    .forUpdate()
    .executeTakeFirst();
  const membership = org
    ? await trx
        .selectFrom('app.organization_memberships')
        .select('role')
        .where('organization_id', '=', organizationId)
        .where('account_id', '=', accountId)
        .executeTakeFirst()
    : undefined;
  if (!org || !membership) throw new AppError(404, 'not_found');
  if (org.status !== 'active') throw new AppError(403, 'organization_not_active');
  return { role: membership.role, name: org.name };
}

function requireManager(role: OrganizationRole) {
  if (role === 'member') throw new AppError(403, 'forbidden');
}

async function owners(trx: Tx, organizationId: string): Promise<number> {
  const row = await trx
    .selectFrom('app.organization_memberships')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('organization_id', '=', organizationId)
    .where('role', '=', 'owner')
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

/** GET /api/organizations/:id/members: members and pending invitations, for every member. */
export async function listMembers(ctx: AppContext, principal: OrganizerPrincipal, organizationId: string) {
  return ctx.db.transaction().execute(async (trx) => {
    const me = await acting(trx, organizationId, principal.accountId);
    const now = await decisionTime(trx);
    const members = await trx
      .selectFrom('app.organization_memberships as m')
      .innerJoin('app.accounts as a', 'a.id', 'm.account_id')
      .select(['a.id', 'a.email', 'a.display_name', 'm.role', 'm.created_at'])
      .where('m.organization_id', '=', organizationId)
      .orderBy('m.created_at')
      .execute();
    const invitations = await trx
      .selectFrom('app.organization_invitations')
      .select(['id', 'email', 'role', 'created_at', 'expires_at'])
      .where('organization_id', '=', organizationId)
      .where('status', '=', 'pending')
      .where('expires_at', '>', now)
      .orderBy('created_at')
      .execute();
    return {
      organization: { id: organizationId, name: me.name },
      yourRole: me.role,
      members: members.map((m) => ({
        accountId: m.id,
        email: m.email,
        name: m.display_name,
        role: m.role,
        since: m.created_at.toISOString(),
        you: m.id === principal.accountId,
      })),
      invitations:
        me.role === 'member'
          ? []
          : invitations.map((i) => ({
              id: i.id,
              email: i.email,
              role: i.role,
              sentAt: i.created_at.toISOString(),
              expiresAt: i.expires_at.toISOString(),
            })),
    };
  });
}

/**
 * POST /api/organizations/:id/invitations. A repeated invitation of the same address replaces the
 * pending one (new role and expiry) and sends the email again.
 */
export async function invite(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  organizationId: string,
  input: z.infer<typeof inviteSchema>,
  correlationId: string,
) {
  const email = normalizeEmail(input.email);
  const r = await ctx.limiter.hit(RULES.invitationsPerAccount, principal.accountId);
  if (!r.allowed) throw new AppError(429, 'rate_limited', { retryAfterSeconds: r.retryAfterSeconds });
  return ctx.db.transaction().execute(async (trx) => {
    const me = await acting(trx, organizationId, principal.accountId);
    requireManager(me.role);
    const now = await decisionTime(trx);
    const already = await trx
      .selectFrom('app.organization_memberships as m')
      .innerJoin('app.accounts as a', 'a.id', 'm.account_id')
      .select('a.id')
      .where('m.organization_id', '=', organizationId)
      .where('a.email', '=', email)
      .executeTakeFirst();
    if (already) throw new AppError(409, 'already_member');
    await trx
      .updateTable('app.organization_invitations')
      .set({ status: 'revoked', decided_at: now })
      .where('organization_id', '=', organizationId)
      .where('email', '=', email)
      .where('status', '=', 'pending')
      .execute();
    const invitation = await trx
      .insertInto('app.organization_invitations')
      .values({
        organization_id: organizationId,
        email,
        role: input.role,
        invited_by_account_id: principal.accountId,
        created_at: now,
        expires_at: new Date(now.getTime() + INVITATION_DAYS * 86_400_000),
      })
      .returning(['id', 'expires_at'])
      .executeTakeFirstOrThrow();
    const inviter = await trx
      .selectFrom('app.accounts')
      .select(['display_name', 'email'])
      .where('id', '=', principal.accountId)
      .executeTakeFirstOrThrow();
    await enqueue(trx, {
      type: 'organization_invitation',
      logicalKey: `organization_invitation:${invitation.id}:${randomToken()}`,
      recipientEmail: email,
      now,
      correlationId,
      payload: {
        organizationName: me.name,
        role: input.role,
        invitedBy: inviter.display_name ?? inviter.email,
        expiresAt: invitation.expires_at.toISOString(),
      },
    });
    await recordAudit(trx, {
      now,
      action: 'member_invited',
      actorKind: 'account',
      actorAccountId: principal.accountId,
      subjectId: organizationId,
      outcome: 'pending',
      details: { invitationId: invitation.id, role: input.role },
    });
    return { id: invitation.id, email, role: input.role, expiresAt: invitation.expires_at.toISOString() };
  });
}

/** DELETE /api/organizations/:id/invitations/:invitationId. */
export async function revokeInvitation(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  organizationId: string,
  invitationId: string,
) {
  uuid(invitationId);
  await ctx.db.transaction().execute(async (trx) => {
    const me = await acting(trx, organizationId, principal.accountId);
    requireManager(me.role);
    const now = await decisionTime(trx);
    const done = await trx
      .updateTable('app.organization_invitations')
      .set({ status: 'revoked', decided_at: now })
      .where('id', '=', invitationId)
      .where('organization_id', '=', organizationId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (!done.numUpdatedRows) throw new AppError(404, 'not_found');
    await recordAudit(trx, {
      now,
      action: 'invitation_revoked',
      actorKind: 'account',
      actorAccountId: principal.accountId,
      subjectId: organizationId,
      outcome: 'success',
      details: { invitationId },
    });
  });
}

/**
 * PATCH /api/organizations/:id/members/:accountId. Owners may give any role; admins may switch members
 * who are not owners between admin and member. The last owner cannot be demoted.
 */
export async function changeRole(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  organizationId: string,
  accountId: string,
  input: z.infer<typeof roleChangeSchema>,
) {
  uuid(accountId);
  await ctx.db.transaction().execute(async (trx) => {
    const me = await acting(trx, organizationId, principal.accountId);
    requireManager(me.role);
    const target = await trx
      .selectFrom('app.organization_memberships')
      .select('role')
      .where('organization_id', '=', organizationId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    if (!target) throw new AppError(404, 'not_found');
    if (me.role === 'admin' && (target.role === 'owner' || input.role === 'owner'))
      throw new AppError(403, 'forbidden');
    if (target.role === input.role) return;
    if (target.role === 'owner' && (await owners(trx, organizationId)) <= 1)
      throw new AppError(409, 'last_owner');
    const now = await decisionTime(trx);
    await trx
      .updateTable('app.organization_memberships')
      .set({ role: input.role })
      .where('organization_id', '=', organizationId)
      .where('account_id', '=', accountId)
      .execute();
    await recordAudit(trx, {
      now,
      action: 'member_role_changed',
      actorKind: 'account',
      actorAccountId: principal.accountId,
      subjectId: organizationId,
      outcome: 'success',
      details: { accountId, from: target.role, to: input.role },
    });
  });
}

/**
 * DELETE /api/organizations/:id/members/:accountId: removal by an owner (anyone) or an admin (not
 * owners), or leaving (one's own membership). The last owner can neither leave nor be removed.
 */
export async function removeMember(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  organizationId: string,
  accountId: string,
) {
  uuid(accountId);
  await ctx.db.transaction().execute(async (trx) => {
    const me = await acting(trx, organizationId, principal.accountId);
    const self = accountId === principal.accountId;
    if (!self) requireManager(me.role);
    const target = await trx
      .selectFrom('app.organization_memberships')
      .select('role')
      .where('organization_id', '=', organizationId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    if (!target) throw new AppError(404, 'not_found');
    if (!self && me.role === 'admin' && target.role === 'owner') throw new AppError(403, 'forbidden');
    if (target.role === 'owner' && (await owners(trx, organizationId)) <= 1)
      throw new AppError(409, 'last_owner');
    const now = await decisionTime(trx);
    await trx
      .deleteFrom('app.organization_memberships')
      .where('organization_id', '=', organizationId)
      .where('account_id', '=', accountId)
      .execute();
    await recordAudit(trx, {
      now,
      action: self ? 'member_left' : 'member_removed',
      actorKind: 'account',
      actorAccountId: principal.accountId,
      subjectId: organizationId,
      outcome: 'success',
      details: { accountId, role: target.role },
    });
  });
}

/** The pending, unexpired invitations of a verified address (none for an unverified one). */
export async function invitationsFor(db: Database | Tx, accountId: string) {
  const account = await db
    .selectFrom('app.accounts')
    .select(['email', 'email_verified_at'])
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (!account?.email_verified_at) return [];
  const now = await decisionTime(db);
  const rows = await db
    .selectFrom('app.organization_invitations as i')
    .innerJoin('app.organizations as o', 'o.id', 'i.organization_id')
    .leftJoin('app.accounts as by', 'by.id', 'i.invited_by_account_id')
    .select(['i.id', 'i.role', 'i.expires_at', 'o.name', 'by.display_name', 'by.email as by_email'])
    .where('i.email', '=', account.email)
    .where('i.status', '=', 'pending')
    .where('i.expires_at', '>', now)
    .orderBy('i.created_at')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    organizationName: r.name,
    role: r.role,
    invitedBy: r.display_name ?? r.by_email ?? null,
    expiresAt: r.expires_at.toISOString(),
  }));
}

/**
 * POST /api/invitations/:id/accept and /decline: only by the signed-in account whose verified address
 * the invitation was sent to. Accepting adds the membership with the invited role.
 */
export async function answerInvitation(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  invitationId: string,
  answer: 'accept' | 'decline',
) {
  uuid(invitationId);
  await ctx.db.transaction().execute(async (trx) => {
    const now = await decisionTime(trx);
    const account = await trx
      .selectFrom('app.accounts')
      .select(['email', 'email_verified_at'])
      .where('id', '=', principal.accountId)
      .executeTakeFirstOrThrow();
    const invitation = await trx
      .selectFrom('app.organization_invitations')
      .select(['organization_id', 'email', 'role', 'status', 'expires_at'])
      .where('id', '=', invitationId)
      .executeTakeFirst();
    // Somebody else's, expired, already answered or revoked: the same answer as an unknown one.
    if (
      !invitation ||
      !account.email_verified_at ||
      invitation.email !== account.email ||
      invitation.status !== 'pending' ||
      now >= invitation.expires_at
    )
      throw new AppError(404, 'not_found');
    // The organization row first, as every membership change does.
    await trx
      .selectFrom('app.organizations')
      .select('id')
      .where('id', '=', invitation.organization_id)
      .forUpdate()
      .execute();
    const updated = await trx
      .updateTable('app.organization_invitations')
      .set({ status: answer === 'accept' ? 'accepted' : 'declined', decided_at: now })
      .where('id', '=', invitationId)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    if (!updated.numUpdatedRows) throw new AppError(404, 'not_found');
    if (answer === 'accept')
      await trx
        .insertInto('app.organization_memberships')
        .values({
          organization_id: invitation.organization_id,
          account_id: principal.accountId,
          role: invitation.role as OrganizationRole,
          created_at: now,
        })
        .onConflict((oc) => oc.columns(['organization_id', 'account_id']).doNothing())
        .execute();
    await recordAudit(trx, {
      now,
      action: answer === 'accept' ? 'invitation_accepted' : 'invitation_declined',
      actorKind: 'account',
      actorAccountId: principal.accountId,
      subjectId: invitation.organization_id,
      outcome: 'success',
      details: { invitationId, role: invitation.role },
    });
  });
}
