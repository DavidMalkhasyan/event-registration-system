import type { Database } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import type { OrganizationRole, OrganizationStatus } from '../../platform/schema.js';
import type { Tx } from '../../platform/tx.js';

// Organization access (K-708, amendment A-3, PD-88). Events belong to organizations; an organizer may
// act on an event only as a member of the event's organization, and only while that organization is
// active. Checked at the API boundary, inside the event lock of every protected operation, with the
// membership row read FOR SHARE so a concurrent membership change is serialized with the operation.
// Staff sessions are unaffected: they stay bound to one event and never reach these checks.

export interface Membership {
  organizationId: string;
  name: string;
  role: OrganizationRole;
  status: OrganizationStatus;
}

/**
 * Throws 404 when the account is not a member of the event's organization (another organization's
 * event looks like an unknown one, AC-155), and 403 organization_not_active when it is a member of an
 * organization that is pending, rejected or suspended. Returns the member's role.
 */
export async function assertEventAccess(
  db: Tx | Database,
  accountId: string,
  event: { organization_id: string },
): Promise<OrganizationRole> {
  const row = await db
    .selectFrom('app.organization_memberships as m')
    .innerJoin('app.organizations as o', 'o.id', 'm.organization_id')
    .select(['m.role', 'o.status'])
    .where('m.organization_id', '=', event.organization_id)
    .where('m.account_id', '=', accountId)
    .forShare()
    .executeTakeFirst();
  if (!row) throw new AppError(404, 'not_found');
  if (row.status !== 'active') throw new AppError(403, 'organization_not_active');
  return row.role;
}

/** The IDs of the active organizations whose events the account may see and manage (a subquery). */
export function manageableOrganizationIds(db: Tx | Database, accountId: string) {
  return db
    .selectFrom('app.organization_memberships as m')
    .innerJoin('app.organizations as o', 'o.id', 'm.organization_id')
    .select('m.organization_id')
    .where('m.account_id', '=', accountId)
    .where('o.status', '=', 'active');
}

/** Every membership of the account, for the session and the organizer interface. */
export async function membershipsOf(db: Tx | Database, accountId: string): Promise<Membership[]> {
  const rows = await db
    .selectFrom('app.organization_memberships as m')
    .innerJoin('app.organizations as o', 'o.id', 'm.organization_id')
    .select(['o.id', 'o.name', 'm.role', 'o.status'])
    .where('m.account_id', '=', accountId)
    .orderBy('o.name')
    .execute();
  return rows.map((r) => ({ organizationId: r.id, name: r.name, role: r.role, status: r.status }));
}

/**
 * The organization a new event is created in: the one asked for (it must be active and the account a
 * member), or the account's only active organization.
 */
export async function organizationForNewEvent(
  db: Tx | Database,
  accountId: string,
  requested: string | undefined,
): Promise<string> {
  const active = (await membershipsOf(db, accountId)).filter((m) => m.status === 'active');
  if (requested) {
    if (!active.some((m) => m.organizationId === requested))
      throw new AppError(403, 'organization_not_active');
    return requested;
  }
  if (active.length === 1) return active[0]!.organizationId;
  if (active.length === 0) throw new AppError(403, 'organization_not_active');
  throw new AppError(422, 'organization_required');
}

/**
 * Transitional (PD-88, until K-709 replaces passwordless organizer sign-up): an account created by the
 * passwordless sign-in gets its own active organization, as it could create events before K-708.
 */
export async function ensurePersonalOrganization(
  trx: Tx,
  accountId: string,
  email: string,
  now: Date,
): Promise<void> {
  const existing = await trx
    .selectFrom('app.organization_memberships')
    .select('organization_id')
    .where('account_id', '=', accountId)
    .executeTakeFirst();
  if (existing) return;
  const org = await trx
    .insertInto('app.organizations')
    .values({
      name: email,
      status: 'active',
      created_at: now,
      updated_at: now,
      email_verified_at: now,
      submitted_at: now,
      decided_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('app.organization_memberships')
    .values({ organization_id: org.id, account_id: accountId, role: 'owner', created_at: now })
    .execute();
}
