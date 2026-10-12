import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Dispatcher } from '../src/modules/messaging/dispatcher.js';
import { FakeEmailProvider, type EmailProvider } from '../src/modules/messaging/fake-provider.js';
import { GENERIC_INVALID_LINK_BODY } from '../src/platform/errors.js';
import {
  ORIGIN,
  createEvent,
  createHarness,
  drain,
  linkToken,
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ORGANIZER = 'organizer@example.test';
const removalMail = (email: string) =>
  mailFor(h, email).filter((m) => m.subject.startsWith('Removed from the waiting list'));
const eventCancelMail = (email: string) =>
  mailFor(h, email).filter((m) => m.subject.startsWith('Event cancelled'));
const regCancelledMail = (email: string) =>
  mailFor(h, email).filter((m) => m.subject.startsWith('Registration cancelled'));

function remove(s: Session, eventId: string, registrationId: string, payload: unknown = { confirmed: true }) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/registrations/${registrationId}/waitlist-removal`,
    headers: organizerHeaders(s),
    payload: payload as Record<string, unknown>,
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

function cancelByLink(managementLink: string) {
  return h.app.inject({
    method: 'POST',
    url: '/api/links/manage/cancel',
    headers: { origin: ORIGIN, authorization: `Link ${tokenFromLink(managementLink)}` },
    payload: { confirmed: true },
  });
}

function manageView(managementLink: string) {
  return h.app.inject({
    method: 'GET',
    url: '/api/links/manage',
    headers: { authorization: `Link ${tokenFromLink(managementLink)}` },
  });
}

async function registrationId(email: string): Promise<string> {
  return (
    await h.db
      .selectFrom('app.registrations')
      .select('id')
      .where('email', '=', email)
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow()
  ).id;
}

async function states(eventId: string) {
  const rows = await h.db
    .selectFrom('app.registrations')
    .select(['email', 'state', 'end_reason'])
    .where('event_id', '=', eventId)
    .orderBy('email')
    .execute();
  return rows.map((r) => `${r.email}:${r.state}${r.end_reason ? `(${r.end_reason})` : ''}`);
}

async function outboxFor(eventId: string, type: string) {
  return h.db
    .selectFrom('app.outbox_messages')
    .select(['recipient_email', 'status', 'is_required_notice'])
    .where('event_id', '=', eventId)
    .where('message_type', '=', type)
    .orderBy('recipient_email')
    .execute();
}

async function removalAudits(eventId: string) {
  return h.db
    .selectFrom('app.audit_records')
    .selectAll()
    .where('event_id', '=', eventId)
    .where('action', '=', 'waitlist_remove')
    .execute();
}

async function confirmedCount(eventId: string) {
  return (
    await h.db
      .selectFrom('app.events')
      .select('confirmed_count')
      .where('id', '=', eventId)
      .executeTakeFirstOrThrow()
  ).confirmed_count;
}

/** Capacity 1: A confirmed, then `waiting` participants W1, W2, … on the waiting list in that order. */
async function setup(waiting = 4, s?: Session) {
  s ??= await signIn(h, ORGANIZER);
  const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
  const tag = event.id.slice(-6);
  const a = await registerConfirmed(h, event.publicId, `a-${tag}@example.test`);
  const w: { email: string; id: string; links: { management: string } }[] = [];
  for (let i = 1; i <= waiting; i += 1) {
    const email = `w${i}-${tag}@example.test`;
    const body = await registerConfirmed(h, event.publicId, email);
    expect(body.result).toBe('waitlisted');
    w.push({ email, id: await registrationId(email), links: body.links });
  }
  await drain(h);
  return {
    s,
    event,
    a: { ...a, email: `a-${tag}@example.test`, id: await registrationId(`a-${tag}@example.test`) },
    w,
  };
}

/** See portal.test.ts: requests started while this is held are all waiting on the event lock. */
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

/** A provider that fails ambiguously (as a network timeout would) for the first `n` sends. */
class FlakyProvider implements EmailProvider {
  constructor(
    private readonly inner: EmailProvider,
    private failures: number,
  ) {}
  async send(input: Parameters<EmailProvider['send']>[0]) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('simulated timeout');
    }
    return this.inner.send(input);
  }
}

describe('waiting-list removal (K-305b: FR-WL-10 to FR-WL-13, TX-W01)', () => {
  it('removes position 2 of 4: the rest move up in order, nobody is promoted, one notice and one audit (AC-76)', async () => {
    const { s, event, w } = await setup(4);
    const response = await remove(s, event.id, w[1]!.id, { confirmed: true, reason: '  Duplicate entry  ' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: 'removed' });

    const row = await h.db
      .selectFrom('app.registrations')
      .selectAll()
      .where('id', '=', w[1]!.id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      state: 'CANCELLED',
      end_reason: 'removed_by_organizer',
      removal_reason: 'Duplicate entry',
    });
    expect(await confirmedCount(event.id)).toBe(1);
    const participants = (
      await h.app.inject({
        method: 'GET',
        url: `/api/events/${event.id}/participants`,
        headers: organizerHeaders(s),
      })
    ).json().items as { email: string; state: string; position?: number }[];
    expect(participants.filter((p) => p.state === 'WAITLISTED').map((p) => [p.email, p.position])).toEqual([
      [w[0]!.email, 1],
      [w[2]!.email, 2],
      [w[3]!.email, 3],
    ]);
    expect(participants.find((p) => p.email === w[1]!.email)).toMatchObject({ state: 'CANCELLED' });
    expect(participants.find((p) => p.email === w[1]!.email)!.position).toBeUndefined();
    const dashboard = (
      await h.app.inject({
        method: 'GET',
        url: `/api/events/${event.id}/dashboard`,
        headers: organizerHeaders(s),
      })
    ).json();
    expect(dashboard.counts).toMatchObject({ confirmed: 1, waitlisted: 3 });
    expect((await manageView(w[2]!.links.management)).json().position).toBe(2);

    const audits = await removalAudits(event.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_kind: 'owner',
      actor_account_id: s.accountId,
      registration_id: w[1]!.id,
      outcome: 'removed',
    });
    expect(audits[0]!.details).toEqual({ reasonGiven: true, position: 2 });
    expect(JSON.stringify(audits[0])).not.toMatch(/@example\.test|Duplicate/); // PD-63, AC-100
    const notices = await outboxFor(event.id, 'waitlist_removed');
    expect(notices).toEqual([{ recipient_email: w[1]!.email, status: 'QUEUED', is_required_notice: true }]);

    // The removed registration's management link is just another invalid link (FR-LNK-6).
    expect((await manageView(w[1]!.links.management)).body).toBe(GENERIC_INVALID_LINK_BODY);
    expect((await cancelByLink(w[1]!.links.management)).body).toBe(GENERIC_INVALID_LINK_BODY);

    await drain(h);
    const [mail] = removalMail(w[1]!.email);
    expect(removalMail(w[1]!.email)).toHaveLength(1);
    expect(mail!.text).toContain('has removed you from the waiting list');
    // FR-NTF-14: no links to manage or share, no ticket wording, not the organizer's reason.
    expect(mail!.text + mail!.html).not.toMatch(/\/manage|\/ticket|#t=|ticket code|your ticket|Duplicate/i);
    expect(mailFor(h, w[2]!.email).filter((m) => !m.subject.startsWith('Confirm'))).toHaveLength(1); // only its waitlist email
  });

  it('after the cutoff with a free seat, a removal promotes nobody (AC-77, BR-24)', async () => {
    const { s, event, a, w } = await setup(2);
    moveClockTo(new Date(event.startsAt), -HOUR); // past the cutoff (start − 2 h)
    expect((await cancelByLink(a.links.management)).statusCode).toBe(200);
    expect(await confirmedCount(event.id)).toBe(0); // no promotion after the cutoff
    expect((await remove(s, event.id, w[0]!.id)).statusCode).toBe(200);
    expect(await confirmedCount(event.id)).toBe(0);
    expect(await states(event.id)).toEqual([
      `${a.email}:CANCELLED(participant_cancelled)`,
      `${w[0]!.email}:CANCELLED(removed_by_organizer)`,
      `${w[1]!.email}:WAITLISTED`,
    ]);
    expect(await outboxFor(event.id, 'promotion')).toHaveLength(0);
  });

  it('never touches a non-waiting registration; a repeat gets 409 not_waitlisted (AC-92)', async () => {
    const { s, event, a, w } = await setup(2);
    const pendingToken = await registerAndGetVerifyToken(h, event.publicId, 'p@example.test');
    expect(pendingToken).toBeTruthy();
    const before = await states(event.id);
    for (const id of [a.id, await registrationId('p@example.test')]) {
      const response = await remove(s, event.id, id);
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('not_waitlisted');
    }
    expect(await states(event.id)).toEqual(before);
    expect(await confirmedCount(event.id)).toBe(1);

    expect((await remove(s, event.id, w[0]!.id)).statusCode).toBe(200);
    const again = await remove(s, event.id, w[0]!.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('not_waitlisted');
    expect(await outboxFor(event.id, 'waitlist_removed')).toHaveLength(1);
    expect(await removalAudits(event.id)).toHaveLength(1);

    // After a promotion the former waiting entry is CONFIRMED and can't be removed.
    expect((await cancelByLink(a.links.management)).statusCode).toBe(200);
    expect(await states(event.id)).toContain(`${w[1]!.email}:CONFIRMED`);
    expect((await remove(s, event.id, w[1]!.id)).json().code).toBe('not_waitlisted');
    expect(await states(event.id)).toContain(`${w[1]!.email}:CONFIRMED`);
    expect(await outboxFor(event.id, 'waitlist_removed')).toHaveLength(1);
  });

  it('only the owner, with session, CSRF, Origin and the confirmation; staff 403, others 404 (AC-79)', async () => {
    const { s, event, w } = await setup(1);
    const target = w[0]!;
    const url = `/api/events/${event.id}/registrations/${target.id}/waitlist-removal`;
    const post = (headers: Record<string, string>, payload: object = { confirmed: true }) =>
      h.app.inject({ method: 'POST', url, headers, payload });

    expect((await post({ origin: ORIGIN })).statusCode).toBe(401);
    // A participant's management link is not an organizer credential.
    expect(
      (await post({ origin: ORIGIN, authorization: `Link ${tokenFromLink(target.links.management)}` }))
        .statusCode,
    ).toBe(401);
    expect((await post({ origin: ORIGIN, cookie: s.cookie })).json().code).toBe('csrf_failed');
    expect((await post({ ...organizerHeaders(s), origin: 'https://evil.example' })).json().code).toBe(
      'origin_check_failed',
    );
    for (const payload of [
      {},
      { confirmed: false },
      { confirmed: 'true' },
      { confirmed: true, reason: 'x'.repeat(501) },
      { confirmed: true, extra: 1 },
    ]) {
      const response = await post(organizerHeaders(s), payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    const other = await signIn(h, 'other@example.test');
    expect((await remove(other, event.id, target.id)).statusCode).toBe(404);

    // A staff device of this event (K-406).
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/api/events/${event.id}/staff-invitations`,
          headers: organizerHeaders(s),
          payload: { email: 'helper@example.test' },
        })
      ).statusCode,
    ).toBe(201);
    await drain(h);
    const accepted = await h.app.inject({
      method: 'POST',
      url: '/api/links/invite/accept',
      headers: {
        origin: ORIGIN,
        authorization: `Link ${linkToken(mailFor(h, 'helper@example.test')[0]!, '/invite')}`,
      },
    });
    const cookie = `__Host-ers_staff=${accepted.cookies.find((c) => c.name === '__Host-ers_staff')!.value}`;
    const csrf = (
      await h.app.inject({ method: 'GET', url: '/api/staff/session', headers: { cookie } })
    ).json().csrfToken;
    const asStaff = await post({ origin: ORIGIN, cookie, 'x-csrf-token': csrf });
    expect(asStaff.statusCode).toBe(403);
    expect(asStaff.json().code).toBe('forbidden');

    // Unknown, malformed, or another event's registration.
    const otherEvent = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    for (const [eventId, id] of [
      [event.id, randomUUID()],
      [event.id, 'nope'],
      [otherEvent.id, target.id],
    ] as const) {
      expect((await remove(s, eventId, id)).statusCode).toBe(404);
    }
    expect(await states(event.id)).toContain(`${target.email}:WAITLISTED`);
    expect(await outboxFor(event.id, 'waitlist_removed')).toHaveLength(0);
    expect(await removalAudits(event.id)).toHaveLength(0);
  });

  it('a removal transaction forced to fail leaves no notice, no audit and the original position (AC-90)', async () => {
    const { s, event, w } = await setup(3);
    await sql`CREATE FUNCTION app.test_fail_removal() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END $$`.execute(h.owner);
    await sql`CREATE TRIGGER test_fail_removal BEFORE INSERT ON app.audit_records
      FOR EACH ROW WHEN (NEW.action = 'waitlist_remove') EXECUTE FUNCTION app.test_fail_removal()`.execute(
      h.owner,
    );
    try {
      const response = await remove(s, event.id, w[1]!.id, { confirmed: true, reason: 'x' });
      expect(response.statusCode).toBe(500);
    } finally {
      await sql`DROP TRIGGER test_fail_removal ON app.audit_records`.execute(h.owner);
      await sql`DROP FUNCTION app.test_fail_removal()`.execute(h.owner);
    }
    const row = await h.db
      .selectFrom('app.registrations')
      .select(['state', 'removal_reason'])
      .where('id', '=', w[1]!.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ state: 'WAITLISTED', removal_reason: null });
    expect((await manageView(w[1]!.links.management)).json().position).toBe(2);
    expect(await outboxFor(event.id, 'waitlist_removed')).toHaveLength(0);
    expect(await removalAudits(event.id)).toHaveLength(0);
    // And it works once the failure is gone.
    expect((await remove(s, event.id, w[1]!.id)).statusCode).toBe(200);
  });

  it('a cancelled event refuses the removal with 409 event_not_scheduled (FR-WL-14 b)', async () => {
    const { s, event, w } = await setup(1);
    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    const response = await remove(s, event.id, w[0]!.id);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('event_not_scheduled');
    expect(await outboxFor(event.id, 'waitlist_removed')).toHaveLength(0);
  });

  it('the removal notice survives an ambiguous send failure and a later event cancellation (BR-23, FR-NTF-14)', async () => {
    const { s, event, w } = await setup(2);
    expect((await remove(s, event.id, w[0]!.id)).statusCode).toBe(200);
    const dispatcher = new Dispatcher(
      h.db,
      new FlakyProvider(new FakeEmailProvider(h.mailboxDir), 1),
      ORIGIN,
      `test-${randomUUID()}`,
    );
    await dispatcher.runOnce();
    expect((await outboxFor(event.id, 'waitlist_removed')).map((m) => m.status)).toEqual(['WAITING_RETRY']);
    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    moveClockTo(new Date(), 2 * MINUTE); // past the first backoff
    await drain(h);
    expect((await outboxFor(event.id, 'waitlist_removed')).map((m) => m.status)).toEqual(['ACCEPTED']);
    expect(removalMail(w[0]!.email)).toHaveLength(1);
    expect(eventCancelMail(w[0]!.email)).toHaveLength(0); // removed first: no event-cancellation email
    expect(eventCancelMail(w[1]!.email)).toHaveLength(1);
  });
});

describe('waiting-list removal races (FR-WL-14, NFR-CON-1)', () => {
  it('removal vs. promotion of the same entry: exactly one outcome, the seat is never left empty (AC-78)', async () => {
    const s = await signIn(h, ORGANIZER);
    const outcomes = new Set<string>();
    const run = async (order: 'cancel-first' | 'remove-first' | 'race') => {
      const { event, a, w } = await setup(2, s);
      let removal: Awaited<ReturnType<typeof remove>>;
      let cancel: Awaited<ReturnType<typeof cancelByLink>>;
      if (order === 'cancel-first') {
        cancel = await cancelByLink(a.links.management);
        removal = await remove(s, event.id, w[0]!.id);
      } else if (order === 'remove-first') {
        removal = await remove(s, event.id, w[0]!.id);
        cancel = await cancelByLink(a.links.management);
      } else {
        const lock = await holdEventLock(event.id);
        const r = remove(s, event.id, w[0]!.id);
        const c = cancelByLink(a.links.management);
        try {
          await lock.waitForBlocked(2);
        } finally {
          lock.release();
          await lock.done;
        }
        [removal, cancel] = [await r, await c];
      }
      expect(cancel.statusCode).toBe(200);
      const st = await states(event.id);
      expect(await confirmedCount(event.id)).toBe(1); // the freed seat is filled
      if (removal.statusCode === 200) {
        // (b) W1 removed, W2 promoted.
        expect(st).toContain(`${w[0]!.email}:CANCELLED(removed_by_organizer)`);
        expect(st).toContain(`${w[1]!.email}:CONFIRMED`);
        expect(await outboxFor(event.id, 'waitlist_removed')).toHaveLength(1);
        outcomes.add('removed');
      } else {
        // (a) W1 promoted, the removal rejected and no notice.
        expect(removal.json().code).toBe('not_waitlisted');
        expect(st).toContain(`${w[0]!.email}:CONFIRMED`);
        expect(st).toContain(`${w[1]!.email}:WAITLISTED`);
        expect(await outboxFor(event.id, 'waitlist_removed')).toHaveLength(0);
        expect(await removalAudits(event.id)).toHaveLength(0);
        outcomes.add('promoted');
      }
    };
    await run('cancel-first');
    await run('remove-first');
    expect(outcomes).toEqual(new Set(['removed', 'promoted']));
    for (let i = 0; i < 5; i += 1) await run('race');
  });

  it('two simultaneous removals of the same entry: one succeeds, one gets 409, one notice and one audit', async () => {
    const { s, event, w } = await setup(2);
    const lock = await holdEventLock(event.id);
    const first = remove(s, event.id, w[0]!.id);
    const second = remove(s, event.id, w[0]!.id);
    try {
      await lock.waitForBlocked(2);
    } finally {
      lock.release();
      await lock.done;
    }
    expect([(await first).statusCode, (await second).statusCode].sort()).toEqual([200, 409]);
    expect(await outboxFor(event.id, 'waitlist_removed')).toHaveLength(1);
    expect(await removalAudits(event.id)).toHaveLength(1);
  });

  it("removal vs. the participant's own cancellation: whichever commits first wins, with only its email (FR-WL-14 c)", async () => {
    const s = await signIn(h, ORGANIZER);
    const run = async (order: 'own-first' | 'remove-first' | 'race') => {
      const { event, w } = await setup(1, s);
      const target = w[0]!;
      let removal: Awaited<ReturnType<typeof remove>>;
      let own: Awaited<ReturnType<typeof cancelByLink>>;
      if (order === 'own-first') {
        own = await cancelByLink(target.links.management);
        removal = await remove(s, event.id, target.id);
      } else if (order === 'remove-first') {
        removal = await remove(s, event.id, target.id);
        own = await cancelByLink(target.links.management);
      } else {
        const lock = await holdEventLock(event.id);
        const r = remove(s, event.id, target.id);
        const c = cancelByLink(target.links.management);
        try {
          await lock.waitForBlocked(2);
        } finally {
          lock.release();
          await lock.done;
        }
        [removal, own] = [await r, await c];
      }
      await drain(h);
      if (removal.statusCode === 200) {
        expect(own.body).toBe(GENERIC_INVALID_LINK_BODY);
        expect(removalMail(target.email)).toHaveLength(1);
        expect(regCancelledMail(target.email)).toHaveLength(0);
        return 'removed';
      }
      expect(own.statusCode).toBe(200);
      expect(removal.json().code).toBe('not_waitlisted');
      expect(regCancelledMail(target.email)).toHaveLength(1);
      expect(removalMail(target.email)).toHaveLength(0);
      return 'own';
    };
    expect(await run('own-first')).toBe('own');
    expect(await run('remove-first')).toBe('removed');
    for (let i = 0; i < 3; i += 1) await run('race');
  });

  it('removal vs. event cancellation: 100 runs while both wait on the lock, plus both forced orders (AC-91)', async () => {
    // Event cancellation is limited to 5 per 15 minutes per account (D3) and needs a sign-in from the
    // last 15 minutes, so every 4 runs the test clock moves on 16 minutes and the organizer signs in again.
    let s!: Session;
    let runs = 0;
    const tally = { removed: 0, cancelled: 0 };
    const run = async (order: 'remove-first' | 'cancel-first' | 'race') => {
      if (runs % 4 === 0) {
        moveClockTo(new Date(), (runs / 4) * 16 * MINUTE);
        s = await signIn(h, ORGANIZER);
      }
      runs += 1;
      const { event, w } = await setup(1, s);
      const target = w[0]!;
      let removal: Awaited<ReturnType<typeof remove>>;
      let cancel: Awaited<ReturnType<typeof cancelEvent>>;
      if (order === 'remove-first') {
        removal = await remove(s, event.id, target.id);
        cancel = await cancelEvent(s, event.id);
      } else if (order === 'cancel-first') {
        cancel = await cancelEvent(s, event.id);
        removal = await remove(s, event.id, target.id);
      } else {
        const lock = await holdEventLock(event.id);
        const r = remove(s, event.id, target.id);
        const c = cancelEvent(s, event.id);
        try {
          await lock.waitForBlocked(2);
        } finally {
          lock.release();
          await lock.done;
        }
        [removal, cancel] = [await r, await c];
      }
      expect(cancel.statusCode).toBe(200);
      const removals = await outboxFor(event.id, 'waitlist_removed');
      const cancellations = (await outboxFor(event.id, 'event_cancellation')).filter(
        (m) => m.recipient_email === target.email,
      );
      if (removal.statusCode === 200) {
        expect(await states(event.id)).toContain(`${target.email}:CANCELLED(removed_by_organizer)`);
        expect(removals).toHaveLength(1);
        expect(cancellations).toHaveLength(0);
        tally.removed += 1;
        return 'removed';
      }
      expect(removal.json().code).toBe('event_not_scheduled');
      expect(await states(event.id)).toContain(`${target.email}:CANCELLED(event_cancelled)`);
      expect(removals).toHaveLength(0);
      expect(cancellations).toHaveLength(1);
      tally.cancelled += 1;
      return 'cancelled';
    };
    expect(await run('remove-first')).toBe('removed');
    expect(await run('cancel-first')).toBe('cancelled');
    for (let i = 0; i < 100; i += 1) await run('race');
    expect(tally.removed + tally.cancelled).toBe(102);
  }, 300_000);
});
