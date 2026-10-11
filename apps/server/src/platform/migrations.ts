import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// Minimal in-repository migration runner (MIGRATIONS_STRATEGY.md §3–§5, recommendation for ADR-018).

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
const LOCK_KEY = 74_210_001; // advisory lock namespace for migrations

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: Buffer;
}

export function readMigrations(dir = MIGRATIONS_DIR): MigrationFile[] {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  return files.map((file, index) => {
    const version = Number.parseInt(file.slice(0, 4), 10);
    if (version !== index + 1) throw new Error(`migration numbering gap at ${file}`);
    const sql = readFileSync(join(dir, file), 'utf8');
    return { version, name: file, sql, checksum: createHash('sha256').update(sql).digest() };
  });
}

/** The schema version this build expects (D-9: exact match at startup). */
export function expectedSchemaVersion(dir = MIGRATIONS_DIR): number {
  const migrations = readMigrations(dir);
  return migrations.at(-1)?.version ?? 0;
}

export async function runMigrations(
  connectionString: string,
  log: (line: string) => void = () => {},
  dir = MIGRATIONS_DIR,
): Promise<number> {
  const migrations = readMigrations(dir);
  const client = new pg.Client({ connectionString, application_name: 'ers-migrate' });
  await client.connect();
  try {
    await client.query("SET lock_timeout = '30s'");
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query('CREATE SCHEMA IF NOT EXISTS app');
    await client.query(`CREATE TABLE IF NOT EXISTS app.schema_migrations (
      version integer PRIMARY KEY, name text NOT NULL, checksum bytea NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(), applied_by text NOT NULL DEFAULT current_user,
      duration_ms integer NOT NULL)`);
    const applied = await client.query<{ version: number; name: string; checksum: Buffer }>(
      'SELECT version, name, checksum FROM app.schema_migrations ORDER BY version',
    );
    for (const row of applied.rows) {
      const file = migrations.find((m) => m.version === row.version);
      if (!file) throw new Error(`database has migration ${row.version} (${row.name}) unknown to this build`);
      if (!file.checksum.equals(row.checksum)) throw new Error(`checksum mismatch for applied migration ${row.name}`);
    }
    let count = 0;
    for (const migration of migrations.filter((m) => !applied.rows.some((r) => r.version === m.version))) {
      const started = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO app.schema_migrations (version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4)',
          [migration.version, migration.name, migration.checksum, Date.now() - started],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${migration.name} failed: ${(error as Error).message}`);
      }
      log(`applied ${migration.name} (${Date.now() - started} ms)`);
      count += 1;
    }
    return count;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
}

/** Web and worker refuse to start on any mismatch (ENG-CI-6, AC-141). */
export async function assertSchemaVersion(connectionString: string): Promise<number> {
  const expected = expectedSchemaVersion();
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<{ v: number | null }>(
      'SELECT max(version) AS v FROM app.schema_migrations',
    ).catch(() => ({ rows: [{ v: null }] }));
    const actual = result.rows[0]?.v ?? 0;
    if (actual !== expected) {
      throw new Error(`schema version ${actual} does not match the expected version ${expected}; run "pnpm migrate"`);
    }
    return actual;
  } finally {
    await client.end();
  }
}
