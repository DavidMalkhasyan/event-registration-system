import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recentAuthentication, requireRecentAuthentication } from '../src/modules/identity/sessions.js';
import { hashToken } from '../src/platform/crypto.js';
import { GENERIC_INVALID_LINK_BODY } from '../src/platform/errors.js';
import { decisionTime, withEventLock } from '../src/platform/tx.js';
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

const MINUTE = 60_000;
const ORGANIZER = 'organizer@example.test';
const reauthMail = (email: string) =>
  mailFor(h, email).filter((m) => m.subject.startsWith('Confirm it is you'));

function requestReauth(s: Session, headers: Record<string, string> = organizerHeaders(s), payload?: unknown) {
  return h.app.inject({
    method: 'POST',
    url: '/api/auth/reauthentication',
    headers,
    ...(payload ? { payload: payload as Record<string, unknown> } : {}),
  });
}

/** Sends a re-authentication link and returns the raw link token from the email. */
async function reauthLink(s: Session, email = ORGANIZER): Promise<string> {
  const before = reauthMail(email).length;
  const response = await requestReauth(s);
  expect(response.statusCode).toBe(202);
  expect(response.json()).toEqual({ status: 'check_your_email' });
  await drain(h);
  const mails = reauthMail(email);
  expect(mails).toHaveLength(before + 1);
  return linkToken(mails[0]!, '/sign-in'); // newest first
}

/** Opens and confirms a sign-in link in a browser without a session (another device, or the same one). */
async function confirmLink(token: string) {
  const view = await h.app.inject({
    method: 'GET',
    url: '/api/links/sign-in',
    headers: { authorization: `Link ${token}` },
  });
  if (view.statusCode !== 200) return { view, confirm: view, session: undefined };
  const nonce = view.cookies.find((c) => c.name === '__Host-ers_presession')!.value;
  const confirm = await h.app.inject({
    method: 'POST',
    url: '/api/links/sign-in/confirm',
    headers: {
      origin: ORIGIN,
      authorization: `Link ${token}`,
      'x-csrf-token': view.json().preSessionToken,
      cookie: `__Host-ers_presession=${nonce}`,
    },
  });
  const raw = confirm.cookies.find((c) => c.name === '__Host-ers_org')?.value;
  if (!raw) return { view, confirm, session: undefined };
  const cookie = `__Host-ers_org=${raw}`;
  const me = await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
  return { view, confirm, session: { cookie, csrf: me.json().csrfToken, accountId: me.json().accountId } };
}

function sessionIdOf(s: Session): Promise<string> {
  const hash = hashToken('organizer_session', s.cookie.split('=')[1]!)!;
  return h.db
    .selectFrom('app.organizer_sessions')
    .select('id')
    .where('session_hash', '=', hash)
    .executeTakeFirstOrThrow()
    .then((r) => r.id);
}

async function sessionRow(s: Session) {
  return h.db
    .selectFrom('app.organizer_sessions')
    .selectAll()
    .where('id', '=', await sessionIdOf(s))
    .executeTakeFirstOrThrow();
}

async function isSignedIn(s: Session): Promise<boolean> {
  const me = await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: s.cookie } });
  return me.statusCode === 200;
}

/** Runs the helper inside an event-locked transaction, as cancellation and deletion will (FR-ORG-5). */
async function checkUnderEventLock(eventId: string, sessionId: string) {
  return withEventLock(h.db, eventId, 'exclusive', ({ trx, now }) =>
    recentAuthentication(trx, sessionId, now),
  );
}

describe('recent authentication (K-302b: FR-ORG-5, AC-149, ADR-010 §8)', () => {
  it('is recent for less than 15 minutes after sign-in, using the decision time inside the locked transaction', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    const id = await sessionIdOf(s);
    const { authenticated_at } = await sessionRow(s);

    expect(await checkUnderEventLock(event.id, id)).toBe('recent');
    moveClockTo(authenticated_at, 14 * MINUTE);
    expect(await checkUnderEventLock(event.id, id)).toBe('recent');
    moveClockTo(authenticated_at, 15 * MINUTE + 1_000);
    expect(await checkUnderEventLock(event.id, id)).toBe('reauthentication_required');
    moveClockTo(authenticated_at, 16 * MINUTE); // AC-149: "signed in 16 minutes ago"
    expect(await checkUnderEventLock(event.id, id)).toBe('reauthentication_required');

    // The exact boundary, with the decision time passed explicitly: 15:00.000 is no longer recent.
    const at = (ms: number) =>
      h.db
        .transaction()
        .execute((trx) => recentAuthentication(trx, id, new Date(authenticated_at.getTime() + ms)));
    expect(await at(15 * MINUTE - 1)).toBe('recent');
    expect(await at(15 * MINUTE)).toBe('reauthentication_required');

    // The throwing variant maps to the existing error code.
    await expect(
      withEventLock(h.db, event.id, 'exclusive', ({ trx, now }) => requireRecentAuthentication(trx, id, now)),
    ).rejects.toMatchObject({ status: 401, code: 'reauthentication_required' });
  });

  it('treats revoked and expired sessions as unauthenticated', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    const id = await sessionIdOf(s);
    await h.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: organizerHeaders(s) });
    expect(await checkUnderEventLock(event.id, id)).toBe('unauthenticated');
    await expect(
      withEventLock(h.db, event.id, 'exclusive', ({ trx, now }) => requireRecentAuthentication(trx, id, now)),
    ).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });
});

describe('requesting re-authentication (POST /api/auth/reauthentication)', () => {
  it('requires a session, the CSRF token and the exact origin', async () => {
    const s = await signIn(h, ORGANIZER);
    expect((await requestReauth(s, { origin: ORIGIN })).statusCode).toBe(401);
    const badCsrf = await requestReauth(s, {
      origin: ORIGIN,
      cookie: s.cookie,
      'x-csrf-token': 'v1.1.wrong',
    });
    expect(badCsrf.statusCode).toBe(403);
    expect(badCsrf.json().code).toBe('csrf_failed');
    const foreign = await requestReauth(s, { ...organizerHeaders(s), origin: 'https://evil.example' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json().code).toBe('origin_check_failed');
    const requests = await h.db
      .selectFrom('app.sign_in_requests')
      .select('id')
      .where('purpose', '=', 'reauth')
      .execute();
    expect(requests).toHaveLength(0);
  });

  it('sends the link only to the account’s current address, with a clear "changes nothing" text, and audits by account ID only', async () => {
    const s = await signIn(h, ORGANIZER);
    // Any body is ignored: the address always comes from the account.
    const response = await requestReauth(s, organizerHeaders(s), { email: 'attacker@example.test' });
    expect(response.statusCode).toBe(202);
    await drain(h);
    expect(mailFor(h, 'attacker@example.test')).toHaveLength(0);
    const [mail] = reauthMail(ORGANIZER);
    expect(mail!.text).toContain('does not cancel, delete or otherwise change any event');
    expect(mail!.text).toMatch(/\/sign-in#t=/);

    const request = await h.db
      .selectFrom('app.sign_in_requests')
      .selectAll()
      .where('purpose', '=', 'reauth')
      .executeTakeFirstOrThrow();
    expect(request.email).toBe(ORGANIZER);
    expect(request.account_id).toBe(s.accountId);
    expect(request.reauth_session_id).toBe(await sessionIdOf(s));

    const audit = await h.db
      .selectFrom('app.audit_records')
      .selectAll()
      .where('action', '=', 'reauth_requested')
      .executeTakeFirstOrThrow();
    expect(audit.actor_account_id).toBe(s.accountId);
    expect(JSON.stringify(audit)).not.toContain(ORGANIZER); // FR-ORG-8: no addresses
  });

  it('is rate-limited per account', async () => {
    const s = await signIn(h, ORGANIZER);
    for (let i = 0; i < 5; i += 1) expect((await requestReauth(s)).statusCode).toBe(202);
    const limited = await requestReauth(s);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('rate_limited');
  });

  it('keeps one active link per address: a newer sign-in request replaces it, and vice versa (FR-ORG-3 b)', async () => {
    const s = await signIn(h, ORGANIZER);
    const reauthToken = await reauthLink(s);
    await h.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in-requests',
      headers: { origin: ORIGIN },
      payload: { email: ORGANIZER },
    });
    await drain(h);
    const replaced = await confirmLink(reauthToken);
    expect(replaced.view.statusCode).toBe(404);
    expect(replaced.view.body).toBe(GENERIC_INVALID_LINK_BODY);
    expect(await isSignedIn(s)).toBe(true); // nothing was revoked

    const second = await reauthLink(s);
    const active = await h.db
      .selectFrom('app.sign_in_requests')
      .select('purpose')
      .where('email', '=', ORGANIZER)
      .where('status', '=', 'active')
      .execute();
    expect(active).toEqual([{ purpose: 'reauth' }]);
    expect((await confirmLink(second)).confirm.statusCode).toBe(200);
  });
});

describe('confirming re-authentication (TX-A02)', () => {
  it('creates a new, recent session, revokes the requesting one, and rejects the old cookie', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    const oldId = await sessionIdOf(s);
    const { authenticated_at } = await sessionRow(s);
    moveClockTo(authenticated_at, 20 * MINUTE); // the old sign-in is stale now
    expect(await checkUnderEventLock(event.id, oldId)).toBe('reauthentication_required');

    const token = await reauthLink(s);
    const { view, confirm, session } = await confirmLink(token);
    expect(view.json().purpose).toBe('reauth');
    expect(confirm.statusCode).toBe(200);
    expect(session).toBeDefined();

    const fresh = await sessionRow(session!);
    expect(fresh.id).not.toBe(oldId);
    expect(fresh.authenticated_at.getTime()).toBeGreaterThan(authenticated_at.getTime() + 19 * MINUTE);
    expect(await checkUnderEventLock(event.id, fresh.id)).toBe('recent');
    expect(session!.csrf).not.toBe(s.csrf); // a new session has a new anti-forgery token

    const old = await h.db
      .selectFrom('app.organizer_sessions')
      .selectAll()
      .where('id', '=', oldId)
      .executeTakeFirstOrThrow();
    expect(old.revoked_at).not.toBeNull();
    expect(old.revoke_reason).toBe('reauth_replaced');
    expect(await isSignedIn(s)).toBe(false);
    expect((await requestReauth(s)).statusCode).toBe(401);
    expect(await checkUnderEventLock(event.id, oldId)).toBe('unauthenticated');

    const audit = await h.db
      .selectFrom('app.audit_records')
      .select('action')
      .where('action', '=', 'reauth_confirmed')
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('rejects an expired link and a replayed link with the generic response', async () => {
    const s = await signIn(h, ORGANIZER);
    const token = await reauthLink(s);
    const now = await decisionTime(h.db);
    moveClockTo(now, 15 * MINUTE + 1_000);
    const expired = await confirmLink(token);
    expect(expired.view.body).toBe(GENERIC_INVALID_LINK_BODY);
    expect(await isSignedIn(s)).toBe(true); // an unused link revokes nothing

    moveClockTo(new Date(), 0);
    const fresh = await reauthLink(s);
    const first = await confirmLink(fresh);
    expect(first.confirm.statusCode).toBe(200);
    const sessionsAfterFirst = await h.db.selectFrom('app.organizer_sessions').select('id').execute();
    const replay = await confirmLink(fresh);
    expect(replay.view.statusCode).toBe(404);
    expect(replay.view.body).toBe(GENERIC_INVALID_LINK_BODY);
    expect(await h.db.selectFrom('app.organizer_sessions').select('id').execute()).toHaveLength(
      sessionsAfterFirst.length,
    );
  });

  it('works from a second device: that device is signed in, the requesting device is signed out', async () => {
    const deviceA = await signIn(h, ORGANIZER);
    const token = await reauthLink(deviceA);
    const deviceB = await confirmLink(token); // no cookie: a different browser
    expect(deviceB.session).toBeDefined();
    expect(await isSignedIn(deviceB.session!)).toBe(true);
    expect(await isSignedIn(deviceA)).toBe(false);
  });

  it('opening or confirming the link performs no action on events or registrations (AC-149)', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'a@example.test');
    await registerConfirmed(h, event.publicId, 'w@example.test');
    await drain(h);
    const snapshot = async () => ({
      events: await h.db.selectFrom('app.events').selectAll().execute(),
      registrations: await h.db.selectFrom('app.registrations').selectAll().orderBy('id').execute(),
      tickets: await h.db.selectFrom('app.tickets').selectAll().orderBy('id').execute(),
      tasks: await h.db.selectFrom('app.scheduled_tasks').selectAll().orderBy('id').execute(),
      eventMessages: await h.db
        .selectFrom('app.outbox_messages')
        .select('id')
        .where('event_id', 'is not', null)
        .execute(),
    });
    const before = await snapshot();
    const token = await reauthLink(s);
    const { view, confirm } = await confirmLink(token);
    expect(Object.keys(view.json()).sort()).toEqual(['maskedEmail', 'preSessionToken', 'purpose']); // no event data
    expect(confirm.json()).toEqual({ redirect: '/organizer/' });
    await drain(h);
    expect(await snapshot()).toEqual(before);
    for (const email of ['a@example.test', 'w@example.test'])
      expect(mailFor(h, email).filter((m) => /cancel/i.test(m.subject))).toHaveLength(0);
  });
});

describe('race: re-authentication confirmation vs. an operation with the old session', () => {
  it('serializes them: a confirmation waits for an operation that already passed the check, then the old session is rejected', async () => {
    const s = await signIn(h, ORGANIZER);
    const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
    const oldId = await sessionIdOf(s);
    const token = await reauthLink(s);

    // An operation under the event lock passes the recent-authentication check and is still open.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let checked!: () => void;
    const passed = new Promise<void>((r) => (checked = r));
    const operation = withEventLock(h.db, event.id, 'exclusive', async ({ trx, now }) => {
      await requireRecentAuthentication(trx, oldId, now);
      checked();
      await gate;
      await trx
        .updateTable('app.events')
        .set({ title: 'Changed by the operation' })
        .where('id', '=', event.id)
        .execute();
      return 'done';
    });
    await passed;

    let confirmed = false;
    let result: Awaited<ReturnType<typeof confirmLink>>;
    try {
      const confirmation = confirmLink(token).then((r) => {
        confirmed = true;
        return r;
      });
      await new Promise((r) => setTimeout(r, 750));
      expect(confirmed).toBe(false); // the revocation waits for the operation's share lock on the session row
      release();
      expect(await operation).toBe('done');
      result = await confirmation;
    } finally {
      release(); // never leave the operation's transaction open, even when an assertion fails
    }
    expect(result.confirm.statusCode).toBe(200);

    // From now on the old session can't pass the check: the confirmation committed after the operation.
    await expect(
      withEventLock(h.db, event.id, 'exclusive', ({ trx, now }) =>
        requireRecentAuthentication(trx, oldId, now),
      ),
    ).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
    expect(await checkUnderEventLock(event.id, await sessionIdOf(result.session!))).toBe('recent');
  });

  it('with simultaneous starts, the old session either acts before its revocation commits or is rejected', async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetData(h);
      const s = await signIn(h, ORGANIZER);
      const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
      const oldId = await sessionIdOf(s);
      const token = await reauthLink(s);
      const [op, confirmation] = await Promise.all([
        withEventLock(h.db, event.id, 'exclusive', async ({ trx, now }) => {
          const status = await recentAuthentication(trx, oldId, now);
          if (status === 'recent')
            await trx.updateTable('app.events').set({ title: 'Acted' }).where('id', '=', event.id).execute();
          return status;
        }),
        confirmLink(token),
      ]);
      expect(confirmation.confirm.statusCode).toBe(200);
      expect(['recent', 'unauthenticated']).toContain(op);
      const title = (
        await h.db
          .selectFrom('app.events')
          .select('title')
          .where('id', '=', event.id)
          .executeTakeFirstOrThrow()
      ).title;
      expect(title).toBe(op === 'recent' ? 'Acted' : 'Test event');
      expect(await isSignedIn(s)).toBe(false);
    }
  });
});
