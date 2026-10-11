import { sql } from 'kysely';
import type { Database } from '../../platform/db.js';
import { decisionTime, withEventLock, withTransaction, type Tx } from '../../platform/tx.js';
import { HANDLERS, type OutboxRow } from '../notifications/handlers.js';
import type { EmailProvider } from './fake-provider.js';

// Outbox dispatcher (NFR-REL-1, NFR-CON-4 e, D-2, D-16). Implemented for this slice:
// pre-claim counter, two-phase claim under the shared event lock (or the request row for
// sign-in messages), freshness check, link issuance inside the claim, render after the claim,
// send_started_at committed before the provider call, fenced result write, lease reaper and
// retry horizon. Not yet implemented: send budget, sending pause, webhooks and delivery facts,
// class B regeneration (docs/process/MILESTONES.md, deferred scope).

const LEASE_MS = 60_000;
const BATCH = 10;
const PRECLAIM_BOUND = 3;
const BACKOFF_MS = [60_000, 300_000, 900_000, 3_600_000];

interface Claimed {
  msg: OutboxRow;
  attemptNo: number;
  tokens: Record<string, string>;
}

export class Dispatcher {
  constructor(
    private readonly db: Database,
    private readonly provider: EmailProvider,
    private readonly origin: string,
    private readonly workerId: string,
  ) {}

  /** Processes due messages once; returns how many were handled. */
  async runOnce(): Promise<number> {
    await this.sweep();
    const now = await decisionTime(this.db);
    const candidates = await this.db
      .selectFrom('app.outbox_messages')
      .select(['id', 'event_id', 'preclaim_failures'])
      .where('status', 'in', ['QUEUED', 'WAITING_RETRY'])
      .where('next_attempt_at', '<=', now)
      .where('preclaim_failures', '<', PRECLAIM_BOUND)
      .orderBy('lane', 'desc') // 'priority' before 'bulk'
      .orderBy('next_attempt_at')
      .orderBy('id')
      .limit(BATCH)
      .execute();
    if (candidates.length === 0) return 0;
    // One event (or the authentication group) per claim; a message with an earlier failed claim goes alone.
    const first = candidates[0]!;
    const group =
      first.preclaim_failures > 0
        ? [first]
        : candidates.filter((c) => c.event_id === first.event_id && c.preclaim_failures === 0);
    const ids = group.map((c) => c.id);

    // TX-M14: durable pre-claim counter in its own transaction (NFR-REL-13 h).
    await sql`UPDATE app.outbox_messages SET preclaim_failures = preclaim_failures + 1
      WHERE id IN (SELECT id FROM app.outbox_messages WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE SKIP LOCKED)`.execute(this.db);

    const claimed = first.event_id
      ? ((await withEventLock(this.db, first.event_id, 'shared', ({ trx, now }) => this.claim(trx, ids, now))) ?? [])
      : await withTransaction(this.db, ({ trx, now }) => this.claim(trx, ids, now));
    for (const item of claimed) await this.send(item);
    return group.length;
  }

  private async claim(trx: Tx, ids: string[], now: Date): Promise<Claimed[]> {
    const rows = await trx
      .selectFrom('app.outbox_messages')
      .select(['id', 'message_type', 'event_id', 'registration_id', 'sign_in_request_id', 'verification_generation', 'schedule_version', 'recipient_email', 'payload', 'possibly_accepted', 'attempt_no', 'logical_key'])
      .where('id', 'in', ids)
      .where('status', 'in', ['QUEUED', 'WAITING_RETRY'])
      .where('next_attempt_at', '<=', now)
      .orderBy('id')
      .forUpdate()
      .skipLocked()
      .execute();
    const claimed: Claimed[] = [];
    for (const row of rows) {
      const handler = HANDLERS[row.message_type];
      const msg = row as unknown as OutboxRow;
      if (!handler) {
        await this.settle(trx, row.id, row.possibly_accepted ? 'UNCONFIRMED' : 'FAILED', 'permanent_error', now, 'no_handler');
        continue;
      }
      await sql`SAVEPOINT claim_one`.execute(trx);
      try {
        const freshness = await handler.freshness(trx, msg, now);
        if (!freshness.fresh) {
          // D-12: DROPPED only when nothing may have been submitted.
          if (freshness.reason === 'link_expiry') {
            await this.settle(trx, row.id, row.possibly_accepted ? 'UNCONFIRMED' : 'FAILED', 'link_expiry', now);
          } else {
            await this.settle(trx, row.id, row.possibly_accepted ? 'UNCONFIRMED' : 'DROPPED', freshness.reason, now);
          }
          continue;
        }
        const attemptNo = row.attempt_no + 1;
        await trx
          .updateTable('app.outbox_messages')
          .set({ status: 'SENDING', attempt_no: attemptNo, lease_expires_at: new Date(now.getTime() + LEASE_MS), preclaim_failures: 0 })
          .where('id', '=', row.id)
          .execute();
        await trx
          .insertInto('app.outbox_generations')
          .values({ outbox_id: row.id, generation: 1, provider_key: `${row.logical_key}:g1`, created_at: now })
          .onConflict((oc) => oc.columns(['outbox_id', 'generation']).doNothing())
          .execute();
        await trx
          .insertInto('app.outbox_attempts')
          .values({ outbox_id: row.id, generation: 1, attempt_no: attemptNo, worker_id: this.workerId, claimed_at: now, lease_expires_at: new Date(now.getTime() + LEASE_MS) })
          .execute();
        // Raw tokens stay in this process's memory until the provider call returns (D-2).
        const tokens = await handler.issueTokens(trx, msg, now, attemptNo);
        await sql`RELEASE SAVEPOINT claim_one`.execute(trx);
        claimed.push({ msg, attemptNo, tokens });
      } catch (error) {
        await sql`ROLLBACK TO SAVEPOINT claim_one`.execute(trx);
        await trx
          .updateTable('app.outbox_messages')
          .set({ last_error_code: 'claim_error', next_attempt_at: new Date(now.getTime() + BACKOFF_MS[0]!) })
          .where('id', '=', row.id)
          .execute();
        void error;
      }
    }
    return claimed;
  }

  private async settle(trx: Tx, id: string, status: 'DROPPED' | 'FAILED' | 'UNCONFIRMED' | 'ACCEPTED', reason: string, now: Date, errorCode?: string) {
    await trx
      .updateTable('app.outbox_messages')
      .set({ status, settle_reason: reason, settled_at: now, lease_expires_at: null, preclaim_failures: 0, ...(errorCode ? { last_error_code: errorCode } : {}) })
      .where('id', '=', id)
      .execute();
  }

  private async send({ msg, attemptNo, tokens }: Claimed): Promise<void> {
    const handler = HANDLERS[msg.message_type]!;
    let rendered;
    try {
      rendered = await handler.render(this.db, msg, tokens, this.origin);
    } catch {
      return; // The lease expires and the reaper returns the message to waiting (no submission started).
    }
    // TX-M04: commit send_started_at before any network operation (D-2).
    const started = await withTransaction(this.db, async ({ trx, now }) => {
      const current = await trx
        .selectFrom('app.outbox_messages')
        .select(['status', 'attempt_no', 'lease_expires_at', 'logical_key'])
        .where('id', '=', msg.id)
        .forUpdate()
        .executeTakeFirst();
      if (!current || current.status !== 'SENDING' || current.attempt_no !== attemptNo || !current.lease_expires_at || current.lease_expires_at <= now) {
        return null;
      }
      await trx
        .updateTable('app.outbox_attempts')
        .set({ send_started_at: now })
        .where('outbox_id', '=', msg.id)
        .where('attempt_no', '=', attemptNo)
        .execute();
      return current.logical_key;
    });
    if (!started) return;

    const sentAt = Date.now();
    let result;
    try {
      result = await this.provider.send({
        idempotencyKey: `${started}:g1`,
        to: msg.recipient_email,
        email: rendered,
        tags: { outbox_id: msg.id, generation: '1' },
      });
    } catch {
      result = null; // Ambiguous: the submission may have been accepted.
    }

    // TX-M05: fenced result write (NFR-REL-9, NFR-REL-13).
    await withTransaction(this.db, async ({ trx, now }) => {
      const current = await trx
        .selectFrom('app.outbox_messages')
        .select(['status', 'attempt_no', 'horizon_at'])
        .where('id', '=', msg.id)
        .forUpdate()
        .executeTakeFirst();
      if (!current) return;
      const category = result?.category ?? 'ambiguous';
      await trx
        .updateTable('app.outbox_attempts')
        .set({
          result_at: now,
          result_category: category,
          provider_message_id: result?.providerMessageId ?? null,
          possibly_accepted: category !== 'accepted' && category !== 'replayed',
          stale: current.attempt_no !== attemptNo,
          latency_ms: Date.now() - sentAt,
        })
        .where('outbox_id', '=', msg.id)
        .where('attempt_no', '=', attemptNo)
        .execute();
      const accepted = category === 'accepted' || category === 'replayed';
      if (accepted && ['SENDING', 'WAITING_RETRY', 'AWAITING_EVIDENCE', 'UNCONFIRMED'].includes(current.status)) {
        await this.settle(trx, msg.id, 'ACCEPTED', 'accepted', now);
        await trx
          .updateTable('app.outbox_generations')
          .set({ provider_message_id: result!.providerMessageId!, accepted_at: now })
          .where('outbox_id', '=', msg.id)
          .where('generation', '=', 1)
          .execute();
        return;
      }
      if (current.status !== 'SENDING' || current.attempt_no !== attemptNo) return; // stale result: logged only
      if (category === 'idempotent_key_conflict') {
        await trx
          .updateTable('app.outbox_messages')
          .set({ status: 'AWAITING_EVIDENCE', possibly_accepted: true, awaiting_evidence_since: now, lease_expires_at: null })
          .where('id', '=', msg.id)
          .execute();
        return;
      }
      const delay = BACKOFF_MS[Math.min(attemptNo - 1, BACKOFF_MS.length - 1)]!;
      await trx
        .updateTable('app.outbox_messages')
        .set({ status: 'WAITING_RETRY', possibly_accepted: true, lease_expires_at: null, next_attempt_at: new Date(now.getTime() + delay), last_error_code: 'ambiguous' })
        .where('id', '=', msg.id)
        .execute();
    });
  }

  /** TX-M06, TX-M07, TX-M15: lease reaper, retry horizon and claim-failure bound (outbox-only). */
  async sweep(): Promise<void> {
    await withTransaction(this.db, async ({ trx, now }) => {
      // Reaper: possibly accepted only if the send had started (D-2).
      await sql`
        WITH expired AS (
          SELECT m.id, m.attempt_no FROM app.outbox_messages m
          WHERE m.status = 'SENDING' AND m.lease_expires_at < ${now} ORDER BY m.id FOR UPDATE SKIP LOCKED)
        UPDATE app.outbox_messages m SET status = 'WAITING_RETRY', lease_expires_at = NULL, next_attempt_at = ${now},
          possibly_accepted = m.possibly_accepted OR EXISTS (
            SELECT 1 FROM app.outbox_attempts a WHERE a.outbox_id = m.id AND a.attempt_no = e.attempt_no AND a.send_started_at IS NOT NULL)
        FROM expired e WHERE m.id = e.id`.execute(trx);
      await sql`UPDATE app.outbox_attempts a SET lease_expired_at = ${now}
        FROM app.outbox_messages m WHERE a.outbox_id = m.id AND a.attempt_no = m.attempt_no
          AND a.lease_expired_at IS NULL AND a.result_at IS NULL AND m.status = 'WAITING_RETRY' AND a.lease_expires_at < ${now}`.execute(trx);
      // Retry horizon (NFR-REL-4) and the pre-claim bound (NFR-REL-13 h).
      for (const [condition, reason] of [
        [sql`horizon_at <= ${now}`, 'horizon_reached'],
        [sql`preclaim_failures >= ${PRECLAIM_BOUND}`, 'claim_failed'],
      ] as const) {
        await sql`
          WITH due AS (SELECT id FROM app.outbox_messages
            WHERE status IN ('QUEUED', 'WAITING_RETRY', 'AWAITING_EVIDENCE') AND ${condition}
            ORDER BY id FOR UPDATE SKIP LOCKED)
          UPDATE app.outbox_messages m SET
            status = CASE WHEN m.possibly_accepted THEN 'UNCONFIRMED' ELSE 'FAILED' END,
            settle_reason = ${reason}, settled_at = ${now}, lease_expires_at = NULL
          FROM due WHERE m.id = due.id`.execute(trx);
      }
    });
  }
}
