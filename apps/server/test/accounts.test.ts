import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GENERIC_INVALID_LINK_BODY } from '../src/platform/errors.js';
import { hashPassword, verifyPassword } from '../src/platform/passwords.js';
import {
  ORIGIN,
  createEvent,
  createHarness,
  drain,
  ensureOrganizer,
  linkToken,
  localIn,
  mailFor,
  organizerHeaders,
  resetData,
  type Harness,
  type Session,
} from './harness.js';

// K-709 (amendment A-3, PD-89): organization registration, email verification, password sign-in and
// reset, password re-authentication, and the emailed-link fallback for accounts without a password.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const PASSWORD = 'correct horse battery staple';
const EMAIL = 'founder@example.test';

function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
  return h.app.inject({
    method: 'POST',
    url,
    headers: { origin: ORIGIN, ...headers },
    payload: payload as object,
  });
}

function registerOrg(email = EMAIL, extra: Record<string, unknown> = {}) {
  return post('/api/organizations/registrations', {
    organizationName: 'Riverside Arts',
    contactName: 'Ada Lovelace',
    email,
    password: PASSWORD,
    ...extra,
  });
}

async function passwordSession(
  email: string,
  password: string,
): Promise<{ status: number; body: string; session?: Session }> {
  const r = await post('/api/auth/password-sessions', { email, password });
  const raw = r.cookies.find((c) => c.name === '__Host-ers_org')?.value;
  if (!raw) return { status: r.statusCode, body: r.body };
  const cookie = `__Host-ers_org=${raw}`;
  const me = await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
  return {
    status: r.statusCode,
    body: r.body,
    session: { cookie, csrf: me.json().csrfToken, accountId: me.json().accountId },
  };
}

function linkFrom(email: string, subject: string, path: string): string {
  const mail = mailFor(h, email).find((m) => m.subject.startsWith(subject));
  if (!mail) throw new Error(`no "${subject}" email`);
  return linkToken(mail, path);
}

const link = (url: string, token: string, method: 'GET' | 'POST' = 'GET', payload?: unknown) =>
  h.app.inject({
    method,
    url,
    headers: { origin: ORIGIN, authorization: `Link ${token}` },
    ...(payload ? { payload: payload as object } : {}),
  });

async function org(email: string) {
  return h.db
    .selectFrom('app.organization_memberships as m')
    .innerJoin('app.accounts as a', 'a.id', 'm.account_id')
    .innerJoin('app.organizations as o', 'o.id', 'm.organization_id')
    .select([
      'o.name',
      'o.status',
      'o.description',
      'm.role',
      'a.display_name',
      'a.email_verified_at',
      'a.password_hash',
    ])
    .where('a.email', '=', email)
    .executeTakeFirst();
}

describe('password hashing (PD-89)', () => {
  it('stores Argon2id PHC strings with a fresh salt, and verifies in constant time', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b); // a different salt each time
    expect(await verifyPassword(a, PASSWORD)).toBe(true);
    expect(await verifyPassword(a, `${PASSWORD} `)).toBe(false);
    expect(await verifyPassword('not a hash', PASSWORD)).toBe(false);
  });
});

describe('organization registration and verification (K-709)', () => {
  it('creates a pending organization owned by a new account, with a hashed password and a verification link', async () => {
    const r = await registerOrg(EMAIL, { description: 'Community theatre' });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ status: 'check_your_email' });
    const row = await org(EMAIL);
    expect(row).toMatchObject({
      name: 'Riverside Arts',
      status: 'pending_verification',
      description: 'Community theatre',
      role: 'owner',
      display_name: 'Ada Lovelace',
      email_verified_at: null,
    });
    expect(row!.password_hash).toMatch(/^\$argon2id\$/);
    const account = await h.db
      .selectFrom('app.accounts')
      .selectAll()
      .where('email', '=', EMAIL)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(account)).not.toContain(PASSWORD);
    const audit = await h.db
      .selectFrom('app.audit_records')
      .selectAll()
      .where('action', '=', 'organization_registered')
      .execute();
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('@');

    await drain(h);
    const token = linkFrom(EMAIL, 'Confirm your email address', '/verify-account');
    const view = await link('/api/links/account-verification', token);
    expect(view.statusCode).toBe(200);
    expect(view.json()).toEqual({ maskedEmail: 'f***@e***.test', organizationName: 'Riverside Arts' });
    const confirm = await link('/api/links/account-verification/confirm', token, 'POST');
    expect(confirm.json()).toEqual({ state: 'awaiting_approval' });
    expect(await org(EMAIL)).toMatchObject({
      status: 'pending_approval',
      email_verified_at: expect.any(Date),
    });
    // Single use.
    const again = await link('/api/links/account-verification/confirm', token, 'POST');
    expect(again.statusCode).toBe(404);
    expect(again.body).toBe(GENERIC_INVALID_LINK_BODY);
  });

  it('answers the same for an address that already has an account, changes nothing and sends a notice without a link', async () => {
    await ensureOrganizer(h, EMAIL, 'an existing password!');
    const before = await h.db.selectFrom('app.organizations').select('id').execute();
    const r = await registerOrg();
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ status: 'check_your_email' });
    expect(await h.db.selectFrom('app.organizations').select('id').execute()).toHaveLength(before.length);
    await drain(h);
    const [notice] = mailFor(h, EMAIL);
    expect(notice!.subject).toBe('Your organizer account: Event Registration');
    expect(notice!.text).not.toMatch(/#t=/);
  });

  it('validates the form on the server', async () => {
    for (const extra of [
      { password: 'too short' },
      { organizationName: '' },
      { contactName: '  ' },
      { email: 'nope' },
      { role: 'admin' },
    ]) {
      const r = await registerOrg(EMAIL, extra);
      expect(r.statusCode).toBe(422);
    }
    expect(await org(EMAIL)).toBeUndefined();
  });
});

describe('password sign-in (K-709)', () => {
  it('gives one answer for an unknown address, a wrong password and an account without a password', async () => {
    await ensureOrganizer(h, 'withpassword@example.test', PASSWORD);
    await ensureOrganizer(h, 'nopassword@example.test');
    const answers = [
      await passwordSession('unknown@example.test', PASSWORD),
      await passwordSession('withpassword@example.test', 'wrong password!!'),
      await passwordSession('nopassword@example.test', PASSWORD),
    ];
    for (const a of answers) {
      expect(a.status).toBe(401);
      expect(JSON.parse(a.body).code).toBe('invalid_credentials');
    }
    const ok = await passwordSession('withpassword@example.test', PASSWORD);
    expect(ok.status).toBe(200);
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: ok.session!.cookie },
    });
    expect(me.json()).toMatchObject({
      hasPassword: true,
      organizations: [{ status: 'active', role: 'owner' }],
    });
  });

  it('tells only the holder of the right password that the address needs verification; a pending organization cannot manage events', async () => {
    await registerOrg();
    expect((await passwordSession(EMAIL, 'wrong password!!')).status).toBe(401);
    const unverified = await passwordSession(EMAIL, PASSWORD);
    expect(unverified.status).toBe(403);
    expect(JSON.parse(unverified.body).code).toBe('email_verification_required');

    await drain(h);
    await link(
      '/api/links/account-verification/confirm',
      linkFrom(EMAIL, 'Confirm your email address', '/verify-account'),
      'POST',
    );
    const signedIn = await passwordSession(EMAIL, PASSWORD);
    expect(signedIn.status).toBe(200);
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: signedIn.session!.cookie },
    });
    expect(me.json().organizations).toEqual([
      expect.objectContaining({ name: 'Riverside Arts', status: 'pending_approval', role: 'owner' }),
    ]);
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/events',
      headers: organizerHeaders(signedIn.session!),
      payload: {
        requestId: randomUUID(),
        title: 'Too early',
        description: null,
        localStart: localIn(96),
        timeZone: 'UTC',
        capacity: 5,
      },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json().code).toBe('organization_not_active');
  });

  it('is rate-limited per address', async () => {
    await ensureOrganizer(h, EMAIL, PASSWORD);
    for (let i = 0; i < 10; i += 1)
      expect((await passwordSession(EMAIL, 'wrong password!!')).status).toBe(401);
    const limited = await passwordSession(EMAIL, PASSWORD);
    expect(limited.status).toBe(429);
  });
});

describe('password reset (K-709)', () => {
  it('sets a new password once, verifies the address and signs out every session', async () => {
    await ensureOrganizer(h, EMAIL, PASSWORD);
    const old = (await passwordSession(EMAIL, PASSWORD)).session!;
    expect((await post('/api/auth/password-reset-requests', { email: EMAIL })).statusCode).toBe(202);
    await drain(h);
    const token = linkFrom(EMAIL, 'Set a new password', '/reset-password');
    expect((await link('/api/links/password-reset', token)).json()).toMatchObject({
      maskedEmail: 'f***@e***.test',
    });
    expect(
      (await link('/api/links/password-reset/confirm', token, 'POST', { password: 'short' })).statusCode,
    ).toBe(422);
    const done = await link('/api/links/password-reset/confirm', token, 'POST', {
      password: 'a brand new password',
    });
    expect(done.json()).toEqual({ state: 'password_changed' });

    expect(
      (await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: old.cookie } }))
        .statusCode,
    ).toBe(401);
    expect((await passwordSession(EMAIL, PASSWORD)).status).toBe(401);
    expect((await passwordSession(EMAIL, 'a brand new password')).status).toBe(200);
    expect(
      (await link('/api/links/password-reset/confirm', token, 'POST', { password: 'yet another password' }))
        .statusCode,
    ).toBe(404);
  });

  it('answers the same for an unknown address and sends nothing', async () => {
    const r = await post('/api/auth/password-reset-requests', { email: 'nobody@example.test' });
    expect(r.statusCode).toBe(202);
    await drain(h);
    expect(mailFor(h, 'nobody@example.test')).toHaveLength(0);
  });

  it('lets an organizer from before K-709 set a first password, after which the emailed link is no longer sent', async () => {
    await ensureOrganizer(h, EMAIL); // migrated organizer: no password
    expect((await post('/api/auth/sign-in-requests', { email: EMAIL })).statusCode).toBe(202);
    await drain(h);
    expect(mailFor(h, EMAIL).filter((m) => m.subject.startsWith('Your sign-in link'))).toHaveLength(1);

    await post('/api/auth/password-reset-requests', { email: EMAIL });
    await drain(h);
    await link(
      '/api/links/password-reset/confirm',
      linkFrom(EMAIL, 'Set a new password', '/reset-password'),
      'POST',
      {
        password: PASSWORD,
      },
    );
    await post('/api/auth/sign-in-requests', { email: EMAIL });
    await drain(h);
    expect(mailFor(h, EMAIL).filter((m) => m.subject.startsWith('Your sign-in link'))).toHaveLength(1); // no new one
    expect((await passwordSession(EMAIL, PASSWORD)).status).toBe(200);
  });
});

describe('emailed-link sign-in and re-authentication (K-709)', () => {
  it('no longer creates accounts: an unknown address gets nothing', async () => {
    const r = await post('/api/auth/sign-in-requests', { email: 'stranger@example.test' });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ status: 'check_your_email' });
    await drain(h);
    expect(mailFor(h, 'stranger@example.test')).toHaveLength(0);
    expect(
      await h.db
        .selectFrom('app.accounts')
        .select('id')
        .where('email', '=', 'stranger@example.test')
        .execute(),
    ).toHaveLength(0);
  });

  it('re-authenticates with the password, which makes a protected action possible again', async () => {
    await ensureOrganizer(h, EMAIL, PASSWORD);
    const s = (await passwordSession(EMAIL, PASSWORD)).session!;
    const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
    await h.owner
      .updateTable('app.organizer_sessions')
      .set({
        created_at: new Date(Date.now() - 20 * 60_000),
        authenticated_at: new Date(Date.now() - 20 * 60_000),
      })
      .where('account_id', '=', s.accountId)
      .execute(); // the sign-in is no longer recent (controlled setup)
    const cancel = () =>
      h.app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/cancellation`,
        headers: organizerHeaders(s),
        payload: { confirmed: true },
      });
    expect((await cancel()).json().code).toBe('reauthentication_required');
    const wrong = await h.app.inject({
      method: 'POST',
      url: '/api/auth/password-reauthentication',
      headers: organizerHeaders(s),
      payload: { password: 'not it at all!' },
    });
    expect(wrong.statusCode).toBe(401);
    const right = await h.app.inject({
      method: 'POST',
      url: '/api/auth/password-reauthentication',
      headers: organizerHeaders(s),
      payload: { password: PASSWORD },
    });
    expect(right.statusCode).toBe(204);
    expect((await cancel()).statusCode).toBe(200);
  });

  it('signs out', async () => {
    await ensureOrganizer(h, EMAIL, PASSWORD);
    const s = (await passwordSession(EMAIL, PASSWORD)).session!;
    expect(
      (await h.app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: organizerHeaders(s) }))
        .statusCode,
    ).toBe(204);
    expect(
      (await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: s.cookie } }))
        .statusCode,
    ).toBe(401);
  });
});
