import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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
