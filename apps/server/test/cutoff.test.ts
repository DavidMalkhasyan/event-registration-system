import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runDueTasks } from '../src/modules/jobs/tasks.js';
import { GENERIC_INVALID_LINK_BODY } from '../src/platform/errors.js';
import {
  ORIGIN,
  confirm,
  createEvent,
  createHarness,
  drain,
  localIn,
  mailFor,
  moveClockTo,
  organizerHeaders,
  register,
  registerAndGetVerifyToken,
  registerConfirmed,
  resetData,
  signIn,
  tokenFromLink,
  type Harness,
  type Session,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const HOUR = 3_600_000;
const closedMail = (email: string) =>
  mailFor(h, email).filter((m) => m.subject.startsWith('Registration closed'));
const cutoffOf = (startsAt: string) => new Date(new Date(startsAt).getTime() - 2 * HOUR);

/** Capacity 1: A confirmed; W1 and W2 waiting (positions 1, 2); P registered but never confirmed. */
async function setup() {
  const s = await signIn(h, 'organizer@example.test');
  const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
  const a = await registerConfirmed(h, event.publicId, 'a@example.test');
  const w1 = await registerConfirmed(h, event.publicId, 'w1@example.test');
  const w2 = await registerConfirmed(h, event.publicId, 'w2@example.test');
  const pendingToken = await registerAndGetVerifyToken(h, event.publicId, 'p@example.test');
  await drain(h);
  expect([a.result, w1.result, w2.result]).toEqual(['confirmed', 'waitlisted', 'waitlisted']);
  return { s, event, a, w1, w2, pendingToken };
}

async function states(eventId: string) {
  const rows = await h.db
    .selectFrom('app.registrations')
    .select(['email', 'state', 'end_reason'])
    .where('event_id', '=', eventId)
    .orderBy('email')
    .orderBy('created_at')
    .execute();
  return rows.map((r) => `${r.email}:${r.state}${r.end_reason ? `(${r.end_reason})` : ''}`);
}

async function tasks(eventId: string) {
  const rows = await h.db
    .selectFrom('app.scheduled_tasks')
    .select(['schedule_version', 'status', 'params'])
    .where('event_id', '=', eventId)
    .where('kind', '=', 'cutoff_processing')
    .orderBy('schedule_version')
    .execute();
  return rows;
}

async function cancelByLink(managementLink: string) {
  return h.app.inject({
    method: 'POST',
    url: '/api/links/manage/cancel',
    headers: { origin: ORIGIN, authorization: `Link ${tokenFromLink(managementLink)}` },
    payload: { confirmed: true },
  });
}

async function reschedule(s: Session, eventId: string, localStart: string, expectedScheduleVersion: number) {
  const response = await h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/reschedule`,
    headers: organizerHeaders(s),
    payload: { localStart, expectedScheduleVersion },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { startsAt: string; scheduleVersion: number };
}

describe('registration cutoff job (K-404b: F8, FR-WL-5, AC-32, D-3)', () => {
  it('at the cutoff, expires pending registrations and sends each waiting participant exactly one "closed" email', async () => {
    const { event, pendingToken } = await setup();

    // Not before the cutoff.
    moveClockTo(cutoffOf(event.startsAt), -60_000);
    await drain(h);
    expect(closedMail('w1@example.test')).toHaveLength(0);
    expect(await states(event.id)).toContain('p@example.test:PENDING_VERIFICATION');

    // Just after the cutoff, two workers pick up the task at the same time.
    moveClockTo(cutoffOf(event.startsAt), 60_000);
    await Promise.all([runDueTasks(h.db, 'worker-1'), runDueTasks(h.db, 'worker-2')]);
    await drain(h);

    expect(closedMail('w1@example.test')).toHaveLength(1);
    expect(closedMail('w2@example.test')).toHaveLength(1);
    expect(closedMail('a@example.test')).toHaveLength(0); // confirmed participants are not told
    expect(closedMail('p@example.test')).toHaveLength(0);
    expect(closedMail('w1@example.test')[0]!.text).toContain('no place became available');
    expect(await states(event.id)).toEqual([
      'a@example.test:CONFIRMED',
      'p@example.test:EXPIRED(cutoff)',
      'w1@example.test:WAITLISTED', // frozen, not removed (Q9)
      'w2@example.test:WAITLISTED',
    ]);
    expect((await tasks(event.id)).map((t) => t.status)).toEqual(['DONE']);

    // The expired registration's verification link gives the generic invalid-link response.
    const view = await h.app.inject({
      method: 'GET',
      url: '/api/links/verify',
      headers: { authorization: `Link ${pendingToken}` },
    });
    expect(view.body).toBe(GENERIC_INVALID_LINK_BODY);
    expect((await confirm(h, pendingToken)).body).toBe(GENERIC_INVALID_LINK_BODY);

    // Re-running the worker changes nothing.
    await drain(h);
    expect(closedMail('w1@example.test')).toHaveLength(1);
    expect(closedMail('w2@example.test')).toHaveLength(1);
  });

  it('races participant actions at the cutoff without double effects (concurrency)', async () => {
    const { event, a, w1, pendingToken } = await setup();
    moveClockTo(cutoffOf(event.startsAt), 1_000);

    // Three workers, a confirmed cancellation, a waiting-list cancellation and a late
    // confirmation, all at once. Every one of them takes the event lock, so they serialize.
    const [, , , cancelA, cancelW1, lateConfirm] = await Promise.all([
      runDueTasks(h.db, 'worker-1'),
      runDueTasks(h.db, 'worker-2'),
      runDueTasks(h.db, 'worker-3'),
      cancelByLink(a.links.management),
      cancelByLink(w1.links.management),
      confirm(h, pendingToken),
    ]);
    expect(cancelA.statusCode).toBe(200);
    expect(cancelW1.statusCode).toBe(200);
    expect(lateConfirm.body).toBe(GENERIC_INVALID_LINK_BODY); // after the cutoff: no seat, no waiting place
    await drain(h);

    expect(await states(event.id)).toEqual([
      'a@example.test:CANCELLED(participant_cancelled)',
      'p@example.test:EXPIRED(cutoff)',
      'w1@example.test:CANCELLED(participant_cancelled)',
      'w2@example.test:WAITLISTED', // no promotion after the cutoff (FR-WL-4), whatever the order
    ]);
    // Whichever committed first, a participant who left the list is never told it closed
    // (the email is either not created or dropped by the send-time freshness check).
    expect(closedMail('w1@example.test')).toHaveLength(0);
    expect(closedMail('w2@example.test')).toHaveLength(1);
    expect(
      mailFor(h, 'w2@example.test').filter((m) => m.subject.startsWith('A place became free')),
    ).toHaveLength(0);
    expect((await tasks(event.id)).map((t) => t.status)).toEqual(['DONE']);
  });

  it('sends no separate "closed" email when a reschedule moved the start inside the cutoff (FR-NTF-4, AC-106)', async () => {
    const { s, event } = await setup();
    const moved = await reschedule(s, event.id, localIn(1), 1); // new cutoff is already in the past
    await drain(h);

    for (const email of ['w1@example.test', 'w2@example.test']) {
      const change = mailFor(h, email).filter((m) => m.subject.startsWith('Date changed'));
      expect(change).toHaveLength(1);
      expect(change[0]!.text).toContain('Registration for this event is now closed');
      expect(closedMail(email)).toHaveLength(0);
    }
    expect(await states(event.id)).toContain('p@example.test:EXPIRED(cutoff)');
    const t = await tasks(event.id);
    expect(t.map((x) => [x.schedule_version, x.status])).toEqual([
      [1, 'PENDING'], // due at the old cutoff, ~70 h from now
      [moved.scheduleVersion, 'DONE'],
    ]);
    expect(t[1]!.params).toEqual({ waitlist_closed_by_change: true });

    // When the old version's task comes due it sees the newer version and does nothing.
    moveClockTo(cutoffOf(event.startsAt), 60_000);
    await drain(h);
    expect((await tasks(event.id)).map((x) => x.status)).toEqual(['SKIPPED', 'DONE']);
    expect(closedMail('w1@example.test')).toHaveLength(0);
    expect(closedMail('w2@example.test')).toHaveLength(0);
  });

  it('reopens when the event moves later: positions kept, promotion resumes, one "closed" email per version (EC-18, AC-107, FR-REG-9)', async () => {
    const { s, event, a } = await setup();
    moveClockTo(cutoffOf(event.startsAt), 60_000);
    await drain(h);
    expect(closedMail('w1@example.test')).toHaveLength(1);

    // Moved later: registration reopens with the waiting list unchanged and no "reopened" email.
    const moved = await reschedule(s, event.id, localIn(96), 1);
    await drain(h);
    const positions = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/participants`,
      headers: { cookie: s.cookie },
    });
    const waiting = (positions.json().items as { email: string; state: string; position?: number }[])
      .filter((p) => p.state === 'WAITLISTED')
      .map((p) => [p.email, p.position]);
    expect(waiting).toEqual([
      ['w1@example.test', 1],
      ['w2@example.test', 2],
    ]);

    // Promotion resumes for a freed seat, FIFO.
    expect((await cancelByLink(a.links.management)).statusCode).toBe(200);
    await drain(h);
    expect(
      mailFor(h, 'w1@example.test').filter((m) => m.subject.startsWith('A place became free')),
    ).toHaveLength(1);

    // The expired registrant can register again as a new registration (FR-REG-9).
    expect((await register(h, event.publicId, 'p@example.test')).statusCode).toBe(202);
    await drain(h);
    expect(mailFor(h, 'p@example.test').filter((m) => m.subject.startsWith('Confirm your'))).toHaveLength(2);

    // The new version's cutoff: one more "closed" email for whoever is still waiting.
    moveClockTo(cutoffOf(moved.startsAt), 60_000);
    await drain(h);
    expect(closedMail('w1@example.test')).toHaveLength(1); // now confirmed: nothing new
    expect(closedMail('w2@example.test')).toHaveLength(2); // one per schedule version
    expect(await states(event.id)).toEqual([
      'a@example.test:CANCELLED(participant_cancelled)',
      'p@example.test:EXPIRED(cutoff)',
      'p@example.test:EXPIRED(cutoff)',
      'w1@example.test:CONFIRMED',
      'w2@example.test:WAITLISTED',
    ]);
    expect((await tasks(event.id)).map((t) => [t.schedule_version, t.status])).toEqual([
      [1, 'DONE'],
      [2, 'DONE'],
    ]);
  });
});
