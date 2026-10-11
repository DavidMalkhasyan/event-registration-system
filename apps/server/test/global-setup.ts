import pg from 'pg';
import { runMigrations } from '../src/platform/migrations.js';
import { loadTestEnv } from './env.js';

/** Recreates the test schema on the real PostgreSQL test database and applies every migration. */
export default async function setup(): Promise<void> {
  loadTestEnv();
  const url = process.env.TEST_MIGRATION_DATABASE_URL!;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS app CASCADE');
  await client.end();
  await runMigrations(url);
}
