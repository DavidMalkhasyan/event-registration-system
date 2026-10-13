import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { argon2, randomBytes } from 'node:crypto';
import pg from 'pg';
import { REPO_ROOT } from './env.js';

// Controlled test-database setup for browser tests (never part of the application). The E2E stack
// runs on the TEST database (stack.ts), so tests may prepare states that only time would produce.

function testDatabaseUrl(): string {
  const file = resolve(REPO_ROOT, '.env');
  if (!process.env.TEST_DATABASE_URL && existsSync(file)) process.loadEnvFile(file);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is required for the browser tests (see README)');
  return url;
}

/** Makes the organizer's active sessions look as if they were signed in `minutes` earlier. */
export async function ageOrganizerSessions(email: string, minutes: number): Promise<number> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE app.organizer_sessions s
          SET created_at = s.created_at - make_interval(mins => $2),
              authenticated_at = s.authenticated_at - make_interval(mins => $2),
              last_seen_at = s.last_seen_at - make_interval(mins => $2)
         FROM app.accounts a
        WHERE a.id = s.account_id AND a.email = $1 AND s.revoked_at IS NULL`,
      [email, minutes],
    );
    return result.rowCount ?? 0;
  } finally {
    await client.end();
  }
}

/**
 * Isolation between browser tests: every test starts with empty rate-limit counters in the TEST
 * database. The limits themselves are unchanged and are tested by the server integration tests; this
 * only stops one test's registrations from counting against the next (they all come from 127.0.0.1).
 */
export async function resetRateLimitCounters(): Promise<void> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query('DELETE FROM app.rate_limit_counters');
  } finally {
    await client.end();
  }
}

/** The same Argon2id PHC format and parameters as apps/server/src/platform/passwords.ts. */
function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolvePromise, reject) =>
    argon2(
      'argon2id',
      { message: password, nonce: salt, memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 },
      (e, key) => {
        if (e) return reject(e);
        const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
        resolvePromise(`$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}$${b64(key)}`);
      },
    ),
  );
}

/**
 * An approved organizer (K-709), as an approved registration or a migrated organizer would be: a
 * verified account, with a password if given, owning an active organization. Idempotent.
 */
export async function seedOrganizer(email: string, password?: string): Promise<void> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    const existing = await client.query('SELECT id FROM app.accounts WHERE email = $1', [email]);
    if (existing.rowCount) return;
    const hash = password ? await hashPassword(password) : null;
    await client.query('BEGIN');
    const account = await client.query(
      `INSERT INTO app.accounts (email, created_at, email_verified_at, password_hash, password_changed_at)
       VALUES ($1, now(), now(), $2::text, CASE WHEN $2::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
      [email, hash],
    );
    const org = await client.query(
      `INSERT INTO app.organizations (name, status, created_at, updated_at, email_verified_at, submitted_at, decided_at)
       VALUES ($1, 'active', now(), now(), now(), now(), now()) RETURNING id`,
      [email],
    );
    await client.query(
      `INSERT INTO app.organization_memberships (organization_id, account_id, role, created_at) VALUES ($1, $2, 'owner', now())`,
      [org.rows[0].id, account.rows[0].id],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** Stands in for the Super Admin's decision until K-710's area exists: sets the account's organizations' status. */
export async function setOrganizationStatus(
  email: string,
  status: 'active' | 'suspended' | 'rejected',
): Promise<number> {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    const result = await client.query(
      `UPDATE app.organizations o SET status = $2, decided_at = now(), updated_at = now()
         FROM app.organization_memberships m JOIN app.accounts a ON a.id = m.account_id
        WHERE m.organization_id = o.id AND a.email = $1`,
      [email, status],
    );
    return result.rowCount ?? 0;
  } finally {
    await client.end();
  }
}
