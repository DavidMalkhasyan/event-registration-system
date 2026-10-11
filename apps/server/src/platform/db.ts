import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './schema.js';

// int8 columns (waitlist_seq, next_waitlist_seq, counts) fit safely in a JS number here.
pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export type Database = Kysely<DB>;

export function createDatabase(connectionString: string, max = 10): Database {
  const pool = new pg.Pool({ connectionString, max, application_name: 'ers' });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
