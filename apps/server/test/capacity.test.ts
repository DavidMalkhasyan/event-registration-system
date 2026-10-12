import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  confirm,
  createEvent,
  createHarness,
  drain,
  mailFor,
  moveClockTo,
  organizerHeaders,
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
const promotionMail = (email: string) =>
  mailFor(h, email).filter((m) => m.subject.startsWith('A place became free'));

function setCapacity(s: Session, eventId: string, capacity: number) {
  return h.app.inject({
    method: 'PUT',
    url: `/api/events/${eventId}/capacity`,
    headers: organizerHeaders(s),
    payload: { capacity },
  });
}

function cancelByLink(managementLink: string) {
  return h.app.inject({
    method: 'POST',
    url: '/api/links/manage/cancel',
    headers: { origin: ORIGIN, authorization: `Link ${tokenFromLink(managementLink)}` },
    payload: { confirmed: true },
  });
}

async function dashboard(s: Session, eventId: string) {
  const response = await h.app.inject({
    method: 'GET',
    url: `/api/events/${eventId}/dashboard`,
    headers: { cookie: s.cookie },
  });
  return response.json().counts as { confirmed: number; waitlisted: number; checkedIn: number };
}

/** Confirmed and waiting e-mails in order: confirmed by e-mail, waiting by position. */
async function people(eventId: string) {
  const confirmed = await h.db
    .selectFrom('app.registrations')
    .select('email')
    .where('event_id', '=', eventId)
    .where('state', '=', 'CONFIRMED')
    .orderBy('email')
    .execute();
  const waiting = await h.db
    .selectFrom('app.registrations')
    .select('email')
    .where('event_id', '=', eventId)
    .where('state', '=', 'WAITLISTED')
    .orderBy('waitlist_seq')
    .execute();
  return { confirmed: confirmed.map((r) => r.email), waiting: waiting.map((r) => r.email) };
}

/** Database invariants that every capacity change must preserve (BR-1, BR-5, NFR-CON-5). */
async function expectInvariants(eventId: string, beforeCutoff = true) {
  const row = await sql<{
    capacity: number;
    confirmed_count: number;
    confirmed_rows: number;
    waiting_rows: number;
    confirmed_with_one_ticket: number;
  }>`
    SELECT e.capacity, e.confirmed_count,
      (SELECT count(*)::int FROM app.registrations r WHERE r.event_id = e.id AND r.state = 'CONFIRMED') AS confirmed_rows,
      (SELECT count(*)::int FROM app.registrations r WHERE r.event_id = e.id AND r.state = 'WAITLISTED') AS waiting_rows,
      (SELECT count(*)::int FROM app.registrations r WHERE r.event_id = e.id AND r.state = 'CONFIRMED'
         AND (SELECT count(*) FROM app.tickets t WHERE t.registration_id = r.id) = 1) AS confirmed_with_one_ticket
    FROM app.events e WHERE e.id = ${eventId}`.execute(h.db);
  const r = row.rows[0]!;
  expect(r.confirmed_count).toBe(r.confirmed_rows); // trigger-maintained counter, no drift
  expect(r.confirmed_rows).toBeLessThanOrEqual(r.capacity); // BR-1
  expect(r.confirmed_with_one_ticket).toBe(r.confirmed_rows); // every confirmed has exactly one ticket
  if (beforeCutoff) expect(r.waiting_rows === 0 || r.confirmed_rows === r.capacity).toBe(true); // BR-5
  return r;
}

/** An event with `capacity` seats, the given confirmed participants, then the given waiting ones. */
async function setup(capacity: number, confirmed: string[], waiting: string[]) {
  const s = await signIn(h, 'organizer@example.test');
  const event = await createEvent(h, s, { capacity, startsInHours: 72 });
  const results: Record<
    string,
    { result: string; links: { management: string }; ticket?: { code: string } }
  > = {};
  for (const email of [...confirmed, ...waiting])
    results[email] = await registerConfirmed(h, event.publicId, email);
  await drain(h);
  for (const email of confirmed) expect(results[email]!.result).toBe('confirmed');
  for (const email of waiting) expect(results[email]!.result).toBe('waitlisted');
  return { s, event, results };
}

describe('capacity changes (K-304a: FR-EVT-7, FR-EVT-8, TX-E03)', () => {
  it('only the owner can change capacity; a session and the CSRF token are required', async () => {
    const { event } = await setup(2, ['a@example.test'], []);
    const intruder = await signIn(h, 'intruder@example.test');
    expect((await setCapacity(intruder, event.id, 10)).statusCode).toBe(404); // other organizers' events are hidden

    const noSession = await h.app.inject({
      method: 'PUT',
      url: `/api/events/${event.id}/capacity`,
      headers: { origin: ORIGIN },
      payload: { capacity: 10 },
    });
    expect(noSession.statusCode).toBe(401);

    const owner = await signIn(h, 'organizer@example.test');
    const badCsrf = await h.app.inject({
      method: 'PUT',
      url: `/api/events/${event.id}/capacity`,
      headers: { origin: ORIGIN, cookie: owner.cookie, 'x-csrf-token': 'v1.1.wrong' },
      payload: { capacity: 10 },
    });
    expect(badCsrf.statusCode).toBe(403);
    expect(badCsrf.json().code).toBe('csrf_failed');

    for (const payload of [
      { capacity: 0 },
      { capacity: 2.5 },
      { capacity: '3' },
      { capacity: 3, extra: 1 },
    ]) {
      const invalid = await h.app.inject({
        method: 'PUT',
        url: `/api/events/${event.id}/capacity`,
        headers: organizerHeaders(owner),
        payload,
      });
      expect(invalid.statusCode).toBe(422);
    }
    const row = await h.db
      .selectFrom('app.events')
      .select('capacity')
      .where('id', '=', event.id)
      .executeTakeFirstOrThrow();
    expect(row.capacity).toBe(2); // nothing above changed anything
  });

  it('an increase promotes waiting participants FIFO in the same transaction, each with one ticket email (AC-15)', async () => {
    const { s, event, results } = await setup(
      1,
      ['a@example.test'],
      ['w1@example.test', 'w2@example.test', 'w3@example.test'],
    );
    const response = await setCapacity(s, event.id, 3); // raised by 2
    expect(response.statusCode).toBe(200);
    expect(response.json().capacity).toBe(3);

    // Committed together with the capacity: no window in which seats are free while people wait.
    expect(await people(event.id)).toEqual({
      confirmed: ['a@example.test', 'w1@example.test', 'w2@example.test'],
      waiting: ['w3@example.test'],
    });
    expect(await dashboard(s, event.id)).toEqual({ confirmed: 3, waitlisted: 1, checkedIn: 0 });
    await drain(h);

    for (const email of ['w1@example.test', 'w2@example.test']) {
      const mails = promotionMail(email);
      expect(mails).toHaveLength(1);
      const ticket = await h.db
        .selectFrom('app.tickets as t')
        .innerJoin('app.registrations as r', 'r.id', 't.registration_id')
        .select('t.code')
        .where('r.email', '=', email)
        .executeTakeFirstOrThrow();
      expect(mails[0]!.text).toContain(ticket.code);
    }
    expect(promotionMail('w3@example.test')).toHaveLength(0);
    expect(promotionMail('a@example.test')).toHaveLength(0);
    // w3 is now first in line.
    const manage = await h.app.inject({
      method: 'GET',
      url: '/api/links/manage',
      headers: { authorization: `Link ${tokenFromLink(results['w3@example.test']!.links.management)}` },
    });
    expect(manage.json().position).toBe(1);
    await expectInvariants(event.id);
  });

  it('any decrease is refused with the current capacity, also above the confirmed count; nothing changes (A-2)', async () => {
    const { s, event, results } = await setup(5, ['a@example.test', 'b@example.test'], []);
    // A check-in must survive any capacity request.
    moveClockTo(new Date(event.startsAt), -HOUR);
    const checkIn = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/check-ins`,
      headers: organizerHeaders(s),
      payload: { code: results['a@example.test']!.ticket!.code, requestId: randomUUID() },
    });
    expect(checkIn.json().outcome).toBe('CHECKED_IN');

    for (const lower of [4, 2, 1]) {
      const refused = await setCapacity(s, event.id, lower);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: 'capacity_decrease_not_allowed', currentCapacity: 5 });
    }
    const same = await setCapacity(s, event.id, 5);
    expect(same.statusCode).toBe(200);
    expect(same.json().capacity).toBe(5);
    expect(await dashboard(s, event.id)).toEqual({ confirmed: 2, waitlisted: 0, checkedIn: 1 });
    const audits = await h.db
      .selectFrom('app.audit_records')
      .select('id')
      .where('event_id', '=', event.id)
      .where('action', '=', 'capacity_change')
      .execute();
    expect(audits).toHaveLength(0); // neither refusals nor the unchanged value are changes
    await expectInvariants(event.id, false);
  });

  it('rejects values outside 1 to 100 000 and fractions instead of changing them', async () => {
    const { s, event } = await setup(5, [], []);
    for (const capacity of [0, -3, 100_001, 2.5]) {
      const response = await setCapacity(s, event.id, capacity);
      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe('validation_failed');
    }
    expect((await setCapacity(s, event.id, 100_000)).json().capacity).toBe(100_000);
  });

  it('an increase after the cutoff promotes no one (FR-WL-4, BR-9)', async () => {
    const { s, event } = await setup(1, ['a@example.test'], ['w1@example.test']);
    moveClockTo(new Date(event.startsAt), -2 * HOUR + 60_000);
    const response = await setCapacity(s, event.id, 3);
    expect(response.statusCode).toBe(200);
    expect(await people(event.id)).toEqual({ confirmed: ['a@example.test'], waiting: ['w1@example.test'] });
    await drain(h);
    expect(promotionMail('w1@example.test')).toHaveLength(0);
    await expectInvariants(event.id, false);
  });

  it('repeated and simultaneous identical requests promote once and notify once', async () => {
    const { s, event } = await setup(1, ['a@example.test'], ['w1@example.test', 'w2@example.test']);
    const responses = await Promise.all([1, 2, 3].map(() => setCapacity(s, event.id, 2)));
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    expect((await setCapacity(s, event.id, 2)).statusCode).toBe(200); // a later retry
    await drain(h);

    expect(await people(event.id)).toEqual({
      confirmed: ['a@example.test', 'w1@example.test'],
      waiting: ['w2@example.test'],
    });
    expect(promotionMail('w1@example.test')).toHaveLength(1);
    expect(promotionMail('w2@example.test')).toHaveLength(0);
    const audits = await h.db
      .selectFrom('app.audit_records')
      .select('details')
      .where('event_id', '=', event.id)
      .where('action', '=', 'capacity_change')
      .execute();
    expect(audits).toHaveLength(1); // only the request that changed something is recorded
    await expectInvariants(event.id);
  });

  it('a verification racing a capacity increase never breaks confirmed ≤ capacity (AC-14, concurrency)', async () => {
    for (let round = 0; round < 4; round += 1) {
      await resetData(h);
      const { s, event } = await setup(1, ['a@example.test'], []);
      const token = await registerAndGetVerifyToken(h, event.publicId, 'late@example.test');
      const [verification, change] = await Promise.all([confirm(h, token), setCapacity(s, event.id, 2)]);

      // Serialized by the event lock. If the increase won, the verifier takes the new seat; if the
      // verification won, it joined the waiting list and the increase promoted it. Either way: confirmed.
      expect(change.statusCode).toBe(200);
      expect(['confirmed', 'waitlisted']).toContain(verification.json().result);
      expect(await people(event.id)).toEqual({
        confirmed: ['a@example.test', 'late@example.test'],
        waiting: [],
      });
      await expectInvariants(event.id);
    }
  });

  it('a cancellation racing a capacity increase fills every free seat FIFO, exactly once (concurrency)', async () => {
    for (let round = 0; round < 4; round += 1) {
      await resetData(h);
      const { s, event, results } = await setup(
        2,
        ['a@example.test', 'b@example.test'],
        ['w1@example.test', 'w2@example.test', 'w3@example.test'],
      );
      const [cancel, change] = await Promise.all([
        cancelByLink(results['a@example.test']!.links.management),
        setCapacity(s, event.id, 3),
      ]);
      expect(cancel.statusCode).toBe(200);
      expect(change.statusCode).toBe(200);
      // Whatever the order: capacity 3 and one cancellation → b plus the first two in line.
      expect(await people(event.id)).toEqual({
        confirmed: ['b@example.test', 'w1@example.test', 'w2@example.test'],
        waiting: ['w3@example.test'],
      });
      await drain(h);
      expect(promotionMail('w1@example.test')).toHaveLength(1);
      expect(promotionMail('w2@example.test')).toHaveLength(1);
      expect(promotionMail('w3@example.test')).toHaveLength(0);
      await expectInvariants(event.id);
    }
  });

  it('simultaneous different capacity changes end at the highest value, never lower (concurrency)', async () => {
    const { s, event } = await setup(
      1,
      ['a@example.test'],
      ['w1@example.test', 'w2@example.test', 'w3@example.test', 'w4@example.test'],
    );
    const responses = await Promise.all([
      setCapacity(s, event.id, 3),
      setCapacity(s, event.id, 2),
      setCapacity(s, event.id, 4),
    ]);
    // Each is decided against the capacity committed before it: an increase succeeds; a value below
    // an increase that committed first is refused with that capacity. The highest value always wins.
    for (const r of responses) {
      if (r.statusCode === 409) expect(r.json().code).toBe('capacity_decrease_not_allowed');
      else expect(r.statusCode).toBe(200);
    }
    expect(responses[2]!.statusCode).toBe(200);
    const { capacity, confirmed_rows } = await expectInvariants(event.id);
    expect(capacity).toBe(4);
    const { confirmed, waiting } = await people(event.id);
    expect(confirmed_rows).toBe(4);
    // FIFO: the first three in line are confirmed, the last one waits.
    const queue = ['w1@example.test', 'w2@example.test', 'w3@example.test', 'w4@example.test'];
    expect(confirmed).toEqual(['a@example.test', ...queue.slice(0, 3)].sort());
    expect(waiting).toEqual(queue.slice(3));
    await drain(h);
    for (const email of queue) expect(promotionMail(email)).toHaveLength(confirmed.includes(email) ? 1 : 0);
  });
});
