import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWebApp } from '../src/composition/web-app.js';
import { LiveHub } from '../src/modules/reporting/live.js';
import {
  ORIGIN,
  createEvent,
  createHarness,
  drain,
  linkToken,
  mailFor,
  moveClockTo,
  organizerHeaders,
  reauthenticate,
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
const ORGANIZER = 'organizer@example.test';

function checkIn(s: Session, eventId: string, code: string, requestId = randomUUID()) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/check-ins`,
    headers: organizerHeaders(s),
    payload: { code, requestId },
  });
}

function undo(s: Session, eventId: string, checkInId: string, payload: object = {}) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/check-ins/${checkInId}/undo`,
    headers: organizerHeaders(s),
    payload,
  });
}

const checkIns = () => h.db.selectFrom('app.check_ins').selectAll().orderBy('checked_in_at').execute();
const undoAudits = () =>
  h.db.selectFrom('app.audit_records').selectAll().where('action', '=', 'checkin_undo').execute();

function shareView(shareLink: string) {
  return h.app.inject({
    method: 'GET',
    url: '/api/links/ticket',
    headers: { authorization: `Link ${tokenFromLink(shareLink)}` },
  });
}

/** An event in its check-in window with one confirmed participant whose ticket is checked in. */
async function checkedInSetup() {
  const s = await signIn(h, ORGANIZER);
  const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
  const a = await registerConfirmed(h, event.publicId, 'a@example.test');
  moveClockTo(new Date(event.startsAt), -HOUR);
  const requestId = randomUUID();
  expect((await checkIn(s, event.id, a.ticket.code, requestId)).json()).toEqual({ outcome: 'CHECKED_IN' });
  const row = (await checkIns())[0]!;
  return { s, event, a, requestId, checkInId: row.id };
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

describe('check-in undo (K-306: FR-CHK-8, BR-7, TX-C02)', () => {
  it('undoes the check-in with an audit record; the ticket can be checked in again; history is kept (AC-27)', async () => {
    const { s, event, a, requestId, checkInId } = await checkedInSetup();
    const response = await undo(s, event.id, checkInId, { reason: '  Scanned the wrong ticket  ' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: 'undone' });

    const [row] = await checkIns();
    expect(row!.undone_at).not.toBeNull();
    expect(row!.undone_by_account_id).toBe(s.accountId);
    expect(row!.undo_reason).toBe('Scanned the wrong ticket'); // PD-59: the reason lives on the row
    const [audit] = await undoAudits();
    expect(audit).toMatchObject({
      actor_kind: 'owner',
      actor_account_id: s.accountId,
      event_id: event.id,
      ticket_id: row!.ticket_id,
      subject_id: checkInId,
      outcome: 'undone',
    });
    expect(audit!.occurred_at.getTime()).toBe(row!.undone_at!.getTime());
    expect(audit!.details).toEqual({ reasonGiven: true });
    expect(JSON.stringify(audit)).not.toContain('a@example.test');

    // The original request ID still replays its stored result and checks nothing in (FR-CHK-3).
    expect((await checkIn(s, event.id, a.ticket.code, requestId)).json()).toEqual({ outcome: 'CHECKED_IN' });
    expect((await checkIns()).filter((c) => !c.undone_at)).toHaveLength(0);
    // A new check-in inserts a new row; the undone one stays (DATABASE_DESIGN §8).
    expect((await checkIn(s, event.id, a.ticket.code)).json()).toEqual({ outcome: 'CHECKED_IN' });
    const rows = await checkIns();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe(checkInId);
    expect(rows[0]!.undone_at).not.toBeNull();
    expect(rows[1]!.undone_at).toBeNull();
    // That check-in can be undone too, without a reason.
    expect((await undo(s, event.id, rows[1]!.id)).statusCode).toBe(200);
    const audits = await undoAudits();
    expect(audits).toHaveLength(2);
    expect(audits.find((x) => x.subject_id === rows[1]!.id)!.details).toEqual({ reasonGiven: false });
    expect((await checkIns())[1]!.undo_reason).toBeNull();
  });

  it('the share view, participant list and dashboard follow the undo (AC-54)', async () => {
    const { s, event, a, checkInId } = await checkedInSetup();
    const before = (await shareView(a.links.share)).json();
    expect(before.state).toBe('checked_in');
    expect(before.ticket).toBeUndefined();

    expect((await undo(s, event.id, checkInId)).statusCode).toBe(200);
    const after = (await shareView(a.links.share)).json();
    expect(after.state).toBe('valid');
    expect(after.ticket).toEqual({ code: a.ticket.code });
    const dashboard = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/dashboard`,
      headers: organizerHeaders(s),
    });
    expect(dashboard.json().counts.checkedIn).toBe(0);
    const participants = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/participants`,
      headers: organizerHeaders(s),
    });
    const [p] = participants.json().items;
    expect(p.checkedInAt).toBeUndefined();
    expect(p.checkInId).toBeUndefined();

    expect((await checkIn(s, event.id, a.ticket.code)).json()).toEqual({ outcome: 'CHECKED_IN' });
    expect((await shareView(a.links.share)).json().state).toBe('checked_in');
  });

  it('a repeated undo gets 409 check_in_already_undone and writes nothing (API_DESIGN §9)', async () => {
    const { s, event, checkInId } = await checkedInSetup();
    expect((await undo(s, event.id, checkInId, { reason: 'first' })).statusCode).toBe(200);
    const row = (await checkIns())[0]!;
    const again = await undo(s, event.id, checkInId, { reason: 'second' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('check_in_already_undone');
    expect(await undoAudits()).toHaveLength(1);
    expect((await checkIns())[0]).toEqual(row);
  });

  it('two simultaneous undo requests: exactly one succeeds and one audit record is written', async () => {
    const { s, event, checkInId } = await checkedInSetup();
    const lock = await holdEventLock(event.id);
    const first = undo(s, event.id, checkInId, { reason: 'one' });
    const second = undo(s, event.id, checkInId, { reason: 'two' });
    await lock.waitForBlocked(2);
    lock.release();
    await lock.done;
    const statuses = [(await first).statusCode, (await second).statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    expect(await undoAudits()).toHaveLength(1);
    const row = (await checkIns())[0]!;
    expect(['one', 'two']).toContain(row.undo_reason);
  });

  it('undo vs. a new check-in of the same ticket: both orders keep at most one active check-in (BR-7)', async () => {
    // Forced order 1: the undo commits first, so the check-in succeeds with a new row.
    {
      const { s, event, a, checkInId } = await checkedInSetup();
      expect((await undo(s, event.id, checkInId)).statusCode).toBe(200);
      expect((await checkIn(s, event.id, a.ticket.code)).json()).toEqual({ outcome: 'CHECKED_IN' });
      expect((await checkIns()).filter((c) => !c.undone_at)).toHaveLength(1);
      await resetData(h);
    }
    // Forced order 2: the check-in comes first (already checked in), then the undo; none is active.
    {
      const { s, event, a, checkInId } = await checkedInSetup();
      expect((await checkIn(s, event.id, a.ticket.code)).json().outcome).toBe('ALREADY_CHECKED_IN');
      expect((await undo(s, event.id, checkInId)).statusCode).toBe(200);
      expect((await checkIns()).filter((c) => !c.undone_at)).toHaveLength(0);
      await resetData(h);
    }
    // Both waiting on the event lock at once: whichever runs first, the outcomes agree with the rows.
    for (let round = 0; round < 3; round += 1) {
      const { s, event, a, checkInId } = await checkedInSetup();
      const lock = await holdEventLock(event.id);
      const undoing = undo(s, event.id, checkInId);
      const checking = checkIn(s, event.id, a.ticket.code);
      await lock.waitForBlocked(2);
      lock.release();
      await lock.done;
      expect((await undoing).statusCode).toBe(200);
      const outcome = (await checking).json().outcome;
      const rows = await checkIns();
      const active = rows.filter((c) => !c.undone_at);
      if (outcome === 'CHECKED_IN') {
        expect(rows).toHaveLength(2);
        expect(active).toHaveLength(1);
        expect(active[0]!.id).not.toBe(checkInId);
      } else {
        expect(outcome).toBe('ALREADY_CHECKED_IN');
        expect(rows).toHaveLength(1);
        expect(active).toHaveLength(0);
      }
      const count = await sql<{ n: number }>`SELECT count(*)::int AS n FROM app.check_ins
        WHERE event_id = ${event.id} AND undone_at IS NULL`.execute(h.db);
      expect(count.rows[0]!.n).toBe(active.length);
      await resetData(h);
    }
  });

  it('requires the owner session, CSRF and the exact origin; staff get 403; other organizers 404 (AC-26)', async () => {
    const { s, event, checkInId } = await checkedInSetup();
    const url = `/api/events/${event.id}/check-ins/${checkInId}/undo`;
    const post = (headers: Record<string, string>) =>
      h.app.inject({ method: 'POST', url, headers, payload: {} });

    expect((await post({ origin: ORIGIN })).statusCode).toBe(401);
    const noCsrf = await post({ origin: ORIGIN, cookie: s.cookie });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().code).toBe('csrf_failed');
    const foreign = await post({ ...organizerHeaders(s), origin: 'https://evil.example' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().code).toBe('origin_check_failed');

    const other = await signIn(h, 'other@example.test');
    const notOwner = await undo(other, event.id, checkInId);
    expect(notOwner.statusCode).toBe(404);
    expect(notOwner.json().code).toBe('not_found');

    // A staff device of this very event (K-406): never allowed to undo (FR-CHK-8, PD-56).
    const invited = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/staff-invitations`,
      headers: organizerHeaders(s),
      payload: { email: 'helper@example.test' },
    });
    expect(invited.statusCode).toBe(201);
    await drain(h);
    const token = linkToken(mailFor(h, 'helper@example.test')[0]!, '/invite');
    const accepted = await h.app.inject({
      method: 'POST',
      url: '/api/links/invite/accept',
      headers: { origin: ORIGIN, authorization: `Link ${token}` },
    });
    const cookie = `__Host-ers_staff=${accepted.cookies.find((c) => c.name === '__Host-ers_staff')!.value}`;
    const staffCsrf = (
      await h.app.inject({ method: 'GET', url: '/api/staff/session', headers: { cookie } })
    ).json().csrfToken as string;
    const asStaff = await post({ origin: ORIGIN, cookie, 'x-csrf-token': staffCsrf });
    expect(asStaff.statusCode).toBe(403);
    expect(asStaff.json().code).toBe('forbidden');

    expect(await undoAudits()).toHaveLength(0);
    expect((await checkIns())[0]!.undone_at).toBeNull();
    // A signed-out owner session can no longer undo.
    expect(
      (await h.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: organizerHeaders(s) }))
        .statusCode,
    ).toBeLessThan(300);
    expect((await undo(s, event.id, checkInId)).statusCode).toBe(401);
    expect((await checkIns())[0]!.undone_at).toBeNull();
  });

  it('invalid requests: unknown or foreign check-in IDs get 404; a bad reason or extra field gets 422', async () => {
    const { s, event, checkInId } = await checkedInSetup();
    const otherEvent = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    for (const [eventId, id] of [
      [event.id, randomUUID()],
      [event.id, 'not-a-uuid'],
      ['not-a-uuid', checkInId],
      [otherEvent.id, checkInId], // a check-in of another event of the same owner
      [randomUUID(), checkInId],
    ] as const) {
      const response = await undo(s, eventId, id);
      expect(response.statusCode, `${eventId}/${id}`).toBe(404);
      expect(response.json().code).toBe('not_found');
    }
    for (const payload of [
      { reason: 'x'.repeat(501) },
      { reason: '   ' },
      { reason: 5 },
      { confirmed: true },
    ]) {
      const response = await undo(s, event.id, checkInId, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
      expect(response.json().code).toBe('validation_failed');
    }
    expect(await undoAudits()).toHaveLength(0);
    expect((await undo(s, event.id, checkInId, { reason: 'x'.repeat(500) })).statusCode).toBe(200);
  });

  it('is not limited to the check-in window or a scheduled event (PD-60)', async () => {
    const { s, event, a, checkInId } = await checkedInSetup();
    moveClockTo(new Date(event.startsAt), 13 * HOUR); // after the window closes
    expect((await undo(s, event.id, checkInId)).statusCode).toBe(200);
    // A new check-in still follows the window rule.
    expect((await checkIn(s, event.id, a.ticket.code)).json().outcome).toBe('OUTSIDE_CHECK_IN_WINDOW');
    expect((await checkIns()).filter((c) => !c.undone_at)).toHaveLength(0);

    // A cancelled event keeps its check-ins (PD-41); the owner can still correct one.
    await resetData(h);
    const cancelled = await checkedInSetup();
    // The clock moved to the window, so cancellation needs a fresh sign-in (FR-ORG-5).
    const fresh = await reauthenticate(h, cancelled.s, ORGANIZER);
    const cancel = await h.app.inject({
      method: 'POST',
      url: `/api/events/${cancelled.event.id}/cancellation`,
      headers: organizerHeaders(fresh),
      payload: { confirmed: true },
    });
    expect(cancel.statusCode).toBe(200);
    expect((await undo(fresh, cancelled.event.id, cancelled.checkInId)).statusCode).toBe(200);
    expect(await undoAudits()).toHaveLength(1);
  });
});

describe('check-in undo and the live count (TR-07)', () => {
  let server: FastifyInstance;
  let hub: LiveHub;
  let base: string;
  beforeAll(async () => {
    hub = new LiveHub(h.config.DATABASE_URL);
    await hub.start();
    server = await buildWebApp(h.config, h.db, { logger: false, liveHub: hub });
    base = await server.listen({ host: '127.0.0.1', port: 0 });
  });
  afterAll(async () => {
    await server.close();
    await hub.stop();
  });

  it('pushes the decreased count to open streams and the count endpoint agrees', async () => {
    const { s, event, a, checkInId } = await checkedInSetup();
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events/${event.id}/live`, {
      headers: { cookie: s.cookie },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    // Reads until `pattern` appears in what arrived after position `from`.
    const readUntil = async (pattern: RegExp, from = 0) => {
      const deadline = Date.now() + 10_000;
      while (!pattern.test(text.slice(from)) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      return pattern.test(text.slice(from));
    };
    expect(await readUntil(/event: count\ndata: \{"checkedIn":1\}/)).toBe(true);
    let mark = text.length;
    expect((await undo(s, event.id, checkInId)).statusCode).toBe(200);
    expect(await readUntil(/event: count\ndata: \{"checkedIn":0\}/, mark)).toBe(true);
    const count = await fetch(`${base}/api/events/${event.id}/check-in-count`, {
      headers: { cookie: s.cookie },
    });
    expect(await count.json()).toEqual({ checkedIn: 0 });
    // A re-check-in raises it again.
    mark = text.length;
    expect((await checkIn(s, event.id, a.ticket.code)).json()).toEqual({ outcome: 'CHECKED_IN' });
    expect(await readUntil(/event: count\ndata: \{"checkedIn":1\}/, mark)).toBe(true);
    controller.abort();
  });
});
