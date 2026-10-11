import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads the repository .env for local runs; CI provides the variables directly. */
export function loadTestEnv(): void {
  const file = resolve(import.meta.dirname, '..', '..', '..', '.env');
  if (existsSync(file)) process.loadEnvFile(file);
  process.env.NODE_ENV = 'test';
  for (const name of ['TEST_DATABASE_URL', 'TEST_MIGRATION_DATABASE_URL']) {
    if (!process.env[name]) throw new Error(`${name} is required for the integration tests (see README)`);
  }
}
