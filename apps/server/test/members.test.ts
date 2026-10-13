import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  type Session,
} from './harness.js';

// K-716 (amendment A-3, PD-94): several organizers per organization: invitations by email accepted by
// the verified account of that address, roles (owner, admin, member), removal and leaving, and at least
// one owner at all times.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const PASSWORD = 'correct horse battery staple';

async function orgOf(email: string): Promise<string> {
  const row = await h.db
    .selectFrom('app.organization_memberships as m')
    .innerJoin('app.accounts as a', 'a.id', 'm.account_id')
    .select('m.organization_id')
    .where('a.email', '=', email)
    .where('m.role', '=', 'owner')
    .executeTakeFirstOrThrow();
  return row.organization_id;
}

const post = (s: Session | null, url: string, payload?: unknown) =>
  h.app.inject({
    method: 'POST',
    url,
    headers: s ? organizerHeaders(s) : { origin: ORIGIN },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const call = (s: Session, method: 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  h.app.inject({
    method,
    url,
    headers: organizerHeaders(s),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
const session = async (s: Session) =>
  (await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: s.cookie } })).json();

/** A person who creates an account at /organizer/join, confirms the address and signs in with a password. */
async function joinAndSignIn(email: string): Promise<Session> {
  expect(
    (await post(null, '/api/accounts/registrations', { contactName: 'Grace', email, password: PASSWORD }))
      .statusCode,
  ).toBe(202);
  await drain(h);
  const token = linkToken(
    mailFor(h, email).find((m) => m.subject.startsWith('Confirm your email'))!,
    '/verify-account',
  );
  const confirmed = await h.app.inject({
    method: 'POST',
    url: '/api/links/account-verification/confirm',
    headers: { origin: ORIGIN, authorization: `Link ${token}` },
  });
  expect(confirmed.statusCode).toBe(200);
  const r = await post(null, '/api/auth/password-sessions', { email, password: PASSWORD });
  expect(r.statusCode).toBe(200);
  const cookie = `__Host-ers_org=${r.cookies.find((c) => c.name === '__Host-ers_org')!.value}`;
  const me = await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
  return { cookie, csrf: me.json().csrfToken, accountId: me.json().accountId };
}

describe('invitations', () => {
  it('lets an invited person create an account, accept, and work on the organization’s events', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const org = await orgOf('owner@example.test');
    const event = await createEvent(h, owner, { capacity: 5, startsInHours: 48, title: 'Shared event' });

    const invited = await post(owner, `/api/organizations/${org}/invitations`, {
      email: 'Grace@Example.test',
      role: 'admin',
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toMatchObject({ email: 'grace@example.test', role: 'admin' });
    await drain(h);
    const [mail] = mailFor(h, 'grace@example.test');
    expect(mail!.subject).toBe('You are invited to join owner@example.test: Event Registration');
    expect(mail!.text).toContain('/organizer/join');
    expect(mail!.text).not.toMatch(/#t=/); // the email itself grants nothing
    // No account was created by the invitation.
    expect(
      await h.db.selectFrom('app.accounts').select('id').where('email', '=', 'grace@example.test').execute(),
    ).toEqual([]);

    const grace = await joinAndSignIn('grace@example.test');
    const before = await session(grace);
    expect(before.organizations).toEqual([]);
    expect(before.invitations).toMatchObject([{ organizationName: 'owner@example.test', role: 'admin' }]);
    expect((await post(grace, `/api/invitations/${before.invitations[0].id}/accept`)).statusCode).toBe(204);
    const after = await session(grace);
    expect(after.invitations).toEqual([]);
    expect(after.organizations).toMatchObject([{ organizationId: org, role: 'admin', status: 'active' }]);
    const list = await h.app.inject({ method: 'GET', url: '/api/events', headers: { cookie: grace.cookie } });
    expect(list.json().items.map((e: { id: string }) => e.id)).toEqual([event.id]);

    const members = (
      await h.app.inject({
        method: 'GET',
        url: `/api/organizations/${org}/members`,
        headers: { cookie: owner.cookie },
      })
    ).json();
    expect(members.members.map((m: { email: string; role: string }) => [m.email, m.role])).toEqual([
      ['owner@example.test', 'owner'],
      ['grace@example.test', 'admin'],
    ]);
  });

  it('is accepted only by the verified account of the invited address, once, before it expires', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const org = await orgOf('owner@example.test');
    const intruder = await signIn(h, 'intruder@example.test');
    await post(owner, `/api/organizations/${org}/invitations`, {
      email: 'grace@example.test',
      role: 'member',
    });
    const id = (await h.db.selectFrom('app.organization_invitations').select('id').executeTakeFirstOrThrow())
      .id;
    expect((await post(intruder, `/api/invitations/${id}/accept`)).statusCode).toBe(404);
    expect((await session(intruder)).invitations).toEqual([]);

    // A repeated invitation replaces the pending one; a revoked one cannot be accepted.
    await post(owner, `/api/organizations/${org}/invitations`, {
      email: 'grace@example.test',
      role: 'admin',
    });
    const pending = await h.db
      .selectFrom('app.organization_invitations')
      .select(['id', 'status', 'role'])
      .orderBy('created_at')
      .execute();
    expect(pending.map((p) => [p.status, p.role])).toEqual([
      ['revoked', 'member'],
      ['pending', 'admin'],
    ]);
    const grace = await joinAndSignIn('grace@example.test');
    expect((await post(grace, `/api/invitations/${id}/accept`)).statusCode).toBe(404);
    const current = pending[1]!.id;
    expect((await post(grace, `/api/invitations/${current}/decline`)).statusCode).toBe(204);
    expect((await post(grace, `/api/invitations/${current}/accept`)).statusCode).toBe(404);
    expect((await session(grace)).organizations).toEqual([]);

    // Expired after 14 days.
    await post(owner, `/api/organizations/${org}/invitations`, {
      email: 'grace@example.test',
      role: 'member',
    });
    moveClockTo(new Date(Date.now() + 15 * 86_400_000));
    const r = await post(null, '/api/auth/password-sessions', {
      email: 'grace@example.test',
      password: PASSWORD,
    });
    const cookie = `__Host-ers_org=${r.cookies.find((c) => c.name === '__Host-ers_org')!.value}`;
    const late = (
      await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })
    ).json();
    expect(late.invitations).toEqual([]);
  });

  it('refuses inviting a member again, and lists invitations only to owners and admins', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const org = await orgOf('owner@example.test');
    const again = await post(owner, `/api/organizations/${org}/invitations`, {
      email: 'owner@example.test',
      role: 'member',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('already_member');
    const outsider = await signIn(h, 'outsider@example.test');
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: `/api/organizations/${org}/members`,
          headers: { cookie: outsider.cookie },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await post(outsider, `/api/organizations/${org}/invitations`, {
          email: 'x@example.test',
          role: 'member',
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('roles', () => {
  async function team() {
    const owner = await signIn(h, 'owner@example.test');
    const org = await orgOf('owner@example.test');
    const people: Record<string, Session> = {};
    for (const [name, role] of [
      ['admin', 'admin'],
      ['member', 'member'],
    ] as const) {
      await post(owner, `/api/organizations/${org}/invitations`, { email: `${name}@example.test`, role });
      people[name] = await joinAndSignIn(`${name}@example.test`);
      const inv = (await session(people[name]!)).invitations[0];
      await post(people[name]!, `/api/invitations/${inv.id}/accept`);
    }
    return { owner, org, admin: people.admin!, member: people.member! };
  }

  it('lets members organize events but not people; admins manage members but not owners', async () => {
    const { owner, org, admin, member } = await team();
    const event = await createEvent(h, member, { capacity: 3, startsInHours: 30, title: 'By a member' });
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: `/api/events/${event.id}`,
          headers: { cookie: owner.cookie },
        })
      ).statusCode,
    ).toBe(200);

    expect(
      (
        await post(member, `/api/organizations/${org}/invitations`, {
          email: 'x@example.test',
          role: 'member',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(member, 'PATCH', `/api/organizations/${org}/members/${admin.accountId}`, {
          role: 'member',
        })
      ).statusCode,
    ).toBe(403);
    const memberView = (
      await h.app.inject({
        method: 'GET',
        url: `/api/organizations/${org}/members`,
        headers: { cookie: member.cookie },
      })
    ).json();
    expect(memberView.yourRole).toBe('member');

    expect(
      (await call(admin, 'PATCH', `/api/organizations/${org}/members/${member.accountId}`, { role: 'admin' }))
        .statusCode,
    ).toBe(204);
    expect(
      (await call(admin, 'PATCH', `/api/organizations/${org}/members/${member.accountId}`, { role: 'owner' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(admin, 'PATCH', `/api/organizations/${org}/members/${owner.accountId}`, { role: 'member' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(admin, 'DELETE', `/api/organizations/${org}/members/${owner.accountId}`)).statusCode,
    ).toBe(403);

    // Removal takes effect at once: the removed organizer's next request finds nothing.
    expect(
      (await call(owner, 'DELETE', `/api/organizations/${org}/members/${member.accountId}`)).statusCode,
    ).toBe(204);
    expect(
      (
        await h.app.inject({
          method: 'GET',
          url: `/api/events/${event.id}`,
          headers: { cookie: member.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('keeps at least one owner; a second owner makes leaving possible', async () => {
    const { owner, org, admin } = await team();
    const leave = await call(owner, 'DELETE', `/api/organizations/${org}/members/${owner.accountId}`);
    expect(leave.statusCode).toBe(409);
    expect(leave.json().code).toBe('last_owner');
    expect(
      (
        await call(owner, 'PATCH', `/api/organizations/${org}/members/${owner.accountId}`, { role: 'admin' })
      ).json().code,
    ).toBe('last_owner');
    expect(
      (await call(owner, 'PATCH', `/api/organizations/${org}/members/${admin.accountId}`, { role: 'owner' }))
        .statusCode,
    ).toBe(204);
    expect(
      (await call(owner, 'DELETE', `/api/organizations/${org}/members/${owner.accountId}`)).statusCode,
    ).toBe(204);
    expect((await session(owner)).organizations).toEqual([]);
  });

  it('cannot lose its last owner when two owners demote each other at the same time', async () => {
    const { owner, org, admin } = await team();
    await call(owner, 'PATCH', `/api/organizations/${org}/members/${admin.accountId}`, { role: 'owner' });
    // Another transaction holds the two membership rows, so each change has read the owners before
    // either can write: only the organization lock taken first by every membership change keeps them
    // apart (without it, both demotions succeed and nobody owns the organization).
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const blocker = h.owner.transaction().execute(async (trx) => {
      await trx
        .selectFrom('app.organization_memberships')
        .select('account_id')
        .where('organization_id', '=', org)
        .forUpdate()
        .execute();
      locked();
      await held;
    });
    await isLocked;
    const both = Promise.all([
      call(owner, 'PATCH', `/api/organizations/${org}/members/${admin.accountId}`, { role: 'member' }),
      call(admin, 'PATCH', `/api/organizations/${org}/members/${owner.accountId}`, { role: 'member' }),
    ]);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await blocker;
    // The first change wins; the second caller is no longer an owner by then (403), so the organization
    // keeps exactly one owner.
    const results = (await both).map((r) => r.statusCode).sort();
    expect(results).toEqual([204, 403]);
    const owners = await h.db
      .selectFrom('app.organization_memberships')
      .select('account_id')
      .where('organization_id', '=', org)
      .where('role', '=', 'owner')
      .execute();
    expect(owners).toHaveLength(1);
  });

  it('works only in an active organization', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const org = await orgOf('owner@example.test');
    await h.owner
      .updateTable('app.organizations')
      .set({ status: 'suspended' })
      .where('id', '=', org)
      .execute();
    const r = await post(owner, `/api/organizations/${org}/invitations`, {
      email: 'x@example.test',
      role: 'member',
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('organization_not_active');
    await ensureOrganizer(h, 'unused@example.test');
  });
});
