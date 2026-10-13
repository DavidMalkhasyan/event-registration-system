import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  BootstrapError,
  createPlatformAdmin,
  disablePlatformAdmin,
} from '../src/modules/platform-admin/bootstrap.js';
import {
  ORIGIN,
  createEvent,
  createHarness,
  drain,
  ensureOrganizer,
  linkToken,
  mailFor,
  moveClockTo,
  organizerHeaders,
  resetData,
  signIn,
  type Harness,
} from './harness.js';

// K-710 (amendment A-3, ADR-022, PD-90): Super Admins are created only by the operator command, sign
// in to their own area, and approve, reject, suspend and reinstate organizations, with audit records
// and emails to the owners. They are not organizer accounts, and organizer sessions are not theirs.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const ADMIN = 'super@example.test';
const ADMIN_PASSWORD = 'a long admin passphrase';
const OWNER = 'founder@example.test';
const OWNER_PASSWORD = 'correct horse battery staple';

interface AdminSession {
  cookie: string;
  csrf: string;
}

async function adminSession(email = ADMIN, password = ADMIN_PASSWORD) {
  const r = await h.app.inject({
    method: 'POST',
    url: '/api/admin/sessions',
    headers: { origin: ORIGIN },
    payload: { email, password },
  });
  const raw = r.cookies.find((c) => c.name === '__Host-ers_admin');
  if (!raw) return { status: r.statusCode, body: r.body };
  expect(raw.sameSite).toBe('Strict');
  expect(raw.httpOnly).toBe(true);
  const cookie = `__Host-ers_admin=${raw.value}`;
  const me = await h.app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie } });
  return {
    status: r.statusCode,
    body: r.body,
    session: { cookie, csrf: me.json().csrfToken } as AdminSession,
  };
}

async function signedInAdmin(): Promise<AdminSession> {
  await createPlatformAdmin(h.owner, { email: ADMIN, name: 'Grace Hopper', password: ADMIN_PASSWORD });
  return (await adminSession()).session!;
}

const decide = (s: AdminSession, id: string, payload: unknown, csrf = s.csrf) =>
  h.app.inject({
    method: 'POST',
    url: `/api/admin/organizations/${id}/decisions`,
    headers: { origin: ORIGIN, cookie: s.cookie, 'x-csrf-token': csrf },
    payload: payload as object,
  });

const list = (s: AdminSession, status?: string) =>
  h.app.inject({
    method: 'GET',
    url: `/api/admin/organizations${status ? `?status=${status}` : ''}`,
    headers: { cookie: s.cookie },
  });

/** A registered organization whose owner confirmed the address: it waits for approval. */
async function pendingOrganization(email = OWNER, name = 'Riverside Arts'): Promise<string> {
  const r = await h.app.inject({
    method: 'POST',
    url: '/api/organizations/registrations',
    headers: { origin: ORIGIN },
    payload: { organizationName: name, contactName: 'Ada Lovelace', email, password: OWNER_PASSWORD },
  });
  expect(r.statusCode).toBe(202);
  await drain(h);
  const token = linkToken(
    mailFor(h, email).find((m) => m.subject.startsWith('Confirm your email address'))!,
    '/verify-account',
  );
  const confirmed = await h.app.inject({
    method: 'POST',
    url: '/api/links/account-verification/confirm',
    headers: { origin: ORIGIN, authorization: `Link ${token}` },
  });
  expect(confirmed.statusCode).toBe(200);
  const org = await h.db
    .selectFrom('app.organizations as o')
    .innerJoin('app.organization_memberships as m', 'm.organization_id', 'o.id')
    .innerJoin('app.accounts as a', 'a.id', 'm.account_id')
    .select(['o.id', 'o.status'])
    .where('a.email', '=', email)
    .executeTakeFirstOrThrow();
  expect(org.status).toBe('pending_approval');
  return org.id;
}

async function ownerSession(email = OWNER) {
  const r = await h.app.inject({
    method: 'POST',
    url: '/api/auth/password-sessions',
    headers: { origin: ORIGIN },
    payload: { email, password: OWNER_PASSWORD },
  });
  const raw = r.cookies.find((c) => c.name === '__Host-ers_org')!.value;
  const cookie = `__Host-ers_org=${raw}`;
  const me = await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
  return { cookie, csrf: me.json().csrfToken as string, accountId: me.json().accountId as string };
}

describe('the operator command (bootstrap)', () => {
  it('creates a Super Admin with an Argon2id hash, refuses duplicates and weak passwords, and grants nothing to organizer accounts', async () => {
    const organizerId = await ensureOrganizer(h, ADMIN); // the same address as an organizer
    const admin = await createPlatformAdmin(h.owner, {
      email: ' Super@Example.test ',
      name: 'Grace Hopper',
      password: ADMIN_PASSWORD,
    });
    expect(admin.email).toBe(ADMIN);
    const row = await h.db
      .selectFrom('app.platform_admins')
      .selectAll()
      .where('id', '=', admin.id)
      .executeTakeFirstOrThrow();
    expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(row.password_hash).not.toContain(ADMIN_PASSWORD);

    await expect(
      createPlatformAdmin(h.owner, { email: ADMIN, name: 'Someone else', password: 'another long password' }),
    ).rejects.toThrow(BootstrapError);
    await expect(
      createPlatformAdmin(h.owner, { email: 'b@example.test', name: 'B', password: 'short' }),
    ).rejects.toThrow(BootstrapError);
    expect(await h.db.selectFrom('app.platform_admins').select('email').execute()).toEqual([
      { email: ADMIN },
    ]); // unchanged by the refused attempts

    // The organizer account with the same address is still only an organizer.
    const organizer = await signIn(h, ADMIN);
    expect(organizer.accountId).toBe(organizerId);
    const asAdmin = await h.app.inject({
      method: 'GET',
      url: '/api/admin/organizations',
      headers: { cookie: organizer.cookie },
    });
    expect(asAdmin.statusCode).toBe(401);
    const audit = await h.db
      .selectFrom('app.audit_records')
      .select(['action', 'actor_kind', 'subject_id'])
      .where('action', '=', 'platform_admin_created')
      .execute();
    expect(audit).toEqual([{ action: 'platform_admin_created', actor_kind: 'system', subject_id: admin.id }]);
  });

  it('has no HTTP route that creates a Super Admin or grants the role', async () => {
    for (const url of ['/api/admin/admins', '/api/admin/platform-admins', '/api/admin/bootstrap'])
      expect(
        (await h.app.inject({ method: 'POST', url, headers: { origin: ORIGIN }, payload: { email: ADMIN } }))
          .statusCode,
      ).toBe(404);
    expect(await h.db.selectFrom('app.platform_admins').select('id').execute()).toEqual([]);
  });
});

describe('Super Admin sign-in and sessions', () => {
  it('gives one answer for an unknown address, a wrong password and a disabled admin', async () => {
    await createPlatformAdmin(h.owner, { email: ADMIN, name: 'Grace Hopper', password: ADMIN_PASSWORD });
    const wrong = await adminSession(ADMIN, 'not the password at all');
    const unknown = await adminSession('nobody@example.test', ADMIN_PASSWORD);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(JSON.parse(wrong.body).code).toBe('invalid_credentials');
    expect(JSON.parse(unknown.body).code).toBe('invalid_credentials');

    const ok = await adminSession();
    expect(ok.status).toBe(200);
    await disablePlatformAdmin(h.owner, ADMIN);
    // Disabling ends the existing session and refuses new ones.
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/admin/session',
      headers: { cookie: ok.session!.cookie },
    });
    expect(me.statusCode).toBe(401);
    const again = await adminSession();
    expect(again.status).toBe(401);
    expect(JSON.parse(again.body).code).toBe('invalid_credentials');
  });

  it('is rate-limited per address', async () => {
    await createPlatformAdmin(h.owner, { email: ADMIN, name: 'Grace Hopper', password: ADMIN_PASSWORD });
    for (let i = 0; i < 5; i += 1)
      expect((await adminSession(ADMIN, 'wrong password ' + i)).status).toBe(401);
    expect((await adminSession()).status).toBe(429);
  });

  it('keeps admin and organizer sessions apart, needs the admin CSRF token, and expires when idle', async () => {
    const admin = await signedInAdmin();
    const id = await pendingOrganization();
    // An admin session is not an organizer session.
    expect(
      (await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: admin.cookie } }))
        .statusCode,
    ).toBe(401);
    // An organizer's CSRF token, or none, does not work for admin decisions.
    const organizer = await ownerSession();
    expect((await decide(admin, id, { decision: 'approve' }, organizer.csrf)).statusCode).toBe(403);
    expect((await decide(admin, id, { decision: 'approve' }, '')).statusCode).toBe(403);
    // Cross-origin state changes are refused before anything else.
    const crossOrigin = await h.app.inject({
      method: 'POST',
      url: `/api/admin/organizations/${id}/decisions`,
      headers: { origin: 'https://evil.example', cookie: admin.cookie, 'x-csrf-token': admin.csrf },
      payload: { decision: 'approve' },
    });
    expect(crossOrigin.statusCode).toBe(403);
    expect((await list(admin, 'pending_approval')).json().organizations[0].status).toBe('pending_approval');

    moveClockTo(new Date(Date.now() + 2 * 3_600_000 + 1_000)); // idle for over 2 hours
    expect((await list(admin)).statusCode).toBe(401);
  });

  it('signs out', async () => {
    const admin = await signedInAdmin();
    const out = await h.app.inject({
      method: 'POST',
      url: '/api/admin/sign-out',
      headers: { origin: ORIGIN, cookie: admin.cookie, 'x-csrf-token': admin.csrf },
    });
    expect(out.statusCode).toBe(204);
    expect((await list(admin)).statusCode).toBe(401);
  });
});

describe('decisions on organizations', () => {
  it('approves a pending organization: its owner is emailed and can create events', async () => {
    const admin = await signedInAdmin();
    const id = await pendingOrganization();
    const owner = await ownerSession();
    await expect(createEvent(h, owner, { capacity: 5, startsInHours: 48 })).rejects.toThrow(
      /403 .*organization_not_active/,
    );

    const pending = (await list(admin, 'pending_approval')).json();
    expect(pending.counts.pending_approval).toBe(1);
    expect(pending.organizations).toMatchObject([
      {
        id,
        name: 'Riverside Arts',
        status: 'pending_approval',
        memberCount: 1,
        eventCount: 0,
        owners: [{ email: OWNER, name: 'Ada Lovelace', emailVerified: true }],
      },
    ]);

    const approved = await decide(admin, id, { decision: 'approve' });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toEqual({ status: 'active' });
    await drain(h);
    const mail = mailFor(h, OWNER).find((m) => m.subject.startsWith('Your organization was approved'));
    expect(mail?.text).toContain('"Riverside Arts" is approved');
    await createEvent(h, owner, { capacity: 5, startsInHours: 48 });

    const audit = (
      await h.app.inject({
        method: 'GET',
        url: `/api/admin/organizations/${id}/audit`,
        headers: { cookie: admin.cookie },
      })
    ).json().records;
    expect(audit.map((r: { action: string }) => r.action)).toEqual([
      'organization_approve',
      'organization_registered',
    ]);
    expect(audit[0]).toMatchObject({
      actorKind: 'platform_admin',
      adminName: 'Grace Hopper',
      outcome: 'active',
    });
  });

  it('rejects only with a reason, which reaches the owner; a rejected organization stays without access', async () => {
    const admin = await signedInAdmin();
    const id = await pendingOrganization();
    expect((await decide(admin, id, { decision: 'reject' })).statusCode).toBe(422);
    expect((await decide(admin, id, { decision: 'reject', reason: '  ' })).statusCode).toBe(422);
    const rejected = await decide(admin, id, {
      decision: 'reject',
      reason: 'We could not verify the organization.',
    });
    expect(rejected.json()).toEqual({ status: 'rejected' });
    await drain(h);
    const mail = mailFor(h, OWNER).find((m) => m.subject.startsWith('Your organization was not approved'));
    expect(mail?.text).toContain('Reason given: We could not verify the organization.');
    expect((await decide(admin, id, { decision: 'approve' })).statusCode).toBe(409);
    const row = await h.db
      .selectFrom('app.organizations')
      .select(['status', 'decision_reason', 'decided_by_admin_id'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('rejected');
    expect(row.decision_reason).toBe('We could not verify the organization.');
    expect(row.decided_by_admin_id).not.toBeNull();
  });

  it('suspends an active organization: organizers lose access, public pages and registration stay; reinstating restores access', async () => {
    const admin = await signedInAdmin();
    const id = await pendingOrganization();
    await decide(admin, id, { decision: 'approve' });
    const owner = await ownerSession();
    const event = await createEvent(h, owner, { capacity: 5, startsInHours: 48 });

    expect((await decide(admin, id, { decision: 'suspend' })).statusCode).toBe(422); // reason required
    expect((await decide(admin, id, { decision: 'suspend', reason: 'Reported for spam.' })).json()).toEqual({
      status: 'suspended',
    });
    // Its events disappear from the organizer's reads (as unknown ones, PD-88), and changes are refused.
    const read = await h.app.inject({
      method: 'GET',
      url: `/api/events/${event.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(read.statusCode).toBe(404);
    const change = await h.app.inject({
      method: 'PUT',
      url: `/api/events/${event.id}/capacity`,
      headers: organizerHeaders(owner),
      payload: { capacity: 6 },
    });
    expect(change.statusCode).toBe(403);
    expect(change.json().code).toBe('organization_not_active');
    await expect(createEvent(h, owner, { capacity: 5, startsInHours: 48 })).rejects.toThrow(/403/);
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/public/events/${event.publicId}` })).statusCode,
    ).toBe(200);

    expect((await decide(admin, id, { decision: 'reinstate' })).json()).toEqual({ status: 'active' });
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: `/api/events/${event.id}`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);
    await drain(h);
    const subjects = mailFor(h, OWNER).map((m) => m.subject);
    expect(subjects).toEqual(
      expect.arrayContaining([
        'Your organization was approved: Event Registration',
        'Your organization was suspended: Event Registration',
        'Your organization was reinstated: Event Registration',
      ]),
    );
  });

  it('refuses decisions that do not fit the state, and lets only one of two simultaneous decisions win', async () => {
    const admin = await signedInAdmin();
    const id = await pendingOrganization();
    expect((await decide(admin, id, { decision: 'suspend', reason: 'x' })).statusCode).toBe(409);
    expect((await decide(admin, id, { decision: 'reinstate' })).statusCode).toBe(409);
    expect(
      (await decide(admin, '00000000-0000-7000-8000-000000000000', { decision: 'approve' })).statusCode,
    ).toBe(404);
    expect((await decide(admin, 'not-a-uuid', { decision: 'approve' })).statusCode).toBe(404);

    // Both decisions are made while another transaction holds the organization row, so they really
    // overlap: each has read its state before either can write.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const blocker = h.owner.transaction().execute(async (trx) => {
      await trx.selectFrom('app.organizations').select('id').where('id', '=', id).forUpdate().execute();
      locked();
      await held;
    });
    await isLocked;
    const decisionsInFlight = Promise.all([
      decide(admin, id, { decision: 'approve' }),
      decide(admin, id, { decision: 'reject', reason: 'Duplicate registration.' }),
    ]);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await blocker;
    const [a, b] = await decisionsInFlight;
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const decisions = await h.db
      .selectFrom('app.audit_records')
      .select('action')
      .where('subject_id', '=', id)
      .where('actor_kind', '=', 'platform_admin')
      .execute();
    expect(decisions).toHaveLength(1);
  });
});
