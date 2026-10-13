import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWebApp } from '../src/composition/web-app.js';
import { LiveHub } from '../src/modules/reporting/live.js';
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
  registerConfirmed,
  resetData,
  signIn,
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
const DAY = 24 * HOUR;
const ORGANIZER = 'organizer@example.test';

interface Staff {
  cookie: string;
  csrf: string;
}

function invite(s: Session, eventId: string, email: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/staff-invitations`,
    headers: organizerHeaders(s),
    payload: { email },
  });
}

async function inviteToken(s: Session, eventId: string, email: string): Promise<string> {
  const before = mailFor(h, email).length;
  const response = await invite(s, eventId, email);
  expect(response.statusCode).toBe(201);
  await drain(h);
  const mails = mailFor(h, email).filter((m) =>
    m.subject.startsWith('You are invited to help with check-in'),
  );
  expect(mailFor(h, email).length).toBe(before + 1);
  return linkToken(mails[0]!, '/invite'); // newest first
}

function openInvitation(token: string) {
  return h.app.inject({
    method: 'GET',
    url: '/api/links/invite',
    headers: { authorization: `Link ${token}` },
  });
}

async function accept(token: string): Promise<{ status: number; body: string; staff?: Staff }> {
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/links/invite/accept',
    headers: { origin: ORIGIN, authorization: `Link ${token}` },
  });
  const raw = response.cookies.find((c) => c.name === '__Host-ers_staff')?.value;
  if (!raw) return { status: response.statusCode, body: response.body };
  const cookie = `__Host-ers_staff=${raw}`;
  const session = await h.app.inject({ method: 'GET', url: '/api/staff/session', headers: { cookie } });
  return {
    status: response.statusCode,
    body: response.body,
    staff: { cookie, csrf: session.json().csrfToken },
  };
}

async function staffFor(s: Session, eventId: string, email = 'helper@example.test'): Promise<Staff> {
  const result = await accept(await inviteToken(s, eventId, email));
  expect(result.status).toBe(200);
  return result.staff!;
}

function staffCheckIn(st: Staff, eventId: string, code: string, requestId = randomUUID()) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/check-ins`,
    headers: { origin: ORIGIN, cookie: st.cookie, 'x-csrf-token': st.csrf },
    payload: { code, requestId },
  });
}

const staffSession = (st: Staff) =>
  h.app.inject({ method: 'GET', url: '/api/staff/session', headers: { cookie: st.cookie } });

async function staffRows() {
  return h.db.selectFrom('app.staff_sessions').selectAll().execute();
}

async function revokeSession(s: Session, eventId: string, staffSessionId: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/staff-sessions/${staffSessionId}/revocation`,
    headers: organizerHeaders(s),
  });
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

describe('staff invitations (K-406: FR-STAFF-1, FR-STAFF-5, FR-STAFF-7, TX-S01, TX-S02)', () => {
  it('opening the invitation grants nothing; accepting creates one device session, once (AC-82)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72, title: 'Concert' });
    const token = await inviteToken(s, event.id, 'helper@example.test');
    const [mail] = mailFor(h, 'helper@example.test');
    expect(mail!.text).toContain('Opening the link alone does not give access');

    const view = await openInvitation(token);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toEqual({ event: expect.objectContaining({ title: 'Concert' }) });
    await h.app.inject({
      method: 'HEAD',
      url: '/api/links/invite',
      headers: { authorization: `Link ${token}` },
    });
    expect(await staffRows()).toHaveLength(0); // opening and HEAD change nothing (FR-LNK-9)

    const first = await accept(token);
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ redirect: '/staff' });
    const second = await accept(token);
    expect(second.body).toBe(GENERIC_INVALID_LINK_BODY);
    expect(second.staff).toBeUndefined();
    expect(await staffRows()).toHaveLength(1);

    const session = await staffSession(first.staff!);
    expect(Object.keys(session.json()).sort()).toEqual([
      'csrfToken',
      'event',
      'eventId',
      'windowClosesAt',
      'windowOpensAt',
    ]);
    const overview = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/staff`,
      headers: { cookie: s.cookie },
    });
    expect(overview.json().invitations[0]).toMatchObject({
      email: 'helper@example.test',
      status: 'accepted',
    });
    expect(overview.json().invitations[0].acceptedAt).toBeTruthy();
    expect(overview.json().sessions).toHaveLength(1);
  });

  it('an invitation can be accepted until 7 days after issuance, not after (AC-96)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 9 * 24 }); // window still open at day 7
    const late = await inviteToken(s, event.id, 'late@example.test');
    const onTime = await inviteToken(s, event.id, 'ontime@example.test');
    const issued = (
      await h.db.selectFrom('app.staff_invitations').select('created_at').executeTakeFirstOrThrow()
    ).created_at;
    moveClockTo(issued, 7 * DAY - HOUR);
    expect((await accept(onTime)).status).toBe(200);
    moveClockTo(issued, 7 * DAY + 60_000);
    expect((await accept(late)).body).toBe(GENERIC_INVALID_LINK_BODY);
  });

  it('a revoked, replaced, cancelled-event, deleted-event or ended-window invitation gets the generic response (AC-101)', async () => {
    const s = await signIn(h, ORGANIZER);
    // (a) revoked
    const e1 = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const revoked = await inviteToken(s, e1.id, 'a@example.test');
    const invitationId = (
      await h.db.selectFrom('app.staff_invitations').select('id').executeTakeFirstOrThrow()
    ).id;
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/api/events/${e1.id}/staff-invitations/${invitationId}/revocation`,
          headers: organizerHeaders(s),
        })
      ).statusCode,
    ).toBe(204);
    expect((await openInvitation(revoked)).body).toBe(GENERIC_INVALID_LINK_BODY);
    expect((await accept(revoked)).body).toBe(GENERIC_INVALID_LINK_BODY);
    // (b) replaced by a re-invitation: the old link stops, the new one works
    const old = await inviteToken(s, e1.id, 'b@example.test');
    const replacement = await inviteToken(s, e1.id, 'b@example.test');
    expect((await accept(old)).body).toBe(GENERIC_INVALID_LINK_BODY);
    expect((await accept(replacement)).status).toBe(200);
    // (c) event cancelled
    const c = await inviteToken(s, e1.id, 'c@example.test');
    await h.app.inject({
      method: 'POST',
      url: `/api/events/${e1.id}/cancellation`,
      headers: organizerHeaders(s),
      payload: { confirmed: true },
    });
    expect((await accept(c)).body).toBe(GENERIC_INVALID_LINK_BODY);
    // (d) event deleted
    const e2 = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const d = await inviteToken(s, e2.id, 'd@example.test');
    const preview = await h.app.inject({
      method: 'GET',
      url: `/api/events/${e2.id}/deletion-preview`,
      headers: { cookie: s.cookie },
    });
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/api/events/${e2.id}/deletion`,
          headers: organizerHeaders(s),
          payload: { confirmed: true, previewToken: preview.json().previewToken },
        })
      ).statusCode,
    ).toBe(204);
    expect((await accept(d)).body).toBe(GENERIC_INVALID_LINK_BODY);
    // (e) the check-in window has ended
    const e3 = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const e = await inviteToken(s, e3.id, 'e@example.test');
    moveClockTo(new Date(e3.startsAt), 12 * HOUR + 60_000);
    expect((await accept(e)).body).toBe(GENERIC_INVALID_LINK_BODY);
  });

  it('cancellation revokes pending invitations and their links in the same transaction (PD-58)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    await inviteToken(s, event.id, 'pending@example.test');
    const staff = await staffFor(s, event.id);
    await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/cancellation`,
      headers: organizerHeaders(s),
      payload: { confirmed: true },
    });
    const invitations = await h.db
      .selectFrom('app.staff_invitations')
      .select(['invited_email', 'status'])
      .orderBy('invited_email')
      .execute();
    expect(invitations).toEqual([
      { invited_email: 'helper@example.test', status: 'accepted' },
      { invited_email: 'pending@example.test', status: 'revoked' },
    ]);
    const tokens = await h.db
      .selectFrom('app.access_tokens')
      .select(['revoked_at', 'revoke_reason'])
      .where('token_type', '=', 'staff_invitation')
      .execute();
    expect(tokens.find((t) => t.revoke_reason === 'event_cancelled')).toBeTruthy();
    // FR-STAFF-4: the staff session no longer works.
    expect((await staffSession(staff)).statusCode).toBe(401);
  });

  it('is rate-limited per owner and event (PD-55), and refuses ended or cancelled events', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    for (let i = 0; i < 20; i += 1)
      expect((await invite(s, event.id, `h${i}@example.test`)).statusCode).toBe(201);
    const limited = await invite(s, event.id, 'h20@example.test');
    expect(limited.statusCode).toBe(429);
    const other = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    moveClockTo(new Date(other.startsAt), 12 * HOUR + 60_000);
    const fresh = await signIn(h, ORGANIZER);
    expect((await invite(fresh, other.id, 'x@example.test')).json().code).toBe('check_in_window_ended');
  });
});

describe('staff sessions (FR-STAFF-2 to FR-STAFF-4, PD-56)', () => {
  it('staff check in tickets of their event; the record names the staff session; no participant data is returned', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const a = await registerConfirmed(h, event.publicId, 'a@example.test');
    const staff = await staffFor(s, event.id);
    moveClockTo(new Date(event.startsAt), -HOUR);
    const response = await staffCheckIn(staff, event.id, a.ticket.code);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: 'CHECKED_IN' });
    const second = await staffCheckIn(staff, event.id, a.ticket.code);
    expect(Object.keys(second.json()).sort()).toEqual(['firstCheckedInAt', 'outcome']);
    const row = await h.db.selectFrom('app.check_ins').selectAll().executeTakeFirstOrThrow();
    expect(row).toMatchObject({ actor_kind: 'staff', actor_account_id: null });
    expect(row.actor_staff_session_id).toBe((await staffRows())[0]!.id);
  });

  it('staff get 403 on organizer endpoints and 404 on other events; CSRF is session-bound (AC-26, AC-151)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const other = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const staff = await staffFor(s, event.id);
    const headers = { origin: ORIGIN, cookie: staff.cookie, 'x-csrf-token': staff.csrf };
    const organizerRoutes: [string, string, unknown?][] = [
      ['GET', '/api/events'],
      ['GET', `/api/events/${event.id}`],
      ['GET', `/api/events/${event.id}/dashboard`],
      ['GET', `/api/events/${event.id}/participants`],
      ['GET', `/api/events/${event.id}/staff`],
      ['PATCH', `/api/events/${event.id}`, { title: 'x' }],
      ['PUT', `/api/events/${event.id}/capacity`, { capacity: 9 }],
      ['POST', `/api/events/${event.id}/cancellation`, { confirmed: true }],
      ['POST', `/api/events/${event.id}/staff-invitations`, { email: 'z@example.test' }],
    ];
    for (const [method, url, payload] of organizerRoutes) {
      const response = await h.app.inject({
        method: method as 'GET',
        url,
        headers,
        ...(payload ? { payload: payload as object } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json().code).toBe('forbidden');
    }
    expect((await staffCheckIn(staff, other.id, 'ZZZZZZZZZZZZ')).statusCode).toBe(404);
    // (The count and stream routes need the live hub; their 404 for other events is tested below.)
    const noCsrf = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/check-ins`,
      headers: { origin: ORIGIN, cookie: staff.cookie, 'x-csrf-token': s.csrf },
      payload: { code: 'ZZZZZZZZZZZZ', requestId: randomUUID() },
    });
    expect(noCsrf.json().code).toBe('csrf_failed');
    expect(
      (
        await h.db
          .selectFrom('app.events')
          .select('title')
          .where('id', '=', event.id)
          .executeTakeFirstOrThrow()
      ).title,
    ).toBe('Test event');
  });

  it('owner revocation ends access at the next request; the window end ends it too; a re-invitation keeps sessions (AC-111, AC-151)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const one = await staffFor(s, event.id, 'one@example.test');
    const two = await staffFor(s, event.id, 'two@example.test');
    await inviteToken(s, event.id, 'one@example.test'); // re-invitation of the same address
    expect((await staffSession(one)).statusCode).toBe(200);

    const sessionOne =
      (await staffRows()).find((r) => r.invitation_id) &&
      (
        await h.db
          .selectFrom('app.staff_sessions as ss')
          .innerJoin('app.staff_invitations as i', 'i.id', 'ss.invitation_id')
          .select('ss.id')
          .where('i.invited_email', '=', 'one@example.test')
          .executeTakeFirstOrThrow()
      ).id;
    expect((await revokeSession(s, event.id, sessionOne!)).statusCode).toBe(204);
    expect((await revokeSession(s, event.id, sessionOne!)).statusCode).toBe(204); // idempotent
    const after = await staffSession(one);
    expect(after.statusCode).toBe(401);
    expect(after.headers['set-cookie']).toContain('__Host-ers_staff=;');
    expect((await staffCheckIn(one, event.id, 'ZZZZZZZZZZZZ')).statusCode).toBe(401);
    expect((await staffSession(two)).statusCode).toBe(200);

    moveClockTo(new Date(event.startsAt), 12 * HOUR + 60_000); // the check-in window has closed
    expect((await staffSession(two)).statusCode).toBe(401);
  });

  it('the device can end its own access, with its anti-forgery token; nothing checks in after it (K-715, PD-95)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const a = await registerConfirmed(h, event.publicId, 'a@example.test');
    const staff = await staffFor(s, event.id);
    moveClockTo(new Date(event.startsAt), -HOUR);
    const signOut = (csrf?: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/staff/sign-out',
        headers: { origin: ORIGIN, cookie: staff.cookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
      });
    expect((await signOut()).statusCode).toBe(403); // no token: a cross-site form cannot end it
    expect((await signOut('v1.1.forged')).statusCode).toBe(403);
    const ended = await signOut(staff.csrf);
    expect(ended.statusCode).toBe(204);
    expect(ended.cookies.find((c) => c.name === '__Host-ers_staff')?.value).toBe('');
    expect((await staffSession(staff)).statusCode).toBe(401);
    expect((await staffCheckIn(staff, event.id, a.ticket.code)).statusCode).toBe(401);
    const [row] = await staffRows();
    expect(row).toMatchObject({ revoke_reason: 'staff_ended' });
    const audit = await h.db
      .selectFrom('app.audit_records')
      .select(['action', 'actor_kind', 'actor_staff_session_id'])
      .where('action', '=', 'staff_session_ended')
      .execute();
    expect(audit).toEqual([
      { action: 'staff_session_ended', actor_kind: 'staff', actor_staff_session_id: row!.id },
    ]);
    // Repeating it (for example a second tap) is harmless.
    expect((await signOut(staff.csrf)).statusCode).toBe(204);
    // The organizer no longer lists the device.
    const overview = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/staff`,
      headers: { cookie: s.cookie },
    });
    expect(overview.json().sessions).toEqual([]);
  });

  it('revocation vs. check-in: forced in both orders, and while both wait on the lock (AC-156)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 10, startsInHours: 72 });
    const codes: string[] = [];
    for (let i = 0; i < 4; i += 1)
      codes.push((await registerConfirmed(h, event.publicId, `p${i}@example.test`)).ticket.code);
    moveClockTo(new Date(event.startsAt), -HOUR);
    const owner = await signIn(h, ORGANIZER);
    const idOf = async (email: string) =>
      (
        await h.db
          .selectFrom('app.staff_sessions as ss')
          .innerJoin('app.staff_invitations as i', 'i.id', 'ss.invitation_id')
          .select('ss.id')
          .where('i.invited_email', '=', email)
          .executeTakeFirstOrThrow()
      ).id;

    // Check-in commits first: it stands.
    const first = await staffFor(owner, event.id, 'first@example.test');
    expect((await staffCheckIn(first, event.id, codes[0]!)).json().outcome).toBe('CHECKED_IN');
    await revokeSession(owner, event.id, await idOf('first@example.test'));
    expect(await h.db.selectFrom('app.check_ins').select('id').execute()).toHaveLength(1);

    // Revocation commits first: the check-in is rejected.
    const second = await staffFor(owner, event.id, 'second@example.test');
    await revokeSession(owner, event.id, await idOf('second@example.test'));
    expect((await staffCheckIn(second, event.id, codes[1]!)).statusCode).toBe(401);

    // Both waiting on the event lock: whichever commits first wins; never a check-in after the revocation.
    for (const [i, email] of [
      ['third@example.test', 2],
      ['fourth@example.test', 3],
    ].map(([e, n]) => [n, e] as const)) {
      const staff = await staffFor(owner, event.id, email as string);
      const id = await idOf(email as string);
      const lock = await holdEventLock(event.id);
      const both = Promise.all([
        staffCheckIn(staff, event.id, codes[i as number]!),
        revokeSession(owner, event.id, id),
      ]);
      try {
        await lock.waitForBlocked(2);
      } finally {
        lock.release();
      }
      await lock.done;
      const [checkInResponse, revocation] = await both;
      expect(revocation.statusCode).toBe(204);
      const revokedAt = (
        await h.db
          .selectFrom('app.staff_sessions')
          .select('revoked_at')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).revoked_at!;
      if (checkInResponse.statusCode === 200) {
        const row = await h.db
          .selectFrom('app.check_ins')
          .select('checked_in_at')
          .where('actor_staff_session_id', '=', id)
          .executeTakeFirstOrThrow();
        expect(row.checked_in_at.getTime()).toBeLessThanOrEqual(revokedAt.getTime());
      } else {
        expect(checkInResponse.statusCode).toBe(401);
        expect(
          await h.db
            .selectFrom('app.check_ins')
            .select('id')
            .where('actor_staff_session_id', '=', id)
            .execute(),
        ).toHaveLength(0);
      }
    }
  });

  it('deletion removes invitations and sessions; the staff cookie stops working (FR-STAFF-4)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const staff = await staffFor(s, event.id);
    await inviteToken(s, event.id, 'pending@example.test');
    const preview = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/deletion-preview`,
      headers: { cookie: s.cookie },
    });
    const deleted = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/deletion`,
      headers: organizerHeaders(s),
      payload: { confirmed: true, previewToken: preview.json().previewToken },
    });
    expect(deleted.statusCode).toBe(204);
    expect(await staffRows()).toHaveLength(0);
    expect(await h.db.selectFrom('app.staff_invitations').select('id').execute()).toHaveLength(0);
    expect((await staffSession(staff)).statusCode).toBe(401);
  });
});

describe('staff live stream (FR-STAFF-3, AC-186)', () => {
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

  it('a revoked staff stream gets no further count and is closed at its next check', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const a = await registerConfirmed(h, event.publicId, 'a@example.test');
    const staff = await staffFor(s, event.id);
    const staffId = (await staffRows())[0]!.id;
    moveClockTo(new Date(event.startsAt), -HOUR);

    const controller = new AbortController();
    const response = await fetch(`${base}/api/events/${event.id}/live`, {
      headers: { cookie: staff.cookie },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (pattern: RegExp) => {
      const deadline = Date.now() + 10_000;
      while (!pattern.test(text) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    };
    await readUntil(/event: count\ndata: \{"checkedIn":0\}/); // the stream is open for staff
    // The count endpoint: this event's count for its staff; 404 for any other event (PD-56).
    const other = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const asStaff = { headers: { cookie: staff.cookie } };
    expect(await (await fetch(`${base}/api/events/${event.id}/check-in-count`, asStaff)).json()).toEqual({
      checkedIn: 0,
    });
    expect((await fetch(`${base}/api/events/${other.id}/check-in-count`, asStaff)).status).toBe(404);
    expect((await fetch(`${base}/api/events/${other.id}/live`, asStaff)).status).toBe(404);
    expect((await revokeSession(s, event.id, staffId)).statusCode).toBe(204);
    // An update after the revocation committed: its authorization check fails, so no count is sent.
    const owner = await signIn(h, ORGANIZER);
    await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/check-ins`,
      headers: organizerHeaders(owner),
      payload: { code: a.ticket.code, requestId: randomUUID() },
    });
    await readUntil(/event: access_ended/);
    controller.abort();
    expect(text).toContain('event: access_ended');
    expect(text).not.toContain('"checkedIn":1');
  });
});
