import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR } from '../src/platform/migrations.js';
import {
  createEvent,
  createHarness,
  localIn,
  organizerHeaders,
  register,
  registerConfirmed,
  resetData,
  signIn,
  type Harness,
  type Session,
} from './harness.js';

// K-708 (amendment A-3, PD-88): events belong to organizations; access is by membership of an active
// organization; existing organizers and events are migrated by migration 0009's backfill.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const BACKFILL = (() => {
  const text = readFileSync(join(MIGRATIONS_DIR, '0009_organizations.sql'), 'utf8');
  const start = text.indexOf('-- BEGIN BACKFILL');
  const end = text.indexOf('-- END BACKFILL');
  if (start < 0 || end < 0) throw new Error('backfill markers not found');
  return text.slice(text.indexOf('\n', start) + 1, end);
})();

async function orgOf(accountEmail: string) {
  return h.db
    .selectFrom('app.organization_memberships as m')
    .innerJoin('app.accounts as a', 'a.id', 'm.account_id')
    .innerJoin('app.organizations as o', 'o.id', 'm.organization_id')
    .select(['o.id', 'o.name', 'o.status', 'm.role'])
    .where('a.email', '=', accountEmail)
    .execute();
}

function setCapacity(s: Session, eventId: string, capacity: number) {
  return h.app.inject({
    method: 'PUT',
    url: `/api/events/${eventId}/capacity`,
    headers: organizerHeaders(s),
    payload: { capacity },
  });
}

function getEvent(s: Session, eventId: string) {
  return h.app.inject({ method: 'GET', url: `/api/events/${eventId}`, headers: organizerHeaders(s) });
}

async function listIds(s: Session): Promise<string[]> {
  const r = await h.app.inject({ method: 'GET', url: '/api/events', headers: organizerHeaders(s) });
  return (r.json().items as { id: string }[]).map((e) => e.id).sort();
}

describe('migration 0009 backfill (K-708)', () => {
  it('gives every existing organizer one active organization as its owner and moves its events, idempotently', async () => {
    const outcome = await h.owner
      .transaction()
      .execute(async (trx) => {
        // Legacy state, as before 0009: accounts and events without an organization.
        await sql`ALTER TABLE app.events ALTER COLUMN organization_id DROP NOT NULL`.execute(trx);
        const accounts = await sql<{ id: string; email: string }>`
          INSERT INTO app.accounts (email, created_at) VALUES
            ('legacy.one@example.test', now() - interval '3 days'),
            ('legacy.two@example.test', now() - interval '2 days')
          RETURNING id, email`.execute(trx);
        const [one, two] = accounts.rows;
        for (const [owner, title] of [
          [one!, 'Legacy A'],
          [one!, 'Legacy B'],
          [two!, 'Legacy C'],
        ] as const) {
          await sql`INSERT INTO app.events (owner_account_id, creation_request_id, creation_fingerprint, public_id,
              title, starts_at, time_zone, capacity, created_at, updated_at)
            VALUES (${owner.id}, ${randomUUID()}, ${randomBytes(32)}, ${randomBytes(16).toString('base64url')},
              ${title}, now() + interval '30 days', 'UTC', 10, now(), now())`.execute(trx);
        }
        await sql.raw(BACKFILL).execute(trx);
        await sql.raw(BACKFILL).execute(trx); // a second run changes nothing
        const orgs = await sql<{
          name: string;
          status: string;
          owner: string;
          events: number;
          members: number;
        }>`
          SELECT o.name, o.status, a.email AS owner,
            (SELECT count(*)::int FROM app.events e WHERE e.organization_id = o.id) AS events,
            (SELECT count(*)::int FROM app.organization_memberships m2 WHERE m2.organization_id = o.id) AS members
          FROM app.organizations o
          JOIN app.organization_memberships m ON m.organization_id = o.id AND m.role = 'owner'
          JOIN app.accounts a ON a.id = m.account_id
          ORDER BY o.name`.execute(trx);
        const orphans = await sql<{ n: number }>`
          SELECT count(*)::int AS n FROM app.events WHERE organization_id IS NULL`.execute(trx);
        throw Object.assign(new Error('rollback'), {
          result: { orgs: orgs.rows, orphans: orphans.rows[0]!.n },
        });
      })
      .catch((e: { result?: unknown }) => e.result);
    expect(outcome).toEqual({
      orgs: [
        {
          name: 'legacy.one@example.test',
          status: 'active',
          owner: 'legacy.one@example.test',
          events: 2,
          members: 1,
        },
        {
          name: 'legacy.two@example.test',
          status: 'active',
          owner: 'legacy.two@example.test',
          events: 1,
          members: 1,
        },
      ],
      orphans: 0,
    });
    // Rolled back: the test database still requires an organization for every event.
    const nullable = await sql<{ is_nullable: string }>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'app' AND table_name = 'events' AND column_name = 'organization_id'`.execute(h.db);
    expect(nullable.rows[0]!.is_nullable).toBe('NO');
  });
});

describe('organization access (K-708)', () => {
  it('keeps organizations apart: another organization’s event is unknown to them', async () => {
    const a = await signIn(h, 'a@example.test');
    const b = await signIn(h, 'b@example.test');
    const event = await createEvent(h, a, { capacity: 2, startsInHours: 72 });
    await registerConfirmed(h, event.publicId, 'guest@example.test');
    const regId = (
      await h.db
        .selectFrom('app.registrations')
        .select('id')
        .where('email', '=', 'guest@example.test')
        .executeTakeFirstOrThrow()
    ).id;

    expect(await listIds(b)).toEqual([]);
    expect((await getEvent(b, event.id)).statusCode).toBe(404);
    expect((await setCapacity(b, event.id, 3)).statusCode).toBe(404);
    for (const url of [
      `/api/events/${event.id}/participants`,
      `/api/events/${event.id}/dashboard`,
      `/api/events/${event.id}/staff`,
      `/api/events/${event.id}/check-in-count`,
    ])
      expect((await h.app.inject({ method: 'GET', url, headers: organizerHeaders(b) })).statusCode).toBe(404);
    const cancel = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/registrations/${regId}/organizer-cancellation`,
      headers: organizerHeaders(b),
      payload: { confirmed: true },
    });
    expect(cancel.statusCode).toBe(404);
    expect(await listIds(a)).toEqual([event.id]);
  });

  it('lets several organizers of one organization manage its events, and asks which organization for a new event', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const event = await createEvent(h, owner, { capacity: 2, startsInHours: 72 });
    const [ownerOrg] = await orgOf('owner@example.test');
    expect(ownerOrg).toMatchObject({ status: 'active', role: 'owner' });

    // A second organizer, added as a member (the invitation flow follows in K-709).
    const colleague = await signIn(h, 'colleague@example.test');
    const colleagueId = (
      await h.db
        .selectFrom('app.accounts')
        .select('id')
        .where('email', '=', 'colleague@example.test')
        .executeTakeFirstOrThrow()
    ).id;
    await h.owner
      .insertInto('app.organization_memberships')
      .values({
        organization_id: ownerOrg!.id,
        account_id: colleagueId,
        role: 'member',
        created_at: new Date(),
      })
      .execute();

    expect(await listIds(colleague)).toEqual([event.id]);
    expect((await setCapacity(colleague, event.id, 3)).statusCode).toBe(200);
    const session = await h.app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: organizerHeaders(colleague),
    });
    expect((session.json().organizations as { role: string }[]).map((o) => o.role).sort()).toEqual([
      'member',
      'owner',
    ]);

    // Two active organizations: a new event needs the organization.
    const create = (organizationId?: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/events',
        headers: organizerHeaders(colleague),
        payload: {
          requestId: randomUUID(),
          title: 'Team event',
          description: null,
          localStart: localIn(96),
          timeZone: 'UTC',
          capacity: 5,
          ...(organizationId ? { organizationId } : {}),
        },
      });
    const ambiguous = await create();
    expect(ambiguous.statusCode).toBe(422);
    expect(ambiguous.json().code).toBe('organization_required');
    const created = await create(ownerOrg!.id);
    expect(created.statusCode).toBe(201);
    const row = await h.db
      .selectFrom('app.events')
      .select(['organization_id', 'owner_account_id'])
      .where('id', '=', created.json().event.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ organization_id: ownerOrg!.id, owner_account_id: colleagueId });
    // The owner sees the colleague's event too; another organization does not.
    expect((await listIds(owner)).length).toBe(2);
  });

  it('stops organizer access while the organization is not active; participants are unaffected', async () => {
    const s = await signIn(h, 'org@example.test');
    const event = await createEvent(h, s, { capacity: 2, startsInHours: 72 });
    const [org] = await orgOf('org@example.test');
    for (const status of ['suspended', 'pending_approval'] as const) {
      await h.owner.updateTable('app.organizations').set({ status }).where('id', '=', org!.id).execute();
      const refused = await setCapacity(s, event.id, 3);
      expect(refused.statusCode).toBe(403);
      expect(refused.json().code).toBe('organization_not_active');
      expect(await listIds(s)).toEqual([]);
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/events',
        headers: organizerHeaders(s),
        payload: {
          requestId: randomUUID(),
          title: 'x',
          description: null,
          localStart: localIn(96),
          timeZone: 'UTC',
          capacity: 1,
        },
      });
      expect(created.statusCode).toBe(403);
    }
    // The public page and registration keep working (assumption in POST_RELEASE_PLAN.md).
    expect(
      (await h.app.inject({ method: 'GET', url: `/api/public/events/${event.publicId}` })).statusCode,
    ).toBe(200);
    expect((await register(h, event.publicId, 'guest@example.test')).statusCode).toBe(202);
    await h.owner
      .updateTable('app.organizations')
      .set({ status: 'active' })
      .where('id', '=', org!.id)
      .execute();
    expect((await setCapacity(s, event.id, 3)).statusCode).toBe(200);
  });
});
