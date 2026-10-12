import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cutoffOf } from '../src/platform/time.js';
import {
  ORIGIN,
  createEvent,
  createHarness,
  drain,
  linkToken,
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

// K-703 (PD-83): the owner cancels one CONFIRMED registration under the exclusive event lock, with one
// required notice, FIFO promotion of the freed seat and an audit record without personal data.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const MINUTE = 60_000;
const ORGANIZER = 'organizer@example.test';

function cancelOne(
  s: Session,
  eventId: string,
  registrationId: string,
  payload: unknown = { confirmed: true },
) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/registrations/${registrationId}/organizer-cancellation`,
    headers: organizerHeaders(s),
    payload: payload as Record<string, unknown>,
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

function cancelEvent(s: Session, eventId: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/cancellation`,
    headers: organizerHeaders(s),
    payload: { confirmed: true },
  });
}

function checkIn(s: Session, eventId: string, code: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/check-ins`,
    headers: organizerHeaders(s),
    payload: { code, requestId: randomUUID() },
  });
}

async function idOf(email: string): Promise<string> {
  return (
    await h.db
      .selectFrom('app.registrations')
      .select('id')
      .where('email', '=', email)
      .executeTakeFirstOrThrow()
  ).id;
}

async function stateOf(email: string): Promise<string> {
  const r = await h.db
    .selectFrom('app.registrations')
    .select(['state', 'end_reason'])
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  return r.end_reason ? `${r.state}(${r.end_reason})` : r.state;
}

async function outbox(eventId: string, type: string) {
  return h.db
    .selectFrom('app.outbox_messages')
    .select(['recipient_email', 'registration_id', 'is_required_notice'])
    .where('event_id', '=', eventId)
    .where('message_type', '=', type)
    .execute();
}

async function audits(eventId: string) {
  return h.db
    .selectFrom('app.audit_records')
    .selectAll()
    .where('event_id', '=', eventId)
    .where('action', '=', 'registration_cancel_by_organizer')
    .execute();
}

async function confirmedCount(eventId: string): Promise<number> {
  return (
    await h.db
      .selectFrom('app.events')
      .select('confirmed_count')
      .where('id', '=', eventId)
      .executeTakeFirstOrThrow()
  ).confirmed_count;
}

/** Requests started while this is held all wait on the event lock (as in waitlist-removal.test.ts). */
async function holdEventLock(eventId: string) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let locked!: () => void;
  const acquired = new Promise<void>((r) => (locked = r));
  const done = h.owner.transaction().execute(async (trx) => {
    await sql`SELECT id FROM app.events WHERE id = ${eventId} FOR UPDATE`.execute(trx);
    locked();
    await gate;
  });
  await acquired;
  const waitForBlocked = async (n: number) => {
    for (let i = 0; i < 200; i += 1) {
      const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`.execute(h.db);
      if (r.rows[0]!.n >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`fewer than ${n} requests reached the event lock`);
  };
  return { release, done, waitForBlocked };
}

/** Runs two requests so that both wait on the event lock, then lets them go in database order. */
async function race<A, B>(eventId: string, a: () => Promise<A>, b: () => Promise<B>): Promise<[A, B]> {
  const lock = await holdEventLock(eventId);
  const pa = a();
  const pb = b();
  try {
    await lock.waitForBlocked(2);
  } finally {
    lock.release();
    await lock.done;
  }
  return [await pa, await pb];
}

describe('organizer cancellation of one confirmed registration (K-703)', () => {
  it('cancels only the selected registration, with one notice and one audit record without personal data', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 50, startsInHours: 72, title: 'Design Night' });
    const a = await registerConfirmed(h, event.publicId, 'a@example.test');
    await registerConfirmed(h, event.publicId, 'b@example.test');
    await drain(h);

    const response = await cancelOne(s, event.id, await idOf('a@example.test'));
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: 'cancelled', promoted: 0 });
    expect(await stateOf('a@example.test')).toBe('CANCELLED(cancelled_by_organizer)');
    expect(await stateOf('b@example.test')).toBe('CONFIRMED');
    expect(await confirmedCount(event.id)).toBe(1);

    const notices = await outbox(event.id, 'organizer_cancellation');
    expect(notices).toEqual([
      {
        recipient_email: 'a@example.test',
        registration_id: await idOf('a@example.test'),
        is_required_notice: true,
      },
    ]);
    expect(await outbox(event.id, 'registration_cancelled')).toHaveLength(0); // not the participant's own
    const audit = await audits(event.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_kind: 'owner', outcome: 'cancelled' });
    expect(JSON.stringify(audit[0])).not.toContain('@');

    await drain(h);
    const [mail] = mailFor(h, 'a@example.test').filter((m) =>
      m.subject.startsWith('Registration cancelled by the organizer'),
    );
    expect(mail!.subject).toBe('Registration cancelled by the organizer: Design Night');
    expect(mail!.text).toContain('Your registration for "Design Night" has been cancelled by the organizer.');
    expect(mail!.text).toContain('Your ticket is no longer valid');
    expect(mail!.text).not.toMatch(/#t=/); // no management or share link
    expect(mail!.text).not.toContain(a.ticket.code); // no ticket code
  });

  it('invalidates the ticket and the participant links', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 5, startsInHours: 72 });
    const a = await registerConfirmed(h, event.publicId, 'a@example.test');
    expect((await cancelOne(s, event.id, await idOf('a@example.test'))).statusCode).toBe(200);

    moveClockTo(new Date(event.startsAt), -30 * MINUTE); // inside the check-in window
    const fresh = await signIn(h, ORGANIZER);
    expect((await checkIn(fresh, event.id, a.ticket.code)).json().outcome).toBe('TICKET_CANCELLED');
    const manage = await h.app.inject({
      method: 'GET',
      url: '/api/links/manage',
      headers: { authorization: `Link ${tokenFromLink(a.links.management)}` },
    });
    expect(manage.statusCode).toBe(404);
    const share = await h.app.inject({
      method: 'GET',
      url: '/api/links/ticket',
      headers: { authorization: `Link ${tokenFromLink(a.links.share)}` },
    });
    expect(share.json().state).toBe('not_available');
  });

  it('promotes the first waiting participant (FIFO) into the freed seat, before the cutoff only', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'a@example.test');
    await registerConfirmed(h, event.publicId, 'w1@example.test');
    await registerConfirmed(h, event.publicId, 'w2@example.test');

    const response = await cancelOne(s, event.id, await idOf('a@example.test'));
    expect(response.json()).toEqual({ result: 'cancelled', promoted: 1 });
    expect(await stateOf('w1@example.test')).toBe('CONFIRMED');
    expect(await stateOf('w2@example.test')).toBe('WAITLISTED');
    expect(await confirmedCount(event.id)).toBe(1);
    expect((await outbox(event.id, 'promotion')).map((m) => m.recipient_email)).toEqual(['w1@example.test']);

    // After the cutoff nobody is promoted (BR-9): the seat stays free.
    moveClockTo(cutoffOf(new Date(event.startsAt)), MINUTE);
    const late = await signIn(h, ORGANIZER);
    expect((await cancelOne(late, event.id, await idOf('w1@example.test'))).json()).toEqual({
      result: 'cancelled',
      promoted: 0,
    });
    expect(await stateOf('w2@example.test')).toBe('WAITLISTED');
    expect(await confirmedCount(event.id)).toBe(0);
  });

  it('refuses a waiting registration, a missing confirmation, a checked-in ticket and a started event', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    const a = await registerConfirmed(h, event.publicId, 'a@example.test');
    await registerConfirmed(h, event.publicId, 'w@example.test');
    const aId = await idOf('a@example.test');

    // A waiting registration uses "Remove from waiting list" instead (TX-W01 unchanged).
    const waiting = await cancelOne(s, event.id, await idOf('w@example.test'));
    expect(waiting.statusCode).toBe(409);
    expect(waiting.json().code).toBe('registration_not_confirmed');
    expect((await cancelOne(s, event.id, aId, {})).statusCode).toBe(422); // explicit confirmation required

    // Checked in: refused, and the check-in and the seat are kept.
    moveClockTo(new Date(event.startsAt), -30 * MINUTE);
    const door = await signIn(h, ORGANIZER);
    expect((await checkIn(door, event.id, a.ticket.code)).json().outcome).toBe('CHECKED_IN');
    const checkedIn = await cancelOne(door, event.id, aId);
    expect(checkedIn.statusCode).toBe(409);
    expect(checkedIn.json().code).toBe('ticket_checked_in');
    expect(await stateOf('a@example.test')).toBe('CONFIRMED');
    expect(await outbox(event.id, 'organizer_cancellation')).toHaveLength(0);

    // After the start: refused.
    moveClockTo(new Date(event.startsAt), MINUTE);
    const after = await signIn(h, ORGANIZER);
    expect((await cancelOne(after, event.id, aId)).json().code).toBe('event_started');
    expect(await audits(event.id)).toHaveLength(0);
  });

  it('a repeated or doubled request creates no second notice', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'a@example.test');
    const aId = await idOf('a@example.test');
    const [first, second] = await race(
      event.id,
      () => cancelOne(s, event.id, aId),
      () => cancelOne(s, event.id, aId),
    );
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const again = await cancelOne(s, event.id, aId);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('registration_not_confirmed');
    expect(await outbox(event.id, 'organizer_cancellation')).toHaveLength(1);
    expect(await audits(event.id)).toHaveLength(1);
  });

  it('hides the event from other organizers and refuses staff, missing CSRF and no session', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'a@example.test');
    const aId = await idOf('a@example.test');

    const other = await signIn(h, 'other@example.test');
    expect((await cancelOne(other, event.id, aId)).statusCode).toBe(404);
    const noCsrf = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/registrations/${aId}/organizer-cancellation`,
      headers: { origin: ORIGIN, cookie: organizerHeaders(s).cookie },
      payload: { confirmed: true },
    });
    expect(noCsrf.statusCode).toBe(403);
    const anonymous = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/registrations/${aId}/organizer-cancellation`,
      headers: { origin: ORIGIN },
      payload: { confirmed: true },
    });
    expect(anonymous.statusCode).toBe(401);

    // A staff device of this event (FR-STAFF-3: check-in only).
    await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/staff-invitations`,
      headers: organizerHeaders(s),
      payload: { email: 'helper@example.test' },
    });
    await drain(h);
    const invite = linkToken(
      mailFor(h, 'helper@example.test').find((m) => m.subject.startsWith('You are invited'))!,
      '/invite',
    );
    const accepted = await h.app.inject({
      method: 'POST',
      url: '/api/links/invite/accept',
      headers: { origin: ORIGIN, authorization: `Link ${invite}` },
    });
    const cookie = `__Host-ers_staff=${accepted.cookies.find((c) => c.name === '__Host-ers_staff')!.value}`;
    const { csrfToken } = (
      await h.app.inject({ method: 'GET', url: '/api/staff/session', headers: { cookie } })
    ).json();
    const staff = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/registrations/${aId}/organizer-cancellation`,
      headers: { origin: ORIGIN, cookie, 'x-csrf-token': csrfToken },
      payload: { confirmed: true },
    });
    expect([401, 403]).toContain(staff.statusCode);
    expect(await stateOf('a@example.test')).toBe('CONFIRMED');
    expect(await outbox(event.id, 'organizer_cancellation')).toHaveLength(0);
  });
});

describe('organizer cancellation races (K-703)', () => {
  it('vs. participant cancellation: both forced orders and a lock race end with exactly one cancellation', async () => {
    const run = async (order: 'organizer-first' | 'participant-first' | 'race') => {
      await resetData(h);
      const s = await signIn(h, ORGANIZER);
      const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
      const a = await registerConfirmed(h, event.publicId, 'a@example.test');
      await registerConfirmed(h, event.publicId, 'w@example.test');
      const aId = await idOf('a@example.test');
      let organizer, participant;
      if (order === 'organizer-first') {
        organizer = await cancelOne(s, event.id, aId);
        participant = await cancelByLink(a.links.management);
      } else if (order === 'participant-first') {
        participant = await cancelByLink(a.links.management);
        organizer = await cancelOne(s, event.id, aId);
      } else {
        [organizer, participant] = await race(
          event.id,
          () => cancelOne(s, event.id, aId),
          () => cancelByLink(a.links.management),
        );
      }
      const byOrganizer = organizer.statusCode === 200;
      expect(byOrganizer).toBe(participant.statusCode !== 200); // exactly one of the two
      if (!byOrganizer) expect(organizer.json().code).toBe('registration_not_confirmed');
      expect(await stateOf('a@example.test')).toBe(
        byOrganizer ? 'CANCELLED(cancelled_by_organizer)' : 'CANCELLED(participant_cancelled)',
      );
      expect((await outbox(event.id, 'organizer_cancellation')).length).toBe(byOrganizer ? 1 : 0);
      expect((await outbox(event.id, 'registration_cancelled')).length).toBe(byOrganizer ? 0 : 1);
      expect(await stateOf('w@example.test')).toBe('CONFIRMED'); // promoted once, either way
      expect(await outbox(event.id, 'promotion')).toHaveLength(1);
      expect(await confirmedCount(event.id)).toBe(1);
      return byOrganizer;
    };
    expect(await run('organizer-first')).toBe(true);
    expect(await run('participant-first')).toBe(false);
    for (let i = 0; i < 10; i += 1) await run('race');
  }, 120_000);

  it('vs. event cancellation: one notice per person, never both kinds', async () => {
    const run = async (order: 'organizer-first' | 'event-first' | 'race') => {
      await resetData(h);
      const s = await signIn(h, ORGANIZER);
      const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
      await registerConfirmed(h, event.publicId, 'a@example.test');
      await registerConfirmed(h, event.publicId, 'b@example.test');
      const aId = await idOf('a@example.test');
      let one, all;
      if (order === 'organizer-first') {
        one = await cancelOne(s, event.id, aId);
        all = await cancelEvent(s, event.id);
      } else if (order === 'event-first') {
        all = await cancelEvent(s, event.id);
        one = await cancelOne(s, event.id, aId);
      } else {
        [one, all] = await race(
          event.id,
          () => cancelOne(s, event.id, aId),
          () => cancelEvent(s, event.id),
        );
      }
      expect(all.statusCode).toBe(200);
      const toA = (rows: { recipient_email: string }[]) =>
        rows.filter((r) => r.recipient_email === 'a@example.test');
      const organizerNotices = toA(await outbox(event.id, 'organizer_cancellation'));
      const eventNotices = toA(await outbox(event.id, 'event_cancellation'));
      if (one.statusCode === 200) {
        expect(await stateOf('a@example.test')).toBe('CANCELLED(cancelled_by_organizer)');
        expect([organizerNotices.length, eventNotices.length]).toEqual([1, 0]);
      } else {
        expect(one.json().code).toBe('event_not_scheduled');
        expect(await stateOf('a@example.test')).toBe('CANCELLED(event_cancelled)');
        expect([organizerNotices.length, eventNotices.length]).toEqual([0, 1]);
      }
      expect(await stateOf('b@example.test')).toBe('CANCELLED(event_cancelled)');
      return one.statusCode === 200;
    };
    expect(await run('organizer-first')).toBe(true);
    expect(await run('event-first')).toBe(false);
    for (let i = 0; i < 4; i += 1) await run('race'); // event cancellation is rate-limited per account (PD-38)
  }, 120_000);

  it('vs. check-in: either the ticket is checked in and the cancellation refused, or the check-in answers TICKET_CANCELLED', async () => {
    const run = async (order: 'organizer-first' | 'checkin-first' | 'race') => {
      await resetData(h);
      const s = await signIn(h, ORGANIZER);
      const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
      const a = await registerConfirmed(h, event.publicId, 'a@example.test');
      const aId = await idOf('a@example.test');
      moveClockTo(new Date(event.startsAt), -30 * MINUTE);
      const door = await signIn(h, ORGANIZER);
      let one, scan;
      if (order === 'organizer-first') {
        one = await cancelOne(door, event.id, aId);
        scan = await checkIn(door, event.id, a.ticket.code);
      } else if (order === 'checkin-first') {
        scan = await checkIn(door, event.id, a.ticket.code);
        one = await cancelOne(door, event.id, aId);
      } else {
        [one, scan] = await race(
          event.id,
          () => cancelOne(door, event.id, aId),
          () => checkIn(door, event.id, a.ticket.code),
        );
      }
      const outcome = scan.json().outcome;
      if (one.statusCode === 200) {
        expect(outcome).toBe('TICKET_CANCELLED');
        expect(await stateOf('a@example.test')).toBe('CANCELLED(cancelled_by_organizer)');
      } else {
        expect(one.json().code).toBe('ticket_checked_in');
        expect(outcome).toBe('CHECKED_IN');
        expect(await stateOf('a@example.test')).toBe('CONFIRMED');
      }
      return one.statusCode === 200;
    };
    expect(await run('organizer-first')).toBe(true);
    expect(await run('checkin-first')).toBe(false);
    for (let i = 0; i < 10; i += 1) await run('race');
  }, 120_000);
});
