import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { sql } from 'kysely';
import { buildWebApp } from '../src/composition/web-app.js';
import { runDueTasks } from '../src/modules/jobs/tasks.js';
import { Dispatcher } from '../src/modules/messaging/dispatcher.js';
import { FakeEmailProvider, readMailbox, type MailboxEntry } from '../src/modules/messaging/fake-provider.js';
import { parseConfig, type Config } from '../src/platform/config.js';
import { createDatabase, type Database } from '../src/platform/db.js';
import { setTestClockOffset } from '../src/platform/tx.js';
import { loadTestEnv } from './env.js';
import { hashPassword } from '../src/platform/passwords.js';

export const ORIGIN = 'http://localhost:5173';

export interface Harness {
  app: FastifyInstance;
  db: Database;
  owner: Database;
  config: Config;
  mailboxDir: string;
  dispatcher: Dispatcher;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  loadTestEnv();
  const mailboxDir = mkdtempSync(join(tmpdir(), 'ers-mailbox-'));
  const secret = () => randomBytes(32).toString('base64url');
  const config = parseConfig({
    NODE_ENV: 'test',
    PUBLIC_ORIGIN: ORIGIN,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    CSRF_SECRET: process.env.CSRF_SECRET ?? secret(),
    PRESESSION_SECRET: process.env.PRESESSION_SECRET ?? secret(),
    RATE_LIMIT_SECRET: process.env.RATE_LIMIT_SECRET ?? secret(),
    PREVIEW_SECRET: process.env.PREVIEW_SECRET ?? secret(),
    EMAIL_PROVIDER: 'fake',
    DEV_MAILBOX_DIR: mailboxDir,
  });
  const db = createDatabase(config.DATABASE_URL, 40);
  const owner = createDatabase(process.env.TEST_MIGRATION_DATABASE_URL!, 2);
  const app = await buildWebApp(config, db, { logger: false });
  const dispatcher = new Dispatcher(db, new FakeEmailProvider(mailboxDir), ORIGIN, 'test-worker');
  return {
    app,
    db,
    owner,
    config,
    mailboxDir,
    dispatcher,
    async close() {
      setTestClockOffset(0);
      await app.close();
      await db.destroy();
      await owner.destroy();
    },
  };
}

/** Empties every application table between tests (owner role; the runtime role has no TRUNCATE). */
export async function resetData(h: Harness): Promise<void> {
  setTestClockOffset(0);
  // Empty the fake mailbox too, so emails from an earlier test are never counted again.
  for (const entry of readdirSync(h.mailboxDir))
    rmSync(join(h.mailboxDir, entry), { recursive: true, force: true });
  await sql`TRUNCATE app.staff_sessions, app.staff_invitations, app.rotation_requests, app.deletion_markers, app.reminder_slots, app.scheduled_tasks, app.check_in_requests, app.check_ins, app.tickets,
    app.access_tokens, app.outbox_attempts, app.outbox_generations, app.outbox_messages, app.registrations, app.events,
    app.organizer_sessions, app.sign_in_requests, app.organization_memberships, app.organizations, app.accounts, app.audit_records, app.rate_limit_counters,
    app.platform_admin_sessions, app.platform_admins`.execute(h.owner);
}

/** Runs the worker until there is nothing left to do (tasks first, then the outbox). */
export async function drain(h: Harness): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const worked = (await runDueTasks(h.db, 'test-worker')) + (await h.dispatcher.runOnce());
    if (worked === 0) return;
  }
  throw new Error('drain did not settle');
}

export function mailFor(h: Harness, to: string): MailboxEntry[] {
  return readMailbox(h.mailboxDir).filter((m) => m.to === to);
}

export function linkToken(entry: MailboxEntry, path: string): string {
  const match = new RegExp(`${path}#t=([A-Za-z0-9_-]{43})`).exec(entry.text);
  if (!match) throw new Error(`no ${path} link in "${entry.subject}"`);
  return match[1]!;
}

function cookieValue(response: LightMyRequestResponse, name: string): string | undefined {
  return response.cookies.find((c) => c.name === name)?.value;
}

export interface Session {
  cookie: string;
  csrf: string;
  accountId: string;
}

/**
 * Test setup (K-709): an approved organizer, as an approved registration or a migrated organizer would
 * be: a verified account (with a password if given), owner of an active organization. Written with the
 * owner role in the test database; the application has no endpoint for this.
 */
export async function ensureOrganizer(h: Harness, email: string, password?: string): Promise<string> {
  const existing = await h.owner
    .selectFrom('app.accounts')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirst();
  if (existing) return existing.id;
  const now = new Date();
  const account = await h.owner
    .insertInto('app.accounts')
    .values({
      email,
      created_at: now,
      email_verified_at: now,
      password_hash: password ? await hashPassword(password) : null,
      password_changed_at: password ? now : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const org = await h.owner
    .insertInto('app.organizations')
    .values({
      name: email,
      status: 'active',
      created_at: now,
      updated_at: now,
      email_verified_at: now,
      submitted_at: now,
      decided_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await h.owner
    .insertInto('app.organization_memberships')
    .values({ organization_id: org.id, account_id: account.id, role: 'owner', created_at: now })
    .execute();
  return account.id;
}

/**
 * Sign-in of an approved organizer through the emailed-link fallback for accounts without a password
 * (FR-ORG-3, ADR-010; K-709 keeps it for them). Password sign-in has its own tests (accounts.test.ts).
 */
export async function signIn(h: Harness, email: string): Promise<Session> {
  await ensureOrganizer(h, email);
  const request = await h.app.inject({
    method: 'POST',
    url: '/api/auth/sign-in-requests',
    headers: { origin: ORIGIN },
    payload: { email },
  });
  if (request.statusCode !== 202)
    throw new Error(`sign-in request failed: ${request.statusCode} ${request.body}`);
  await drain(h);
  const token = linkToken(mailFor(h, email)[0]!, '/sign-in');
  const view = await h.app.inject({
    method: 'GET',
    url: '/api/links/sign-in',
    headers: { authorization: `Link ${token}` },
  });
  const nonce = cookieValue(view, '__Host-ers_presession')!;
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
  if (confirm.statusCode !== 200)
    throw new Error(`sign-in confirm failed: ${confirm.statusCode} ${confirm.body}`);
  const cookie = `__Host-ers_org=${cookieValue(confirm, '__Host-ers_org')}`;
  const session = await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
  return { cookie, csrf: session.json().csrfToken, accountId: session.json().accountId };
}

export function organizerHeaders(s: Session) {
  return { origin: ORIGIN, cookie: s.cookie, 'x-csrf-token': s.csrf };
}

/** Local "YYYY-MM-DDTHH:mm" in UTC for a time `hours` from now (tests use the UTC zone). */
export function localIn(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 16);
}

export async function createEvent(
  h: Harness,
  s: Session,
  input: { capacity: number; startsInHours: number; title?: string },
) {
  const response = await h.app.inject({
    method: 'POST',
    url: '/api/events',
    headers: organizerHeaders(s),
    payload: {
      requestId: randomUUID(),
      title: input.title ?? 'Test event',
      description: 'An event used by the automated tests',
      localStart: localIn(input.startsInHours),
      timeZone: 'UTC',
      capacity: input.capacity,
    },
  });
  if (response.statusCode !== 201)
    throw new Error(`create event failed: ${response.statusCode} ${response.body}`);
  return response.json().event as { id: string; publicId: string; startsAt: string; scheduleVersion: number };
}

export async function register(h: Harness, publicId: string, email: string) {
  return h.app.inject({
    method: 'POST',
    url: `/api/public/events/${publicId}/registrations`,
    headers: { origin: ORIGIN },
    payload: { email },
  });
}

/** Registers, delivers the verification email and returns its token. */
export async function registerAndGetVerifyToken(
  h: Harness,
  publicId: string,
  email: string,
): Promise<string> {
  const response = await register(h, publicId, email);
  if (response.statusCode !== 202)
    throw new Error(`register failed: ${response.statusCode} ${response.body}`);
  await drain(h);
  const mail = mailFor(h, email).find((m) => m.subject.startsWith('Confirm your registration'))!;
  return linkToken(mail, '/verify');
}

export async function confirm(h: Harness, token: string) {
  return h.app.inject({
    method: 'POST',
    url: '/api/links/verify/confirm',
    headers: { origin: ORIGIN, authorization: `Link ${token}` },
  });
}

/** Register and confirm in one step; returns the confirmation response body. */
export async function registerConfirmed(h: Harness, publicId: string, email: string) {
  const token = await registerAndGetVerifyToken(h, publicId, email);
  const response = await confirm(h, token);
  if (response.statusCode !== 200) throw new Error(`confirm failed: ${response.statusCode} ${response.body}`);
  return response.json();
}

export function tokenFromLink(link: string): string {
  return link.split('#t=')[1]!;
}

export function moveClockTo(target: Date, offsetMs = 0): void {
  setTestClockOffset((target.getTime() + offsetMs - Date.now()) / 1000);
}

/**
 * FR-ORG-5: requests a re-authentication link for `s`, confirms it in a browser without a
 * session (as the email recipient would) and returns the new session. The old one is revoked.
 */
export async function reauthenticate(h: Harness, s: Session, email: string): Promise<Session> {
  const request = await h.app.inject({
    method: 'POST',
    url: '/api/auth/reauthentication',
    headers: organizerHeaders(s),
  });
  if (request.statusCode !== 202) throw new Error(`reauthentication failed: ${request.statusCode}`);
  await drain(h);
  const mail = mailFor(h, email).find((m) => m.subject.startsWith('Confirm it is you'))!;
  const token = linkToken(mail, '/sign-in');
  const view = await h.app.inject({
    method: 'GET',
    url: '/api/links/sign-in',
    headers: { authorization: `Link ${token}` },
  });
  const nonce = cookieValue(view, '__Host-ers_presession')!;
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
  if (confirm.statusCode !== 200) throw new Error(`reauthentication confirm failed: ${confirm.statusCode}`);
  const cookie = `__Host-ers_org=${cookieValue(confirm, '__Host-ers_org')}`;
  const session = await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
  return { cookie, csrf: session.json().csrfToken, accountId: session.json().accountId };
}
