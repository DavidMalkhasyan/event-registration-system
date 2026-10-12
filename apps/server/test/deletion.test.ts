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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ORGANIZER = 'organizer@example.test';
const TOKEN = /^v1\.1\.[0-9]{10}\.[A-Za-z0-9_-]{43}$/;

function preview(s: Session, eventId: string) {
  return h.app.inject({
    method: 'GET',
    url: `/api/events/${eventId}/deletion-preview`,
    headers: { cookie: s.cookie },
  });
}

function deleteEvent(s: Session, eventId: string, previewToken: string, extra: Record<string, unknown> = {}) {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/deletion`,
    headers: organizerHeaders(s),
    payload: { confirmed: true, previewToken, ...extra },
  });
}

async function previewToken(s: Session, eventId: string): Promise<string> {
  const response = await preview(s, eventId);
  expect(response.statusCode).toBe(200);
  return response.json().previewToken;
}

function cancelByLink(managementLink: string) {
  return h.app.inject({
    method: 'POST',
    url: '/api/links/manage/cancel',
    headers: { origin: ORIGIN, authorization: `Link ${tokenFromLink(managementLink)}` },
    payload: { confirmed: true },
  });
}

async function eventExists(eventId: string): Promise<boolean> {
  return !!(await h.db.selectFrom('app.events').select('id').where('id', '=', eventId).executeTakeFirst());
}

async function requiredNotices(eventId: string) {
  return h.db
    .selectFrom('app.outbox_messages')
    .select(['recipient_email', 'status'])
    .where('event_id', '=', eventId)
    .where('is_required_notice', '=', true)
    .orderBy('recipient_email')
    .execute();
}

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

class FailingProvider implements EmailProvider {
  async send(): Promise<never> {
    throw new Error('simulated timeout'); // ambiguous: possibly accepted
  }
}

const dispatcherWith = (provider: EmailProvider) =>
  new Dispatcher(h.db, provider, ORIGIN, `test-${randomUUID()}`);

describe('event deletion (K-304d: FR-EVT-10, FR-EVT-13, FR-EVT-14, TX-E06)', () => {
  it('deletes an eligible event with its pending registrations; writes the marker; keeps the audit trail (AC-21, AC-100)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72, title: 'Secret title' });
    await h.app.inject({
      method: 'PATCH',
      url: `/api/events/${event.id}`,
      headers: organizerHeaders(s),
      payload: { description: 'Secret description' },
    });
    const pendingToken = await registerAndGetVerifyToken(h, event.publicId, 'pending@example.test');

    const view = await preview(s, event.id);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({ eligible: true, blockers: [], requiredNoticeIssues: [] });
    expect(view.json().previewToken).toMatch(TOKEN);
    const expiresIn = new Date(view.json().previewExpiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(9 * MINUTE);
    expect(expiresIn).toBeLessThanOrEqual(10 * MINUTE);

    const deleted = await deleteEvent(s, event.id, view.json().previewToken);
    expect(deleted.statusCode).toBe(204);
    expect(await eventExists(event.id)).toBe(false);

    // FR-EVT-13: afterwards the event is not found, and its links are generic invalid links.
    for (const url of [
      `/api/events/${event.id}`,
      `/api/events/${event.id}/dashboard`,
      `/api/events/${event.id}/participants`,
    ])
      expect((await h.app.inject({ method: 'GET', url, headers: { cookie: s.cookie } })).statusCode).toBe(
        404,
      );
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/public/events/${event.publicId}` })).statusCode,
    ).toBe(404);
    const verify = await h.app.inject({
      method: 'GET',
      url: '/api/links/verify',
      headers: { authorization: `Link ${pendingToken}` },
    });
    expect(verify.body).toBe(GENERIC_INVALID_LINK_BODY);
    expect(
      await h.db.selectFrom('app.registrations').select('id').where('event_id', '=', event.id).execute(),
    ).toHaveLength(0);
    expect(
      await h.db.selectFrom('app.access_tokens').select('id').where('event_id', '=', event.id).execute(),
    ).toHaveLength(0);

    // FR-EVT-14 marker: exactly its fields, no title, description, address or token.
    const marker = await h.db
      .selectFrom('app.deletion_markers')
      .selectAll()
      .where('event_id', '=', event.id)
      .executeTakeFirstOrThrow();
    expect(Object.keys(marker).sort()).toEqual([
      'deleted_at',
      'deleted_by_account_id',
      'event_id',
      'failed_required_notices',
      'owner_account_id',
      'registrations_deleted',
      'scheduled_start',
      'time_zone',
      'unconfirmed_required_notices',
    ]);
    expect(marker).toMatchObject({
      owner_account_id: s.accountId,
      deleted_by_account_id: s.accountId,
      time_zone: 'UTC',
      registrations_deleted: 1,
      failed_required_notices: 0,
      unconfirmed_required_notices: 0,
    });
    expect(marker.scheduled_start.toISOString()).toBe(event.startsAt);
    const audits = await h.db
      .selectFrom('app.audit_records')
      .selectAll()
      .where('event_id', '=', event.id)
      .execute();
    expect(audits.map((a) => a.action).sort()).toEqual(['event_deleted', 'event_details_edit']);
    for (const text of [JSON.stringify(marker), JSON.stringify(audits)])
      for (const secret of ['Secret title', 'Secret description', 'pending@example.test', pendingToken])
        expect(text).not.toContain(secret);
    await expect(
      h.db
        .updateTable('app.deletion_markers')
        .set({ registrations_deleted: 9 })
        .where('event_id', '=', event.id)
        .execute(),
    ).rejects.toThrow(/append-only/);

    // A repeat gets 404 (API: "a repeat gets 404").
    expect((await deleteEvent(s, event.id, view.json().previewToken)).statusCode).toBe(404);
  });

  it('hides other organizers’ events and requires a session, CSRF, origin and a recent sign-in', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const token = await previewToken(s, event.id);
    const intruder = await signIn(h, 'intruder@example.test');
    expect((await preview(intruder, event.id)).statusCode).toBe(404);
    expect((await deleteEvent(intruder, event.id, token)).statusCode).toBe(404);
    expect((await preview(s, randomUUID())).statusCode).toBe(404);
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/events/${event.id}/deletion-preview` })).statusCode,
    ).toBe(401);
    const badCsrf = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/deletion`,
      headers: { origin: ORIGIN, cookie: s.cookie, 'x-csrf-token': 'v1.1.wrong' },
      payload: { confirmed: true, previewToken: token },
    });
    expect(badCsrf.json().code).toBe('csrf_failed');
    const foreign = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/deletion`,
      headers: { ...organizerHeaders(s), origin: 'https://evil.example' },
      payload: { confirmed: true, previewToken: token },
    });
    expect(foreign.json().code).toBe('origin_check_failed');
    for (const payload of [
      { previewToken: token },
      { confirmed: true },
      { confirmed: true, previewToken: 'v1.1.x.y' },
    ])
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `/api/events/${event.id}/deletion`,
            headers: organizerHeaders(s),
            payload,
          })
        ).statusCode,
      ).toBe(422);

    const session = await h.db
      .selectFrom('app.organizer_sessions')
      .select('authenticated_at')
      .where('account_id', '=', s.accountId)
      .executeTakeFirstOrThrow();
    moveClockTo(session.authenticated_at, 16 * MINUTE);
    expect((await preview(s, event.id)).json().code).toBe('reauthentication_required');
    expect((await deleteEvent(s, event.id, token)).json().code).toBe('reauthentication_required');
    expect(await eventExists(event.id)).toBe(true);
  });

  it('never deletes a cancelled event (AC-86, BR-26, FR-EVT-11)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const before = await previewToken(s, event.id);
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/api/events/${event.id}/cancellation`,
          headers: organizerHeaders(s),
          payload: { confirmed: true },
        })
      ).statusCode,
    ).toBe(200);
    const view = await preview(s, event.id);
    expect(view.json()).toMatchObject({ eligible: false, blockers: ['event_cancelled'] });
    for (const token of [view.json().previewToken, before]) {
      const response = await deleteEvent(s, event.id, token);
      expect(response.statusCode).toBe(409);
      expect(response.json().code).toBe('cancelled_event_not_deletable');
      expect(response.json().title).toBe("Cancelled events can't be deleted");
    }
    expect(await eventExists(event.id)).toBe(true);
  });

  it('is blocked by confirmed and waiting registrations, then by pending required notices, and succeeds once they settle (AC-87, AC-97)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    const a = await registerConfirmed(h, event.publicId, 'a@example.test');
    const w = await registerConfirmed(h, event.publicId, 'w@example.test');
    await drain(h);
    const blocked = await preview(s, event.id);
    expect(blocked.json()).toMatchObject({
      eligible: false,
      blockers: ['has_confirmed_registrations', 'has_waitlisted_registrations'],
    });
    const rejected = await deleteEvent(s, event.id, blocked.json().previewToken);
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({
      code: 'deletion_blocked',
      reasons: ['has_confirmed_registrations', 'has_waitlisted_registrations'],
    });

    // Both participants cancel: their confirmations are required notices, still queued.
    expect((await cancelByLink(w.links.management)).statusCode).toBe(200);
    expect((await cancelByLink(a.links.management)).statusCode).toBe(200);
    const pending = await preview(s, event.id);
    expect(pending.json()).toMatchObject({ eligible: false, blockers: ['notifications_pending'] });
    const waiting = await deleteEvent(s, event.id, pending.json().previewToken);
    expect(waiting.json().code).toBe('notifications_pending');
    expect((await requiredNotices(event.id)).map((n) => n.status)).toEqual(['QUEUED', 'QUEUED']); // unchanged

    await drain(h);
    const ready = await preview(s, event.id);
    expect(ready.json()).toMatchObject({ eligible: true, blockers: [] });
    expect((await deleteEvent(s, event.id, ready.json().previewToken)).statusCode).toBe(204);
    expect((await requiredNotices(event.id)).map((n) => n.status)).toEqual(['ACCEPTED', 'ACCEPTED']); // never discarded
    const marker = await h.db
      .selectFrom('app.deletion_markers')
      .selectAll()
      .where('event_id', '=', event.id)
      .executeTakeFirstOrThrow();
    expect(marker.registrations_deleted).toBe(2);
  });

  it('rejects an expired, changed, foreign or tampered preview token with preview_invalid (API_DESIGN §7.4)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const other = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const pendingToken = await registerAndGetVerifyToken(h, event.publicId, 'p@example.test');

    const token = await previewToken(s, event.id);
    expect((await deleteEvent(s, event.id, await previewToken(s, other.id))).json().code).toBe(
      'preview_invalid',
    );
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect((await deleteEvent(s, event.id, tampered)).json().code).toBe('preview_invalid');

    // The state changed after the preview: the participant confirmed, so the token no longer matches.
    expect((await confirm(h, pendingToken)).json().result).toBe('confirmed');
    expect((await deleteEvent(s, event.id, token)).json().code).toBe('preview_invalid');

    // Expired: 10 minutes (the sign-in is still recent at 10:01).
    const fresh = await previewToken(s, other.id);
    const session = await h.db
      .selectFrom('app.organizer_sessions')
      .select('authenticated_at')
      .where('account_id', '=', s.accountId)
      .executeTakeFirstOrThrow();
    moveClockTo(new Date(Math.max(Date.now(), session.authenticated_at.getTime())), 10 * MINUTE + 1_000);
    expect((await deleteEvent(s, other.id, fresh)).json().code).toBe('preview_invalid');
    expect(await eventExists(event.id)).toBe(true);
    expect(await eventExists(other.id)).toBe(true);
  });

  it('reports settled required notices, counts them in the marker, and settles other pending messages (AC-184, FR-EVT-10)', async () => {
    const s0 = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s0, { capacity: 3, startsInHours: 72 });
    const a = await registerConfirmed(h, event.publicId, 'a@example.test');
    const b = await registerConfirmed(h, event.publicId, 'b@example.test');
    const c = await registerConfirmed(h, event.publicId, 'c@example.test');
    await drain(h);
    // a: delivered. b: attempted ambiguously, then the retry horizon passes → UNCONFIRMED.
    // c: never attempted before the horizon → FAILED. (Real dispatcher paths, no fixtures.)
    await cancelByLink(a.links.management);
    await drain(h);
    await cancelByLink(b.links.management);
    await dispatcherWith(new FailingProvider()).runOnce();
    await cancelByLink(c.links.management);
    // Another, non-required message still queued: a verification for a new registrant.
    expect((await register(h, event.publicId, 'late@example.test')).statusCode).toBe(202);
    moveClockTo(new Date(), 6 * HOUR + MINUTE);
    await h.dispatcher.runOnce(); // its sweep applies the retry horizon
    expect((await requiredNotices(event.id)).map((n) => [n.recipient_email, n.status])).toEqual([
      ['a@example.test', 'ACCEPTED'],
      ['b@example.test', 'UNCONFIRMED'],
      ['c@example.test', 'FAILED'],
    ]);
    const s = await signIn(h, ORGANIZER); // recent at the moved time (signIn drains the outbox)
    // The horizon also settled the first verification; a resubmission queues a fresh, pending one.
    expect((await register(h, event.publicId, 'late@example.test')).statusCode).toBe(202);
    const view = await preview(s, event.id);
    expect(view.json().eligible).toBe(true);
    expect(
      view
        .json()
        .requiredNoticeIssues.map((i: { sendState: string; label: string }) => [i.sendState, i.label])
        .sort(),
    ).toEqual([
      ['FAILED', 'failed'],
      ['UNCONFIRMED', 'delivery_outcome_unknown'],
    ]);
    expect((await deleteEvent(s, event.id, view.json().previewToken)).statusCode).toBe(204);

    const marker = await h.db
      .selectFrom('app.deletion_markers')
      .selectAll()
      .where('event_id', '=', event.id)
      .executeTakeFirstOrThrow();
    expect(marker).toMatchObject({
      registrations_deleted: 4,
      failed_required_notices: 1,
      unconfirmed_required_notices: 1,
    });
    const verifications = await h.db
      .selectFrom('app.outbox_messages')
      .select(['status', 'settle_reason'])
      .where('recipient_email', '=', 'late@example.test')
      .orderBy('created_at')
      .execute();
    expect(verifications.at(-1)).toEqual({ status: 'DROPPED', settle_reason: 'event_deleted' });
    await drain(h);
    expect(mailFor(h, 'late@example.test')).toHaveLength(0);
  });

  it('marks a possibly accepted pending message UNCONFIRMED, not DROPPED (D-12)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    expect((await register(h, event.publicId, 'late@example.test')).statusCode).toBe(202);
    await dispatcherWith(new FailingProvider()).runOnce();
    expect((await deleteEvent(s, event.id, await previewToken(s, event.id))).statusCode).toBe(204);
    const message = await h.db
      .selectFrom('app.outbox_messages')
      .select(['status', 'settle_reason'])
      .where('recipient_email', '=', 'late@example.test')
      .executeTakeFirstOrThrow();
    expect(message).toEqual({ status: 'UNCONFIRMED', settle_reason: 'event_deleted' });
  });

  it('leaves scheduled tasks to skip themselves after deletion, sending nothing', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    expect((await deleteEvent(s, event.id, await previewToken(s, event.id))).statusCode).toBe(204);
    moveClockTo(new Date(event.startsAt), -MINUTE);
    await drain(h);
    const tasks = await h.db
      .selectFrom('app.scheduled_tasks')
      .select('status')
      .where('event_id', '=', event.id)
      .execute();
    expect(tasks.map((t) => t.status)).toEqual(['SKIPPED', 'SKIPPED']);
  });
});

describe('deletion races (FR-EVT-13, AC-88, AC-98)', () => {
  it('deletion vs. a participant confirming: exactly one outcome (AC-88)', async () => {
    for (let round = 0; round < 4; round += 1) {
      await resetData(h);
      const s = await signIn(h, ORGANIZER);
      const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
      const pendingToken = await registerAndGetVerifyToken(h, event.publicId, 'p@example.test');
      const token = await previewToken(s, event.id);
      const [verification, deletion] = await Promise.all([
        confirm(h, pendingToken),
        deleteEvent(s, event.id, token),
      ]);
      if (deletion.statusCode === 204) {
        expect(verification.body).toBe(GENERIC_INVALID_LINK_BODY);
        expect(await eventExists(event.id)).toBe(false);
      } else {
        expect(verification.json().result).toBe('confirmed');
        expect(deletion.json().code).toBe('preview_invalid');
        expect(await eventExists(event.id)).toBe(true);
      }
    }
  });

  it('a required notice being sent blocks deletion; it is never dropped, and deletion succeeds after it settles (AC-98)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 3, startsInHours: 72 });
    const a = await registerConfirmed(h, event.publicId, 'a@example.test');
    await drain(h);
    expect((await cancelByLink(a.links.management)).statusCode).toBe(200);

    const gated = new GatedProvider(new FakeEmailProvider(h.mailboxDir));
    const run = dispatcherWith(gated).runOnce();
    await gated.started; // the notice's claim has committed: SENDING
    try {
      const view = await preview(s, event.id);
      expect(view.json().blockers).toEqual(['notifications_pending']);
      expect((await deleteEvent(s, event.id, view.json().previewToken)).json().code).toBe(
        'notifications_pending',
      );
    } finally {
      gated.release();
    }
    await run;
    expect((await requiredNotices(event.id)).map((n) => n.status)).toEqual(['ACCEPTED']);
    expect((await deleteEvent(s, event.id, await previewToken(s, event.id))).statusCode).toBe(204);
    expect((await requiredNotices(event.id)).map((n) => n.status)).toEqual(['ACCEPTED']);
    expect(
      mailFor(h, 'a@example.test').filter((m) => m.subject.startsWith('Registration cancelled')),
    ).toHaveLength(1);
  });
});
