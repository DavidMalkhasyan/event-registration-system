import { randomBytes } from 'node:crypto';
import type { Database } from '../platform/db.js';
import { normalizeEmail } from '../platform/crypto.js';
import { PASSWORD_MIN, hashPassword } from '../platform/passwords.js';
import { decisionTime } from '../platform/tx.js';
import { createPlatformAdmin } from '../modules/platform-admin/bootstrap.js';

// The two local demo accounts created by `pnpm seed:demo` (never by the server, never in production).
// Their passwords are random per installation (or chosen by the operator) and never built in.

export class SeedError extends Error {}

export const ORGANIZER_EMAIL = 'demo.organizer@example.test';
export const ADMIN_EMAIL = 'demo.admin@example.test';
const ORGANIZATION = 'Demo Events Collective';

/** Refuses production and any database that is not local (or the one host compose.demo.yaml names). */
export function assertLocal(databaseUrl: string, env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') throw new SeedError('seed:demo refuses to run with NODE_ENV=production');
  const host = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '');
  const extra = env.DEMO_SEED_ALLOW_HOST;
  const allowed = ['localhost', '127.0.0.1', '::1', ...(extra ? [extra] : [])];
  if (!allowed.includes(host))
    throw new SeedError(`seed:demo only runs against a local database (host is "${host}")`);
}

/** The caller's chosen password, or a generated one. `generated` is set only for the latter (shown once). */
function passwordFor(name: string, chosen: string | undefined): { plain: string; generated: boolean } {
  if (chosen !== undefined && chosen.length < PASSWORD_MIN)
    throw new SeedError(`${name} needs at least ${PASSWORD_MIN} characters`);
  return chosen === undefined
    ? { plain: randomBytes(15).toString('base64url'), generated: true }
    : { plain: chosen, generated: false };
}

/** Finds or creates the demo organizer, its approved organization and owner membership. */
export async function ensureDemoOrganizer(
  db: Database,
  chosenPassword = process.env.DEMO_ORGANIZER_PASSWORD,
): Promise<{ accountId: string; organizationId: string; password: string | null }> {
  let password: string | null = null;
  let account = await db
    .selectFrom('app.accounts')
    .select('id')
    .where('email', '=', ORGANIZER_EMAIL)
    .executeTakeFirst();
  if (!account) {
    const { plain, generated } = passwordFor('DEMO_ORGANIZER_PASSWORD', chosenPassword);
    password = generated ? plain : null;
    const hash = await hashPassword(plain);
    account = await db.transaction().execute(async (trx) => {
      const now = await decisionTime(trx);
      const a = await trx
        .insertInto('app.accounts')
        .values({
          email: ORGANIZER_EMAIL,
          display_name: 'Demo Organizer',
          password_hash: hash,
          password_changed_at: now,
          email_verified_at: now,
          created_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const o = await trx
        .insertInto('app.organizations')
        .values({
          name: ORGANIZATION,
          description: 'Demonstration data for EventFlow. Synthetic; safe to ignore.',
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
        .values({ organization_id: o.id, account_id: a.id, role: 'owner', created_at: now })
        .execute();
      return a;
    });
  }
  const membership = await db
    .selectFrom('app.organization_memberships')
    .select('organization_id')
    .where('account_id', '=', account.id)
    .where('role', '=', 'owner')
    .executeTakeFirstOrThrow();
  return { accountId: account.id, organizationId: membership.organization_id, password };
}

/**
 * Finds or creates the demo Super Admin through the same operator path as `pnpm admin:create`.
 * No second factor is enrolled here: onboarding is the interactive `pnpm admin:totp` (the demo
 * stack wraps it as `admin-totp`), so the production TOTP model is neither bypassed nor weakened.
 */
export async function ensureDemoAdmin(
  db: Database,
  chosenPassword = process.env.DEMO_ADMIN_PASSWORD,
): Promise<{ created: boolean; password: string | null }> {
  const existing = await db
    .selectFrom('app.platform_admins')
    .select('id')
    .where('email', '=', normalizeEmail(ADMIN_EMAIL))
    .executeTakeFirst();
  if (existing) return { created: false, password: null };
  const { plain, generated } = passwordFor('DEMO_ADMIN_PASSWORD', chosenPassword);
  await createPlatformAdmin(db, { email: ADMIN_EMAIL, name: 'Demo Super Admin', password: plain });
  return { created: true, password: generated ? plain : null };
}
