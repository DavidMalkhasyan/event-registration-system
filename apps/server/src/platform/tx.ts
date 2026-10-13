import { sql, type Transaction } from 'kysely';
import type { Database } from './db.js';
import type { DB, EventStatus } from './schema.js';

export type Tx = Transaction<DB>;

export interface LockedEvent {
  id: string;
  owner_account_id: string;
  organization_id: string;
  status: EventStatus;
  starts_at: Date;
  time_zone: string;
  schedule_version: number;
  capacity: number;
  confirmed_count: number;
  next_waitlist_seq: number;
  title: string;
}

// Test-only injected clock (ENG-TST-6). Production never sets an offset.
let clockOffsetSeconds = 0;
export function setTestClockOffset(seconds: number): void {
  if (process.env.NODE_ENV !== 'test') throw new Error('the clock offset is only available in tests');
  clockOffsetSeconds = seconds;
}

/** Decision time (Glossary, D-1): database clock read after the serialization lock. */
export async function decisionTime(trx: Tx | Database): Promise<Date> {
  const row = await sql<{
    t: Date;
  }>`SELECT clock_timestamp() + make_interval(secs => ${clockOffsetSeconds}) AS t`.execute(trx);
  return row.rows[0]!.t;
}

const RETRYABLE = new Set(['40001', '40P01', '55P03']);
const MAX_ATTEMPTS = 4;

export class InfrastructureError extends Error {}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code && RETRYABLE.has(code)) {
        if (attempt >= MAX_ATTEMPTS) throw new InfrastructureError(`transaction retries exhausted (${code})`);
        await new Promise((resolve) => setTimeout(resolve, 10 * attempt + Math.random() * 25));
        continue;
      }
      throw error;
    }
  }
}

async function setTimeouts(trx: Tx, lockTimeout = '5s'): Promise<void> {
  // SET LOCAL takes no table lock, so the event lock is still the first locking statement (AC-133).
  await sql`SELECT set_config('lock_timeout', ${lockTimeout}, true), set_config('statement_timeout', '30s', true)`.execute(
    trx,
  );
}

/**
 * Event-scoped transaction (NFR-CON-4): the event row is locked first, FOR UPDATE for state
 * changes and FOR SHARE for claims and insert-only work. Returns null when the event does not exist.
 */
export async function withEventLock<T>(
  db: Database,
  eventId: string,
  mode: 'exclusive' | 'shared',
  fn: (ctx: { trx: Tx; now: Date; event: LockedEvent }) => Promise<T>,
): Promise<T | null> {
  return withRetry(() =>
    db.transaction().execute(async (trx) => {
      await setTimeouts(trx);
      const lockClause = mode === 'exclusive' ? sql`FOR UPDATE` : sql`FOR SHARE`;
      const locked = await sql<LockedEvent>`
        SELECT id, owner_account_id, organization_id, status, starts_at, time_zone, schedule_version, capacity,
               confirmed_count, next_waitlist_seq, title
        FROM app.events WHERE id = ${eventId} ${lockClause}`.execute(trx);
      const event = locked.rows[0];
      if (!event) return null;
      const now = await decisionTime(trx);
      return fn({ trx, now, event });
    }),
  );
}

/**
 * Account-scoped transaction (NFR-CON-7): advisory locks on every address involved, in ascending
 * key order, before any account, request or session row. Never combined with an event lock.
 */
export async function withAccountLocks<T>(
  db: Database,
  emails: string[],
  fn: (ctx: { trx: Tx; now: Date }) => Promise<T>,
): Promise<T> {
  return withRetry(() =>
    db.transaction().execute(async (trx) => {
      await setTimeouts(trx);
      const keys = await sql<{ k: number }>`
        SELECT DISTINCT hashtext(e) AS k FROM unnest(${emails}::text[]) AS e ORDER BY k`.execute(trx);
      for (const { k } of keys.rows) {
        await sql`SELECT pg_advisory_xact_lock(1001, ${k})`.execute(trx);
      }
      const now = await decisionTime(trx);
      return fn({ trx, now });
    }),
  );
}

/** Transaction without an event or account lock (event creation, outbox-only paths, single rows). */
export async function withTransaction<T>(
  db: Database,
  fn: (ctx: { trx: Tx; now: Date }) => Promise<T>,
): Promise<T> {
  return withRetry(() =>
    db.transaction().execute(async (trx) => {
      await setTimeouts(trx);
      const now = await decisionTime(trx);
      return fn({ trx, now });
    }),
  );
}
