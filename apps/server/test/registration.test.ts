import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GENERIC_INVALID_LINK_BODY } from '../src/platform/errors.js';
import {
  ORIGIN,
  confirm,
  createEvent,
  createHarness,
  drain,
  mailFor,
  register,
  registerAndGetVerifyToken,
  resetData,
  signIn,
  type Harness,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

describe('registration, verification and capacity (P0 #2, #4, #5, #7, #15)', () => {
  it('confirms a participant, issues a unique ticket and emails it', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
    const token = await registerAndGetVerifyToken(h, event.publicId, 'alice@example.test');

    const view = await h.app.inject({
      method: 'GET',
      url: '/api/links/verify',
      headers: { authorization: `Link ${token}` },
    });
    expect(view.statusCode).toBe(200);
    expect(view.json().state).toBe('awaiting_confirmation');

    const result = await confirm(h, token);
    expect(result.statusCode).toBe(200);
    const body = result.json();
    expect(body.result).toBe('confirmed');
    expect(body.ticket.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(body.links.management).toMatch(new RegExp(`^${ORIGIN}/manage#t=`));

    await drain(h);
    const ticketMail = mailFor(h, 'alice@example.test').find((m) => m.subject.startsWith('Your ticket'));
    expect(ticketMail?.text).toContain(body.ticket.code);
    expect(ticketMail?.text).toContain('admits one person, once');
  });

  it('never gives a duplicate email a second seat (P0 #4, BR-2)', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 5, startsInHours: 72 });
    const token = await registerAndGetVerifyToken(h, event.publicId, 'bob@example.test');
    await confirm(h, token);

    // Same address again, with different case: identical response, no new registration, no new seat.
    const again = await register(h, event.publicId, 'BOB@Example.test');
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual({ status: 'check_your_email' });
    await drain(h);

    const rows = await h.db
      .selectFrom('app.registrations')
      .select(['state'])
      .where('event_id', '=', event.id)
      .execute();
    expect(rows).toHaveLength(1);
    const confirmed = await h.db
      .selectFrom('app.events')
      .select('confirmed_count')
      .where('id', '=', event.id)
      .executeTakeFirstOrThrow();
    expect(confirmed.confirmed_count).toBe(1);
    // The address owner received an access email instead (FR-REG-8).
    expect(mailFor(h, 'bob@example.test').some((m) => m.subject.startsWith('Your registration'))).toBe(true);
  });

  it('puts participants on a FIFO waiting list when full (P0 #5)', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    const results = [];
    for (const name of ['p1', 'p2', 'p3']) {
      const token = await registerAndGetVerifyToken(h, event.publicId, `${name}@example.test`);
      results.push((await confirm(h, token)).json());
    }
    expect(results.map((r) => r.result)).toEqual(['confirmed', 'waitlisted', 'waitlisted']);
    expect(results.slice(1).map((r) => r.position)).toEqual([1, 2]);
  });

  it('gives exactly one participant the last seat when many confirm at once (P0 #15, AC-4)', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    const tokens: string[] = [];
    for (let i = 0; i < 12; i += 1)
      tokens.push(await registerAndGetVerifyToken(h, event.publicId, `racer${i}@example.test`));

    const responses = await Promise.all(tokens.map((t) => confirm(h, t)));
    const results = responses.map((r) => r.json());
    expect(results.filter((r) => r.result === 'confirmed')).toHaveLength(1);
    const positions = results
      .filter((r) => r.result === 'waitlisted')
      .map((r) => r.position)
      .sort((a, b) => a - b);
    expect(positions).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));

    // The trigger-maintained counter equals the actual number of confirmed rows (NFR-CON-5, AC-134).
    const check = await sql<{ drift: number }>`
      SELECT count(*)::int AS drift FROM app.events e
      WHERE e.confirmed_count <> (SELECT count(*) FROM app.registrations r WHERE r.event_id = e.id AND r.state = 'CONFIRMED')`.execute(
      h.db,
    );
    expect(check.rows[0]!.drift).toBe(0);
  });

  it('confirms only once when the same link is submitted twice at the same time (AC-81)', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const token = await registerAndGetVerifyToken(h, event.publicId, 'double@example.test');
    const [a, b] = await Promise.all([confirm(h, token), confirm(h, token)]);
    expect([a.json().result, b.json().result].sort()).toEqual(['already_confirmed', 'confirmed']);
    const tickets = await h.db
      .selectFrom('app.tickets')
      .select('id')
      .where('event_id', '=', event.id)
      .execute();
    expect(tickets).toHaveLength(1);
  });

  it('returns the byte-identical generic response for unknown, malformed and replaced links (FR-LNK-7)', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const first = await registerAndGetVerifyToken(h, event.publicId, 'carol@example.test');
    await registerAndGetVerifyToken(h, event.publicId, 'carol@example.test'); // resubmission replaces the first link

    for (const auth of [`Link ${first}`, 'Link not-a-token', `Link ${'A'.repeat(43)}`, '']) {
      const response = await h.app.inject({
        method: 'GET',
        url: '/api/links/verify',
        headers: { authorization: auth },
      });
      expect(response.statusCode).toBe(404);
      expect(response.body).toBe(GENERIC_INVALID_LINK_BODY);
    }
  });

  it('rejects state-changing requests from another origin (ADR-010 §6)', async () => {
    const s = await signIn(h, 'organizer@example.test');
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const response = await h.app.inject({
      method: 'POST',
      url: `/api/public/events/${event.publicId}/registrations`,
      headers: { origin: 'https://evil.example' },
      payload: { email: 'x@example.test' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('origin_check_failed');
  });
});
