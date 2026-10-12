import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Dispatcher } from '../src/modules/messaging/dispatcher.js';
import { FakeEmailProvider, type EmailProvider } from '../src/modules/messaging/fake-provider.js';
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
  reauthenticate,
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ORGANIZER = 'organizer@example.test';
const cancelMail = (email: string) =>
  mailFor(h, email).filter((m) => m.subject.startsWith('Event cancelled'));
const regCancelledMail = (email: string) =>
  mailFor(h, email).filter((m) => m.subject.startsWith('Registration cancelled'));

function cancelEvent(s: Session, eventId: string, payload: unknown = { confirmed: true }) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/cancellation`,
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

function checkIn(s: Session, eventId: string, code: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/check-ins`,
    headers: organizerHeaders(s),
    payload: { code, requestId: randomUUID() },
  });
}

async function eventRow(eventId: string) {
  return h.db.selectFrom('app.events').selectAll().where('id', '=', eventId).executeTakeFirstOrThrow();
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

async function outbox(type: string) {
  return h.db
    .selectFrom('app.outbox_messages')
    .select(['recipient_email', 'status', 'possibly_accepted'])
    .where('message_type', '=', type)
    .orderBy('recipient_email')
    .execute();
}

async function audits(eventId: string) {
  return h.db
    .selectFrom('app.audit_records')
    .select('details')
    .where('event_id', '=', eventId)
    .where('action', '=', 'event_cancelled')
    .execute();
}

/** Capacity 1: A confirmed, W waiting, P registered but unconfirmed; all emails delivered. */
async function setup() {
  const s = await signIn(h, ORGANIZER);
  const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
  const a = await registerConfirmed(h, event.publicId, 'a@example.test');
  const w = await registerConfirmed(h, event.publicId, 'w@example.test');
  const pendingToken = await registerAndGetVerifyToken(h, event.publicId, 'p@example.test');
  await drain(h);
  expect([a.result, w.result]).toEqual(['confirmed', 'waitlisted']);
  return { s, event, a, w, pendingToken };
}

/** A provider whose send waits for `release()`; `started` resolves once a claim has committed. */
class GatedProvider implements EmailProvider {
  started: Promise<void>;
  release!: () => void;
  private markStarted!: () => void;
  private gate: Promise<void>;
  constructor(private readonly inner: EmailProvider) {
    this.started = new Promise((r) => (this.markStarted = r));
    this.gate = new Promise((r) => (this.release = r));
  }
  async send(input: Parameters<EmailProvider['send']>[0]) {
    this.markStarted();
    await this.gate;
    return this.inner.send(input);
  }
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

const dispatcherWith = (provider: EmailProvider) =>
  new Dispatcher(h.db, provider, ORIGIN, `test-${randomUUID()}`);

describe('event cancellation (K-304c: FR-EVT-9, BR-16, TX-E05)', () => {
  // 1, 8, 12, 13
  it('cancels the event, ends every active registration, and emails each confirmed and waiting participant once', async () => {
    const { s, event } = await setup();
    const response = await cancelEvent(s, event.id);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'CANCELLED', phase: 'cancelled' });

    const row = await eventRow(event.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelled_at).not.toBeNull();
    expect(row.schedule_version).toBe(2);
    expect(row.confirmed_count).toBe(0);
    expect(await states(event.id)).toEqual([
      'a@example.test:CANCELLED(event_cancelled)',
      'p@example.test:EXPIRED(event_cancelled)',
      'w@example.test:CANCELLED(event_cancelled)',
    ]);

    await drain(h);
    expect(cancelMail('a@example.test')).toHaveLength(1);
    expect(cancelMail('w@example.test')).toHaveLength(1);
    expect(cancelMail('p@example.test')).toHaveLength(0); // never confirmed
    expect(cancelMail('a@example.test')[0]!.text).toContain('ticket is no longer valid');
    expect(cancelMail('w@example.test')[0]!.text).toContain('no longer on the waiting list');
    expect(cancelMail('a@example.test')[0]!.text).not.toMatch(/#t=/); // no usable links
    // AC-59: no participant-initiated confirmations.
    expect(await outbox('registration_cancelled')).toHaveLength(0);
    expect(regCancelledMail('a@example.test')).toHaveLength(0);

    const dashboard = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/dashboard`,
      headers: { cookie: s.cookie },
    });
    expect(dashboard.json().counts).toEqual({ confirmed: 0, waitlisted: 0, checkedIn: 0 });
    expect(await audits(event.id)).toEqual([{ details: { cancelled: 2, expired: 1, notified: 2 } }]);
  });

  // 2, 3
  it('hides other organizers’ events and requires a session, the CSRF token and the exact origin', async () => {
    const { s, event } = await setup();
    const intruder = await signIn(h, 'intruder@example.test');
    expect((await cancelEvent(intruder, event.id)).statusCode).toBe(404);
    expect((await cancelEvent(s, randomUUID())).statusCode).toBe(404);
    const noSession = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/cancellation`,
      headers: { origin: ORIGIN },
      payload: { confirmed: true },
    });
    expect(noSession.statusCode).toBe(401);
    const badCsrf = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/cancellation`,
      headers: { origin: ORIGIN, cookie: s.cookie, 'x-csrf-token': 'v1.1.wrong' },
      payload: { confirmed: true },
    });
    expect(badCsrf.json().code).toBe('csrf_failed');
    const foreign = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/cancellation`,
      headers: { ...organizerHeaders(s), origin: 'https://evil.example' },
      payload: { confirmed: true },
    });
    expect(foreign.json().code).toBe('origin_check_failed');
    expect((await eventRow(event.id)).status).toBe('SCHEDULED');
  });

  // 4 (AC-149)
  it('requires a recent sign-in; the re-authentication link cancels nothing, and a new confirmation does', async () => {
    const { s, event } = await setup();
    const session = await h.db
      .selectFrom('app.organizer_sessions')
      .select('authenticated_at')
      .where('account_id', '=', s.accountId)
      .where('revoked_at', 'is', null)
      .executeTakeFirstOrThrow();
    moveClockTo(session.authenticated_at, 16 * MINUTE);
    const stale = await cancelEvent(s, event.id);
    expect(stale.statusCode).toBe(401);
    expect(stale.json().code).toBe('reauthentication_required');
    expect((await eventRow(event.id)).status).toBe('SCHEDULED');

    const fresh = await reauthenticate(h, s, ORGANIZER);
    await drain(h);
    expect((await eventRow(event.id)).status).toBe('SCHEDULED'); // the link performed no action
    expect(cancelMail('a@example.test')).toHaveLength(0);
    expect((await cancelEvent(s, event.id)).statusCode).toBe(401); // the old session is revoked
    expect((await cancelEvent(fresh, event.id)).statusCode).toBe(200);
  });

  // 5
  it('requires the explicit confirmation', async () => {
    const { s, event } = await setup();
    for (const payload of [{}, { confirmed: false }, { confirmed: 'true' }, { confirmed: true, extra: 1 }]) {
      const response = await cancelEvent(s, event.id, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    }
    const noBody = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/cancellation`,
      headers: organizerHeaders(s),
    });
    expect(noBody.statusCode).toBe(422);
    expect((await eventRow(event.id)).status).toBe('SCHEDULED');
  });

  // 6
  it('rejects cancellation once the event has started', async () => {
    const { event } = await setup();
    moveClockTo(new Date(event.startsAt), MINUTE);
    const s = await signIn(h, ORGANIZER); // a fresh sign-in at the (moved) current time
    const response = await cancelEvent(s, event.id);
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('event_started');
    expect((await eventRow(event.id)).status).toBe('SCHEDULED');
  });

  // 7 (PD-39)
  it('answers a repeat with 200 and changes nothing; a stale session still gets reauthentication_required', async () => {
    const { s, event } = await setup();
    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    await drain(h);
    const before = await eventRow(event.id);
    const again = await cancelEvent(s, event.id);
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe('CANCELLED');
    await drain(h);
    expect(await eventRow(event.id)).toEqual(before);
    expect(cancelMail('a@example.test')).toHaveLength(1);
    expect(await outbox('event_cancellation')).toHaveLength(2);
    expect(await audits(event.id)).toHaveLength(1);

    moveClockTo(before.cancelled_at!, 16 * MINUTE);
    const stale = await cancelEvent(s, event.id);
    expect(stale.json().code).toBe('reauthentication_required');
  });

  it('is rate-limited per account without revealing anything about the event (PD-38)', async () => {
    const { s, event } = await setup();
    for (let i = 0; i < 5; i += 1) expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    const limited = await cancelEvent(s, event.id);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('rate_limited');

    const intruder = await signIn(h, 'intruder@example.test');
    for (let i = 0; i < 5; i += 1) expect((await cancelEvent(intruder, event.id)).statusCode).toBe(404);
    const theirs = await cancelEvent(intruder, event.id);
    const unknown = await cancelEvent(intruder, randomUUID());
    expect(theirs.statusCode).toBe(429);
    expect(Object.keys(theirs.json()).sort()).toEqual(Object.keys(unknown.json()).sort());
  });

  // 9, 20 (AC-19)
  it('invalidates tickets (EVENT_CANCELLED) and keeps the check-in history and the audit record', async () => {
    const s0 = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s0, { capacity: 3, startsInHours: 72 });
    const a = await registerConfirmed(h, event.publicId, 'a@example.test');
    const b = await registerConfirmed(h, event.publicId, 'b@example.test');
    moveClockTo(new Date(event.startsAt), -30 * MINUTE);
    const s = await signIn(h, ORGANIZER); // recent at the moved time
    expect((await checkIn(s, event.id, a.ticket.code)).json().outcome).toBe('CHECKED_IN');

    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    expect((await checkIn(s, event.id, b.ticket.code)).json().outcome).toBe('EVENT_CANCELLED');
    expect((await checkIn(s, event.id, a.ticket.code)).json().outcome).toBe('EVENT_CANCELLED');
    const checkIns = await h.db
      .selectFrom('app.check_ins')
      .select('id')
      .where('event_id', '=', event.id)
      .execute();
    expect(checkIns).toHaveLength(1);
    const tickets = await h.db
      .selectFrom('app.tickets')
      .select('id')
      .where('event_id', '=', event.id)
      .execute();
    expect(tickets).toHaveLength(2); // tickets are history, not deleted
    const dashboard = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}/dashboard`,
      headers: { cookie: s.cookie },
    });
    expect(dashboard.json().counts).toEqual({ confirmed: 0, waitlisted: 0, checkedIn: 1 }); // PD-41
    expect(await audits(event.id)).toHaveLength(1);
  });

  // 10, 11 (FR-LNK-6, FR-SHR-4, PD-36)
  it('makes management and verification links invalid and share links "not available"', async () => {
    const { s, event, a, w, pendingToken } = await setup();
    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    for (const link of [a.links.management, w.links.management]) {
      const view = await h.app.inject({
        method: 'GET',
        url: '/api/links/manage',
        headers: { authorization: `Link ${tokenFromLink(link)}` },
      });
      expect(view.body).toBe(GENERIC_INVALID_LINK_BODY);
      expect((await cancelByLink(link)).body).toBe(GENERIC_INVALID_LINK_BODY);
    }
    const share = await h.app.inject({
      method: 'GET',
      url: '/api/links/ticket',
      headers: { authorization: `Link ${tokenFromLink(a.links.share)}` },
    });
    expect(share.json().state).toBe('not_available');
    expect(share.json().ticket).toBeUndefined();
    const verify = await h.app.inject({
      method: 'GET',
      url: '/api/links/verify',
      headers: { authorization: `Link ${pendingToken}` },
    });
    expect(verify.body).toBe(GENERIC_INVALID_LINK_BODY);
    expect((await confirm(h, pendingToken)).body).toBe(GENERIC_INVALID_LINK_BODY);
    // No new registration (PD-42), and registration, promotion and changes all stop.
    expect((await register(h, event.publicId, 'new@example.test')).json().code).toBe('registration_closed');
    const capacity = await h.app.inject({
      method: 'PUT',
      url: `/api/events/${event.id}/capacity`,
      headers: organizerHeaders(s),
      payload: { capacity: 5 },
    });
    expect(capacity.json().code).toBe('event_not_scheduled');
    const reschedule = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/reschedule`,
      headers: organizerHeaders(s),
      payload: { localStart: localIn(96), expectedScheduleVersion: 2 },
    });
    expect(reschedule.json().code).toBe('event_not_scheduled');
    expect(await states(event.id)).not.toContain('new@example.test');
  });

  // 19 (PD-37)
  it('lets reminder and cutoff tasks become obsolete: they skip themselves and send nothing', async () => {
    const { s, event } = await setup();
    const tasksBefore = await h.db.selectFrom('app.scheduled_tasks').select('id').execute();
    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    expect(await h.db.selectFrom('app.scheduled_tasks').select('id').execute()).toHaveLength(
      tasksBefore.length,
    );
    await drain(h);

    moveClockTo(new Date(event.startsAt), -24 * HOUR + MINUTE);
    await drain(h);
    moveClockTo(new Date(event.startsAt), -2 * HOUR + MINUTE);
    await drain(h);
    const tasks = await h.db
      .selectFrom('app.scheduled_tasks')
      .select(['kind', 'status'])
      .orderBy('kind')
      .execute();
    expect(tasks).toEqual([
      { kind: 'cutoff_processing', status: 'SKIPPED' },
      { kind: 'reminder_fanout', status: 'SKIPPED' },
    ]);
    for (const email of ['a@example.test', 'w@example.test', 'p@example.test'])
      expect(mailFor(h, email).filter((m) => /^(Reminder|Registration closed)/.test(m.subject))).toHaveLength(
        0,
      );
    expect(await states(event.id)).toContain('p@example.test:EXPIRED(event_cancelled)'); // not re-expired
  });

  // 21
  it('retries a cancellation email after an ambiguous failure without duplicating or losing it', async () => {
    const { s, event } = await setup();
    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    await dispatcherWith(new FlakyProvider(new FakeEmailProvider(h.mailboxDir), 1)).runOnce();
    const afterFailure = await outbox('event_cancellation');
    expect(afterFailure.filter((m) => m.status === 'WAITING_RETRY')).toHaveLength(1);
    moveClockTo(new Date(), 2 * MINUTE); // past the first backoff
    await drain(h);
    expect(cancelMail('a@example.test')).toHaveLength(1);
    expect(cancelMail('w@example.test')).toHaveLength(1);
    expect((await outbox('event_cancellation')).map((m) => m.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
  });
});

describe('cancellation vs. queued emails (AC-18, EC-20)', () => {
  // 14, order 1
  it('cancellation commits first: queued messages of every implemented type are dropped at claim', async () => {
    const { s, event } = await setup();
    // Queue messages without delivering them: change emails, a verification, an access email.
    const moved = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/reschedule`,
      headers: organizerHeaders(s),
      payload: { localStart: localIn(96), expectedScheduleVersion: 1 },
    });
    expect(moved.statusCode).toBe(200);
    expect((await register(h, event.publicId, 'late@example.test')).statusCode).toBe(202);
    expect((await register(h, event.publicId, 'a@example.test')).statusCode).toBe(202);
    const queued = await h.db
      .selectFrom('app.outbox_messages')
      .select(['id', 'message_type'])
      .where('status', '=', 'QUEUED')
      .execute();
    expect(queued.map((m) => m.message_type).sort()).toEqual([
      'event_change',
      'event_change',
      'existing_access',
      'verification',
    ]);

    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    await drain(h);
    const settled = await h.db
      .selectFrom('app.outbox_messages')
      .select(['message_type', 'status'])
      .where(
        'id',
        'in',
        queued.map((m) => m.id),
      )
      .execute();
    for (const m of settled) expect([m.message_type, m.status]).toEqual([m.message_type, 'DROPPED']);
    expect(mailFor(h, 'late@example.test')).toHaveLength(0);
    expect(mailFor(h, 'a@example.test').filter((m) => m.subject.startsWith('Date changed'))).toHaveLength(0);
    expect(cancelMail('a@example.test')).toHaveLength(1); // only event-cancellation emails are new
  });

  // 14, order 2
  it('claim commits first: an already-claimed message may still be delivered (accepted limit EC-20)', async () => {
    const { s, event } = await setup();
    await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/reschedule`,
      headers: organizerHeaders(s),
      payload: { localStart: localIn(96), expectedScheduleVersion: 1 },
    });
    const gated = new GatedProvider(new FakeEmailProvider(h.mailboxDir));
    const run = dispatcherWith(gated).runOnce(); // claims both change emails (SENDING) and waits
    await gated.started;
    const cancellation = await cancelEvent(s, event.id); // commits while the claims are already committed
    expect(cancellation.statusCode).toBe(200);
    gated.release();
    await run;
    expect((await outbox('event_change')).map((m) => m.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
    await drain(h);
    expect(cancelMail('a@example.test')).toHaveLength(1);
  });

  it('never marks a possibly accepted message as dropped (D-12): it ends UNCONFIRMED', async () => {
    const { s, event } = await setup();
    await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/reschedule`,
      headers: organizerHeaders(s),
      payload: { localStart: localIn(96), expectedScheduleVersion: 1 },
    });
    await dispatcherWith(new FlakyProvider(new FakeEmailProvider(h.mailboxDir), 10)).runOnce();
    expect(
      (await outbox('event_change')).every((m) => m.status === 'WAITING_RETRY' && m.possibly_accepted),
    ).toBe(true);
    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    moveClockTo(new Date(), 2 * MINUTE);
    await drain(h);
    expect((await outbox('event_change')).map((m) => m.status)).toEqual(['UNCONFIRMED', 'UNCONFIRMED']);
  });
});

describe('cancellation races (BR-23, NFR-CON-1)', () => {
  // 15, both forced orders
  it('participant cancellation first: confirmation sent, no event-cancellation email for that registration', async () => {
    const { s, event, a } = await setup();
    expect((await cancelByLink(a.links.management)).statusCode).toBe(200);
    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    await drain(h);
    expect(regCancelledMail('a@example.test')).toHaveLength(1);
    expect(cancelMail('a@example.test')).toHaveLength(0);
    expect(await states(event.id)).toContain('a@example.test:CANCELLED(participant_cancelled)');
    // The promoted waiting participant is then cancelled with the event; the queued promotion is dropped.
    expect(cancelMail('w@example.test')).toHaveLength(1);
    expect(
      mailFor(h, 'w@example.test').filter((m) => m.subject.startsWith('A place became free')),
    ).toHaveLength(0);
  });

  it('event cancellation first: the participant’s request gets the generic response and no confirmation', async () => {
    const { s, event, a } = await setup();
    expect((await cancelEvent(s, event.id)).statusCode).toBe(200);
    expect((await cancelByLink(a.links.management)).body).toBe(GENERIC_INVALID_LINK_BODY);
    await drain(h);
    expect(regCancelledMail('a@example.test')).toHaveLength(0);
    expect(cancelMail('a@example.test')).toHaveLength(1);
  });

  it('simultaneous participant and event cancellation: exactly one of the two outcomes, never both', async () => {
    for (let round = 0; round < 4; round += 1) {
      await resetData(h);
      const { s, event, a } = await setup();
      const [participant, organizer] = await Promise.all([
        cancelByLink(a.links.management),
        cancelEvent(s, event.id),
      ]);
      expect(organizer.statusCode).toBe(200);
      await drain(h);
      const confirmations = regCancelledMail('a@example.test').length;
      const cancellations = cancelMail('a@example.test').length;
      expect(confirmations + cancellations).toBe(1);
      expect(participant.statusCode === 200).toBe(confirmations === 1);
    }
  });

  // 16
  it('a verification racing cancellation ends with no seat and at most the cancellation email', async () => {
    for (let round = 0; round < 4; round += 1) {
      await resetData(h);
      const { s, event, pendingToken } = await setup();
      const [verification, organizer] = await Promise.all([
        confirm(h, pendingToken),
        cancelEvent(s, event.id),
      ]);
      expect(organizer.statusCode).toBe(200);
      await drain(h);
      const p = (await states(event.id)).find((x) => x.startsWith('p@'))!;
      if (verification.statusCode === 200) {
        // Verified first (joined the waiting list), then cancelled with the event.
        expect(p).toBe('p@example.test:CANCELLED(event_cancelled)');
        expect(cancelMail('p@example.test')).toHaveLength(1);
      } else {
        expect(verification.body).toBe(GENERIC_INVALID_LINK_BODY);
        expect(p).toBe('p@example.test:EXPIRED(event_cancelled)');
        expect(cancelMail('p@example.test')).toHaveLength(0);
      }
      expect(
        mailFor(h, 'p@example.test').filter((m) =>
          /^(Your ticket|You are on the waiting list)/.test(m.subject),
        ),
      ).toHaveLength(0);
      expect((await eventRow(event.id)).confirmed_count).toBe(0);
    }
  });

  // 17
  it('a capacity increase racing cancellation never delivers a promotion and leaves no confirmed seat', async () => {
    for (let round = 0; round < 4; round += 1) {
      await resetData(h);
      const { s, event } = await setup();
      const [capacity, organizer] = await Promise.all([
        h.app.inject({
          method: 'PUT',
          url: `/api/events/${event.id}/capacity`,
          headers: organizerHeaders(s),
          payload: { capacity: 2 },
        }),
        cancelEvent(s, event.id),
      ]);
      expect(organizer.statusCode).toBe(200);
      expect([200, 409]).toContain(capacity.statusCode);
      if (capacity.statusCode === 409) expect(capacity.json().code).toBe('event_not_scheduled');
      await drain(h);
      expect(
        mailFor(h, 'w@example.test').filter((m) => m.subject.startsWith('A place became free')),
      ).toHaveLength(0);
      expect(cancelMail('w@example.test')).toHaveLength(1);
      expect((await eventRow(event.id)).confirmed_count).toBe(0);
    }
  });

  // 18
  it('two simultaneous cancellations: both succeed, one set of emails and one audit record', async () => {
    const { s, event } = await setup();
    const responses = await Promise.all([cancelEvent(s, event.id), cancelEvent(s, event.id)]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    await drain(h);
    expect(cancelMail('a@example.test')).toHaveLength(1);
    expect(cancelMail('w@example.test')).toHaveLength(1);
    expect(await outbox('event_cancellation')).toHaveLength(2);
    expect(await audits(event.id)).toHaveLength(1);
  });
});
