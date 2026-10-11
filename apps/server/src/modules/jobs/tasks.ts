import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../../platform/db.js';
import { cutoffOf } from '../../platform/time.js';
import { decisionTime, withEventLock, withTransaction } from '../../platform/tx.js';
import { enqueue } from '../messaging/outbox.js';

// Scheduled-task engine for reminder fan-out and cutoff processing (NFR-CON-4 e, NFR-REL-5,
// FR-NTF-1, FR-NTF-2b, FR-NTF-5, FR-WL-5).
// Exactly one logical reminder per (registration, schedule version) is guaranteed by the
// reminder_slots primary key: a slot is claimed by INSERT … ON CONFLICT DO NOTHING in the same
// transaction that creates the reminder message, so re-runs and parallel workers create nothing extra.

const LEASE_MS = 60_000;
const BATCH = 200;

/** Claims and runs at most one due task. Returns 1 if a task was processed. */
export async function runDueTasks(db: Database, workerId: string): Promise<number> {
  const now = await decisionTime(db);
  // Lease reaper for tasks (task rows only).
  await sql`UPDATE app.scheduled_tasks SET status = 'PENDING', lease_expires_at = NULL
    WHERE id IN (SELECT id FROM app.scheduled_tasks WHERE status = 'RUNNING' AND lease_expires_at < ${now}
                 ORDER BY id FOR UPDATE SKIP LOCKED)`.execute(db);

  const candidate = await db
    .selectFrom('app.scheduled_tasks')
    .select(['id', 'event_id'])
    .where('status', '=', 'PENDING')
    .where('due_at', '<=', now)
    .orderBy('due_at')
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  if (!candidate) return 0;

  // TX-J01: two-phase claim under the shared event lock.
  const claimed = await withEventLock(db, candidate.event_id, 'shared', async ({ trx, now }) => {
    const task = await trx
      .selectFrom('app.scheduled_tasks')
      .selectAll()
      .where('id', '=', candidate.id)
      .where('status', '=', 'PENDING')
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!task) return 'busy' as const;
    await trx
      .updateTable('app.scheduled_tasks')
      .set({
        status: 'RUNNING',
        attempt_no: task.attempt_no + 1,
        lease_expires_at: new Date(now.getTime() + LEASE_MS),
      })
      .where('id', '=', task.id)
      .execute();
    return { ...task, attempt_no: task.attempt_no + 1 };
  });
  if (claimed === 'busy') return 0;
  if (claimed === null) {
    // The event no longer exists (deleted): the task has nothing to do.
    await withTransaction(db, ({ trx, now }) =>
      trx
        .updateTable('app.scheduled_tasks')
        .set({ status: 'SKIPPED', finished_at: now, lease_expires_at: null })
        .where('id', '=', candidate.id)
        .where('status', '=', 'PENDING')
        .execute(),
    );
    return 1;
  }
  if (claimed.kind === 'reminder_fanout')
    await runReminderFanout(db, claimed.id, claimed.attempt_no, workerId);
  else if (claimed.kind === 'cutoff_processing') await runCutoff(db, claimed.id, claimed.attempt_no);
  return 1;
}

/**
 * TX-J03 (F8, FR-WL-5, FR-NTF-4, D-3): at the cutoff, pending registrations expire and every
 * participant still WAITLISTED gets one "waiting list closed" email for this schedule version.
 * A separate transaction from the claim, under the EXCLUSIVE event lock because it changes
 * registration state (locks are never upgraded), so it is serialized with verification,
 * cancellation, promotion and reschedule. Idempotent: the attempt fence, the task status and
 * the per-(registration, version) logical key of each email.
 */
async function runCutoff(db: Database, taskId: string, attemptNo: number): Promise<void> {
  const task = await db
    .selectFrom('app.scheduled_tasks')
    .select(['event_id', 'schedule_version', 'params'])
    .where('id', '=', taskId)
    .executeTakeFirstOrThrow();
  await withEventLock(db, task.event_id, 'exclusive', async ({ trx, now, event }) => {
    const fenced = await trx
      .selectFrom('app.scheduled_tasks')
      .select(['status', 'attempt_no'])
      .where('id', '=', taskId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (fenced.status !== 'RUNNING' || fenced.attempt_no !== attemptNo) return;
    const finish = (status: 'DONE' | 'SKIPPED') =>
      trx
        .updateTable('app.scheduled_tasks')
        .set({ status, finished_at: now, lease_expires_at: null })
        .where('id', '=', taskId)
        .execute();

    // A newer schedule version has its own task; a cancelled event has nothing left to close.
    if (event.status !== 'SCHEDULED' || event.schedule_version !== task.schedule_version) {
      await finish('SKIPPED');
      return;
    }
    if (now < cutoffOf(event.starts_at)) {
      // Not due yet for this version (defensive; due_at is the cutoff): release the claim.
      await trx
        .updateTable('app.scheduled_tasks')
        .set({ status: 'PENDING', lease_expires_at: null, due_at: cutoffOf(event.starts_at) })
        .where('id', '=', taskId)
        .execute();
      return;
    }

    // D-3: PENDING_VERIFICATION → EXPIRED (cutoff). Their verification links already stopped
    // working at the cutoff (FR-REG-3) and only PENDING_VERIFICATION can be confirmed.
    await trx
      .updateTable('app.registrations')
      .set({ state: 'EXPIRED', ended_at: now, end_reason: 'cutoff', updated_at: now })
      .where('event_id', '=', event.id)
      .where('state', '=', 'PENDING_VERIFICATION')
      .execute();

    // FR-WL-5, unless the reschedule's change email already said registration is closed
    // (FR-NTF-4). Nothing is sent once the event has started.
    const closedByChange = (task.params as Record<string, unknown>).waitlist_closed_by_change === true;
    if (!closedByChange && now < event.starts_at) {
      const waiting = await trx
        .selectFrom('app.registrations')
        .select(['id', 'email'])
        .where('event_id', '=', event.id)
        .where('state', '=', 'WAITLISTED')
        .orderBy('waitlist_seq')
        .execute();
      for (const reg of waiting) {
        await enqueue(trx, {
          type: 'waitlist_closed',
          logicalKey: `waitlist_closed:${reg.id}:${event.schedule_version}`,
          recipientEmail: reg.email,
          now,
          horizonAt: event.starts_at, // retrying stops at Start
          eventId: event.id,
          registrationId: reg.id,
          scheduleVersion: event.schedule_version,
          correlationId: `task:${taskId}`,
        });
      }
    }
    await finish('DONE');
  });
}

/** TX-J02: reminder fan-out in batches under short shared locks (insert-only work). */
async function runReminderFanout(
  db: Database,
  taskId: string,
  attemptNo: number,
  _workerId: string,
): Promise<void> {
  for (;;) {
    const task = await db
      .selectFrom('app.scheduled_tasks')
      .selectAll()
      .where('id', '=', taskId)
      .executeTakeFirstOrThrow();
    const step = await withEventLock(db, task.event_id, 'shared', async ({ trx, now, event }) => {
      // Fence on the attempt so a task reclaimed after a lease expiry is not run twice in parallel.
      const fenced = await trx
        .selectFrom('app.scheduled_tasks')
        .select(['status', 'attempt_no', 'cursor_registration_id'])
        .where('id', '=', taskId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (fenced.status !== 'RUNNING' || fenced.attempt_no !== attemptNo) return 'stop' as const;
      const finish = async (status: 'DONE' | 'SKIPPED') => {
        await trx
          .updateTable('app.scheduled_tasks')
          .set({ status, finished_at: now, lease_expires_at: null })
          .where('id', '=', taskId)
          .execute();
        return 'stop' as const;
      };
      // Stale version, cancelled event, or missed send time (FR-NTF-5: not sent after Start).
      if (
        event.status !== 'SCHEDULED' ||
        event.schedule_version !== task.schedule_version ||
        now >= event.starts_at
      ) {
        return finish('SKIPPED');
      }
      let query = trx
        .selectFrom('app.registrations')
        .select(['id', 'email'])
        .where('event_id', '=', event.id)
        .where('state', '=', 'CONFIRMED')
        .orderBy('id')
        .limit(BATCH);
      if (fenced.cursor_registration_id) query = query.where('id', '>', fenced.cursor_registration_id);
      const batch = await query.execute();
      for (const reg of batch) {
        const messageId = randomUUID();
        const slot = await trx
          .insertInto('app.reminder_slots')
          .values({
            registration_id: reg.id,
            schedule_version: event.schedule_version,
            event_id: event.id,
            outbox_message_id: messageId,
            filled_by: 'reminder',
            created_at: now,
          })
          .onConflict((oc) => oc.columns(['registration_id', 'schedule_version']).doNothing())
          .returning('registration_id')
          .executeTakeFirst();
        if (!slot) continue; // already filled by a ticket, promotion or change email (FR-NTF-2b)
        await enqueue(trx, {
          id: messageId,
          type: 'reminder',
          logicalKey: `reminder:${reg.id}:${event.schedule_version}`,
          recipientEmail: reg.email,
          now,
          horizonAt: event.starts_at, // retrying stops at Start (EC-53)
          eventId: event.id,
          registrationId: reg.id,
          scheduleVersion: event.schedule_version,
          correlationId: `task:${taskId}`,
        });
      }
      if (batch.length < BATCH) return finish('DONE');
      await trx
        .updateTable('app.scheduled_tasks')
        .set({
          cursor_registration_id: batch.at(-1)!.id,
          lease_expires_at: new Date(now.getTime() + LEASE_MS),
        })
        .where('id', '=', taskId)
        .execute();
      return 'continue' as const;
    });
    if (step !== 'continue') return;
  }
}
