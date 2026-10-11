import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GENERIC_INVALID_LINK_BODY } from '../src/platform/errors.js';
import {
  ORIGIN,
  createEvent,
  createHarness,
  drain,
  mailFor,
  moveClockTo,
  organizerHeaders,
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

async function cancel(token: string, body: unknown = { confirmed: true }) {
  return h.app.inject({
    method: 'POST',
    url: '/api/links/manage/cancel',
    headers: { origin: ORIGIN, authorization: `Link ${token}` },
    payload: body as Record<string, unknown>,
  });
}

async function setup(capacity: number, emails: string[], startsInHours = 72) {
  const s = await signIn(h, 'organizer@example.test');
  const event = await createEvent(h, s, { capacity, startsInHours });
  const results = [];
  for (const email of emails) results.push(await registerConfirmed(h, event.publicId, email));
  await drain(h);
  return { s, event, results };
}

describe('cancellation and FIFO promotion (P0 #3, #6, #8)', () => {
  it('promotes the first waiting participant in the same transaction and emails them a ticket', async () => {
    const { event, results } = await setup(1, ['a@example.test', 'b@example.test', 'c@example.test']);
    expect(results.map((r) => r.result)).toEqual(['confirmed', 'waitlisted', 'waitlisted']);

    const response = await cancel(tokenFromLink(results[0].links.management));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: 'cancelled', previousState: 'CONFIRMED' });

    const states = await h.db
      .selectFrom('app.registrations')
      .select(['email', 'state'])
      .where('event_id', '=', event.id)
      .orderBy('email')
      .execute();
    expect(states).toEqual([
      { email: 'a@example.test', state: 'CANCELLED' },
      { email: 'b@example.test', state: 'CONFIRMED' }, // first in line
      { email: 'c@example.test', state: 'WAITLISTED' },
    ]);

    await drain(h);
    const promotionMail = mailFor(h, 'b@example.test').find((m) =>
      m.subject.startsWith('A place became free'),
    );
    const ticket = await h.db
      .selectFrom('app.tickets as t')
      .innerJoin('app.registrations as r', 'r.id', 't.registration_id')
      .select('t.code')
      .where('r.email', '=', 'b@example.test')
      .executeTakeFirstOrThrow();
    expect(promotionMail?.text).toContain(ticket.code);
    expect(mailFor(h, 'a@example.test').some((m) => m.subject.startsWith('Registration cancelled'))).toBe(
      true,
    );

    // The cancelled participant's management link no longer works (FR-LNK-6).
    const reuse = await cancel(tokenFromLink(results[0].links.management));
    expect(reuse.statusCode).toBe(404);
    expect(reuse.body).toBe(GENERIC_INVALID_LINK_BODY);
  });

  it('promotes exactly one person when two confirmed participants cancel at once (AC-9)', async () => {
    const { event, results } = await setup(2, ['a@example.test', 'b@example.test', 'w@example.test']);
    await Promise.all([
      cancel(tokenFromLink(results[0].links.management)),
      cancel(tokenFromLink(results[1].links.management)),
    ]);
    const confirmed = await h.db
      .selectFrom('app.registrations')
      .select('email')
      .where('event_id', '=', event.id)
      .where('state', '=', 'CONFIRMED')
      .execute();
    expect(confirmed.map((r) => r.email)).toEqual(['w@example.test']);
    await drain(h);
    expect(
      mailFor(h, 'w@example.test').filter((m) => m.subject.startsWith('A place became free')),
    ).toHaveLength(1);
  });

  it('does not promote anyone when a waiting participant cancels', async () => {
    const { event, results } = await setup(1, ['a@example.test', 'b@example.test', 'c@example.test']);
    const response = await cancel(tokenFromLink(results[1].links.management));
    expect(response.json().previousState).toBe('WAITLISTED');
    const waiting = await h.db
      .selectFrom('app.registrations')
      .select('email')
      .where('event_id', '=', event.id)
      .where('state', '=', 'WAITLISTED')
      .execute();
    expect(waiting.map((r) => r.email)).toEqual(['c@example.test']);
  });

  it('requires an explicit confirmation and rejects cancellation after the start (API-D4, BR-10)', async () => {
    const { event, results } = await setup(1, ['a@example.test']);
    const token = tokenFromLink(results[0].links.management);
    expect((await cancel(token, {})).statusCode).toBe(422);
    moveClockTo(new Date(event.startsAt), 60_000);
    const late = await cancel(token);
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('cancellation_closed');
  });
});

describe('check-in (P0 #9, #10)', () => {
  async function checkIn(s: Session, eventId: string, code: string, requestId = randomUUID()) {
    return h.app.inject({
      method: 'POST',
      url: `/api/events/${eventId}/check-ins`,
      headers: organizerHeaders(s),
      payload: { code, requestId },
    });
  }

  it('checks a ticket in exactly once, and replays the original result for a repeated request ID', async () => {
    const { s, event, results } = await setup(2, ['a@example.test']);
    const code = results[0].ticket.code as string;

    expect((await checkIn(s, event.id, code)).json().outcome).toBe('OUTSIDE_CHECK_IN_WINDOW'); // 72 h before the start
    moveClockTo(new Date(event.startsAt), -30 * 60_000);

    const requestId = randomUUID();
    const first = await checkIn(s, event.id, code, requestId);
    expect(first.json().outcome).toBe('CHECKED_IN');
    expect((await checkIn(s, event.id, code, requestId)).json().outcome).toBe('CHECKED_IN'); // same request: replay
    const again = (await checkIn(s, event.id, code.toLowerCase())).json();
    expect(again.outcome).toBe('ALREADY_CHECKED_IN');
    expect(again.firstCheckedInAt).toBeTruthy();
    expect((await checkIn(s, event.id, 'ZZZZZZZZZZZZ')).json().outcome).toBe('INVALID_CODE');

    const rows = await h.db
      .selectFrom('app.check_ins')
      .select('id')
      .where('event_id', '=', event.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('gives exactly one success when ten devices scan the same ticket at once (AC-22)', async () => {
    const { s, event, results } = await setup(1, ['a@example.test']);
    moveClockTo(new Date(event.startsAt), -10 * 60_000);
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => checkIn(s, event.id, results[0].ticket.code)),
    );
    const outcomes = responses.map((r) => r.json().outcome).sort();
    expect(outcomes.filter((o) => o === 'CHECKED_IN')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'ALREADY_CHECKED_IN')).toHaveLength(9);
  });

  it('reports WRONG_EVENT for a ticket of another event, and hides other organizers’ events (AC-155)', async () => {
    const { s, event } = await setup(1, []);
    const other = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    const otherTicket = await registerConfirmed(h, other.publicId, 'z@example.test');
    moveClockTo(new Date(event.startsAt), -10 * 60_000);
    expect((await checkIn(s, event.id, otherTicket.ticket.code)).json().outcome).toBe('WRONG_EVENT');

    const intruder = await signIn(h, 'intruder@example.test');
    const response = await checkIn(intruder, event.id, otherTicket.ticket.code);
    expect(response.statusCode).toBe(404);
  });
});

describe('organizer dashboard (P0 #11)', () => {
  it('shows confirmed, waiting and checked-in counts from committed state', async () => {
    const { s, event, results } = await setup(2, ['a@example.test', 'b@example.test', 'c@example.test']);
    moveClockTo(new Date(event.startsAt), -10 * 60_000);
    await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/check-ins`,
      headers: organizerHeaders(s),
      payload: { code: results[0].ticket.code, requestId: randomUUID() },
    });
    const dash = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/dashboard`,
      headers: { cookie: s.cookie },
    });
    expect(dash.json().counts).toEqual({ confirmed: 2, waitlisted: 1, checkedIn: 1 });
  });
});

describe('event creation (FR-EVT-1, AC-185)', () => {
  it('is idempotent per organizer and request ID, and rejects a reused ID with different data', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const payload = {
      requestId: randomUUID(),
      title: 'Idempotent',
      localStart: '2099-05-01T18:00',
      timeZone: 'Europe/Berlin',
      capacity: 10,
    };
    const post = (p: Record<string, unknown>) =>
      h.app.inject({ method: 'POST', url: '/api/events', headers: organizerHeaders(s), payload: p });

    const [a, b] = await Promise.all([post(payload), post(payload)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json().event.id).toBe(b.json().event.id);
    const tasks = await h.db.selectFrom('app.scheduled_tasks').select('kind').orderBy('kind').execute();
    // One reminder and one cutoff task for version 1; the concurrent retry creates no extra tasks.
    expect(tasks.map((t) => t.kind)).toEqual(['cutoff_processing', 'reminder_fanout']);

    const changed = await post({ ...payload, capacity: 11 });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().code).toBe('request_id_reused');
    expect(a.json().event.startsAt).toBe('2099-05-01T16:00:00.000Z'); // Berlin summer time, UTC+2
  });

  it('rejects requests without a valid CSRF token (AC-85)', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { origin: ORIGIN, cookie: s.cookie, 'x-csrf-token': 'v1.1.wrong' },
      payload: {
        requestId: randomUUID(),
        title: 'x',
        localStart: '2099-05-01T18:00',
        timeZone: 'UTC',
        capacity: 1,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('csrf_failed');
  });
});
