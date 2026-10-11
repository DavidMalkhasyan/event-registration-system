import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildWebApp } from '../src/composition/web-app.js';
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
  tokenFromLink,
  type Harness,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const MINUTE = 60_000;

function linkPost(path: string, token: string, payload?: unknown, app = h.app) {
  return app.inject({
    method: 'POST',
    url: `/api/links/manage/${path}`,
    headers: { origin: ORIGIN, authorization: `Link ${token}` },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}
const resend = (token: string, requestId = randomUUID()) => linkPost('resend', token, { requestId });
const shareLink = (token: string) => linkPost('share-links', token);
const rotate = (token: string, linkType: 'management' | 'share', requestId = randomUUID()) =>
  linkPost('rotations', token, { linkType, requestId, confirmed: true });

function view(kind: 'manage' | 'ticket', token: string) {
  return h.app.inject({
    method: 'GET',
    url: `/api/links/${kind}`,
    headers: { authorization: `Link ${token}` },
  });
}
async function manageOk(token: string) {
  return (await view('manage', token)).statusCode === 200;
}
async function shareState(token: string) {
  const r = await view('ticket', token);
  return r.statusCode === 200 ? (r.json().state as string) : 'invalid';
}
const mails = (email: string, prefix: string) =>
  mailFor(h, email).filter((m) => m.subject.startsWith(prefix));

/** Capacity 1: A confirmed (with page links), W waiting. */
async function setup() {
  const s = await signIn(h, 'organizer@example.test');
  const event = await createEvent(h, s, { capacity: 1, startsInHours: 72 });
  const a = await registerConfirmed(h, event.publicId, 'a@example.test');
  const w = await registerConfirmed(h, event.publicId, 'w@example.test');
  await drain(h);
  return {
    s,
    event,
    a,
    w,
    manageA: tokenFromLink(a.links.management),
    shareA: tokenFromLink(a.links.share),
    manageW: tokenFromLink(w.links.management),
    // A second valid management token of A, from the ticket email (issued at send time).
    emailManageA: linkToken(mails('a@example.test', 'Your ticket')[0]!, '/manage'),
  };
}

async function registrationSnapshot(eventId: string) {
  const regs = await h.db
    .selectFrom('app.registrations')
    .select(['id', 'state', 'waitlist_seq', 'confirmed_at'])
    .where('event_id', '=', eventId)
    .orderBy('id')
    .execute();
  const tickets = await h.db
    .selectFrom('app.tickets')
    .select(['id', 'code'])
    .where('event_id', '=', eventId)
    .execute();
  const slots = await h.db
    .selectFrom('app.reminder_slots')
    .selectAll()
    .where('event_id', '=', eventId)
    .execute();
  return { regs, tickets, slots };
}

/**
 * Holds the event row lock in a test transaction, so requests started meanwhile are all "submitted"
 * (their token lookups happen) before any of them can commit. `waitForBlocked(n)` resolves once n
 * other backends are waiting on a lock; `release()` lets them run, in lock order.
 */
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
        WHERE datname = current_database() AND wait_event_type = 'Lock'`.execute(h.db); // same role as the requests
      if (r.rows[0]!.n >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`fewer than ${n} requests reached the event lock`);
  };
  return { release, done, waitForBlocked };
}

describe('ticket resend (K-405: FR-SELF-4, TX-P01)', () => {
  it('queues one ticket email per request ID with links issued at send time; retries create nothing new', async () => {
    const { manageA } = await setup();
    const requestId = randomUUID();
    const first = await resend(manageA, requestId);
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ result: 'queued' });
    expect((await resend(manageA, requestId)).statusCode).toBe(202); // retry
    await drain(h);
    const resent = mails('a@example.test', 'Your ticket (resent)');
    expect(resent).toHaveLength(1);
    const code = (await h.db.selectFrom('app.tickets').select('code').executeTakeFirstOrThrow()).code;
    expect(resent[0]!.text).toContain(code);
    expect(resent[0]!.text).toContain('To pass on only your ticket, send this share link');
    // Its links are new issuances and work; the earlier ones keep working (FR-LNK-2).
    expect(await manageOk(linkToken(resent[0]!, '/manage'))).toBe(true);
    expect(await shareState(linkToken(resent[0]!, '/ticket'))).toBe('valid');
    expect(await manageOk(manageA)).toBe(true);
    await resend(manageA);
    await drain(h);
    expect(mails('a@example.test', 'Your ticket (resent)')).toHaveLength(2);
  });

  it('refuses waiting participants, share tokens, inactive registrations and cancelled events', async () => {
    const { s, event, manageA, shareA, manageW } = await setup();
    const waiting = await resend(manageW);
    expect(waiting.statusCode).toBe(409);
    expect(waiting.json().code).toBe('not_confirmed');
    expect((await resend(shareA)).body).toBe(GENERIC_INVALID_LINK_BODY); // FR-SHR-3
    expect((await linkPost('resend', 'not-a-token', {})).body).toBe(GENERIC_INVALID_LINK_BODY); // token before body
    expect((await linkPost('resend', manageA, {})).statusCode).toBe(422);
    await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/cancellation`,
      headers: organizerHeaders(s),
      payload: { confirmed: true },
    });
    expect((await resend(manageA)).body).toBe(GENERIC_INVALID_LINK_BODY);
  });

  it('is rate-limited to 3 per hour per registration, and drops a queued resend if the registration ends first', async () => {
    const { manageA, emailManageA } = await setup();
    for (let i = 0; i < 3; i += 1)
      expect((await resend(i % 2 ? emailManageA : manageA)).statusCode).toBe(202);
    const limited = await resend(manageA);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('resend_limit');
    expect(
      await h.db
        .selectFrom('app.outbox_messages')
        .select('id')
        .where('message_type', '=', 'ticket_resend')
        .execute(),
    ).toHaveLength(3);
    // The participant cancels before the worker sends: the resends are dropped at claim.
    await linkPost('cancel', manageA, { confirmed: true });
    await drain(h);
    expect(mails('a@example.test', 'Your ticket (resent)')).toHaveLength(0);
  });
});

describe('share-link issuance (FR-SHR-1, TX-P02)', () => {
  it('issues a new share link for a confirmed registration only, without revoking earlier ones', async () => {
    const { manageA, shareA, manageW } = await setup();
    const issued = await shareLink(manageA);
    expect(issued.statusCode).toBe(201);
    expect(issued.json().shareLink).toMatch(new RegExp(`^${ORIGIN}/ticket#t=[A-Za-z0-9_-]{43}$`));
    const fresh = tokenFromLink(issued.json().shareLink);
    expect(await shareState(fresh)).toBe('valid');
    expect(await shareState(shareA)).toBe('valid');
    expect((await shareLink(manageW)).json().code).toBe('not_confirmed');
    expect((await shareLink(shareA)).body).toBe(GENERIC_INVALID_LINK_BODY); // a share token grants no management
  });
});

describe('link rotation (FR-ROT-1 to FR-ROT-11, TX-P03)', () => {
  it('management rotation: every earlier management link stops working, share links and the ticket do not change', async () => {
    const { event, manageA, emailManageA, shareA } = await setup();
    const before = await registrationSnapshot(event.id);
    const response = await rotate(manageA, 'management');
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ result: 'rotated', linkType: 'management', replacementEmailQueued: true });
    const newManage = tokenFromLink(body.newLink);

    expect(await manageOk(manageA)).toBe(false);
    expect(await manageOk(emailManageA)).toBe(false); // links in earlier emails too (FR-ROT-2 a)
    expect((await view('manage', manageA)).body).toBe(GENERIC_INVALID_LINK_BODY);
    expect(await manageOk(newManage)).toBe(true);
    expect(await shareState(shareA)).toBe('valid'); // the other type is unaffected (FR-LNK-4)
    expect(await registrationSnapshot(event.id)).toEqual(before); // FR-ROT-4

    await drain(h);
    const [replaced] = mails('a@example.test', 'Your management link was replaced');
    expect(replaced!.text).toContain('someone else may have had your link');
    expect(await manageOk(linkToken(replaced!, '/manage'))).toBe(true); // issued after the rotation (FR-ROT-3)
    expect(mails('w@example.test', 'Your management link was replaced')).toHaveLength(0);

    const audit = await h.db
      .selectFrom('app.audit_records')
      .selectAll()
      .where('action', '=', 'link_rotated')
      .executeTakeFirstOrThrow();
    expect(audit.details).toEqual({ linkType: 'management' });
    expect(JSON.stringify(audit)).not.toContain(manageA);
  });

  it('share rotation: earlier share links stop working, management links and the ticket code stay, no email', async () => {
    const { event, manageA, shareA } = await setup();
    const second = tokenFromLink((await shareLink(manageA)).json().shareLink);
    const before = await registrationSnapshot(event.id);
    const response = await rotate(manageA, 'share');
    expect(response.json()).toMatchObject({
      result: 'rotated',
      linkType: 'share',
      replacementEmailQueued: false,
    });
    const newShare = tokenFromLink(response.json().newLink);
    expect((await view('ticket', shareA)).body).toBe(GENERIC_INVALID_LINK_BODY);
    expect((await view('ticket', second)).body).toBe(GENERIC_INVALID_LINK_BODY);
    expect(await shareState(newShare)).toBe('valid');
    expect((await view('ticket', newShare)).json().ticket.code).toBe(before.tickets[0]!.code); // FR-ROT-2 c
    expect(await manageOk(manageA)).toBe(true);
    expect(await registrationSnapshot(event.id)).toEqual(before);
    await drain(h);
    expect(mails('a@example.test', 'Your management link was replaced')).toHaveLength(0);
  });

  it('is unavailable for share links while waitlisted, refuses share tokens, and requires the confirmation', async () => {
    const { manageA, shareA, manageW } = await setup();
    const waiting = await rotate(manageW, 'share');
    expect(waiting.statusCode).toBe(409);
    expect(waiting.json().code).toBe('rotation_not_available');
    expect((await rotate(manageW, 'management')).statusCode).toBe(200); // waiting entries may rotate management
    expect((await rotate(shareA, 'share')).body).toBe(GENERIC_INVALID_LINK_BODY);
    for (const payload of [
      { linkType: 'share', requestId: randomUUID() },
      { linkType: 'x', requestId: randomUUID(), confirmed: true },
    ])
      expect((await linkPost('rotations', manageA, payload)).statusCode).toBe(422);
  });

  it('handles repeated request IDs exactly as FR-ROT-11 (a), (b) and (c)', async () => {
    const { manageA } = await setup();
    const requestId = randomUUID();
    const first = await rotate(manageA, 'management', requestId);
    const newManage = tokenFromLink(first.json().newLink);
    // (a) The same request with the token it revoked, within 15 minutes.
    const again = await rotate(manageA, 'management', requestId);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ result: 'already_replaced' });
    // (c) The used request ID with a currently valid token: nothing rotates.
    const processed = await rotate(newManage, 'management', requestId);
    expect(processed.statusCode).toBe(409);
    expect(processed.json().code).toBe('request_already_processed');
    expect(await manageOk(newManage)).toBe(true);
    await drain(h);
    expect(mails('a@example.test', 'Your management link was replaced')).toHaveLength(1);
    expect(await h.db.selectFrom('app.rotation_requests').select('id').execute()).toHaveLength(1);
    // (b) After 15 minutes the revoked token is just an invalid link.
    moveClockTo(new Date(), 15 * MINUTE + 1_000);
    expect((await rotate(manageA, 'management', requestId)).body).toBe(GENERIC_INVALID_LINK_BODY);
  });

  it('is rate-limited per registration and link type (FR-ROT-8)', async () => {
    const { manageA } = await setup();
    let token = manageA;
    for (let i = 0; i < 5; i += 1) token = tokenFromLink((await rotate(token, 'management')).json().newLink);
    const limited = await rotate(token, 'management');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('rotation_limit');
    expect(await manageOk(token)).toBe(true); // nothing changed
    expect((await rotate(token, 'share')).statusCode).toBe(200); // the other type has its own limit
  });

  it('rolls back completely when the transaction fails, and the same request ID then works (FR-ROT-6, FR-ROT-11 d)', async () => {
    const { manageA } = await setup();
    const tokensBefore = await h.db.selectFrom('app.access_tokens').select('id').execute();
    await sql`CREATE FUNCTION app.test_fail_rotation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END $$`.execute(h.owner);
    await sql`CREATE TRIGGER test_fail_rotation BEFORE INSERT ON app.rotation_requests
      FOR EACH ROW EXECUTE FUNCTION app.test_fail_rotation()`.execute(h.owner);
    const requestId = randomUUID();
    try {
      const failed = await rotate(manageA, 'management', requestId);
      expect(failed.statusCode).toBe(503);
      expect(failed.json().code).toBe('rotation_not_applied');
      expect(failed.json().title).toBe(
        'Your link was not changed. Your current link still works. Please try again.',
      );
    } finally {
      await sql`DROP TRIGGER test_fail_rotation ON app.rotation_requests`.execute(h.owner);
      await sql`DROP FUNCTION app.test_fail_rotation()`.execute(h.owner);
    }
    expect(await manageOk(manageA)).toBe(true);
    expect(await h.db.selectFrom('app.access_tokens').select('id').execute()).toHaveLength(
      tokensBefore.length,
    );
    expect(
      await h.db
        .selectFrom('app.outbox_messages')
        .select('id')
        .where('message_type', '=', 'management_link_replaced')
        .execute(),
    ).toHaveLength(0);
    expect(
      await h.db.selectFrom('app.audit_records').select('id').where('action', '=', 'link_rotated').execute(),
    ).toHaveLength(0);
    expect((await rotate(manageA, 'management', requestId)).json().result).toBe('rotated');
  });
});

describe('rotation concurrency (FR-ROT-9)', () => {
  it('two rotations with two different valid tokens both succeed; only the later page link stays valid (AC-75)', async () => {
    for (let round = 0; round < 3; round += 1) {
      await resetData(h);
      const { manageA, emailManageA } = await setup();
      const { event } = await h.db
        .selectFrom('app.registrations')
        .select('event_id as event')
        .where('email', '=', 'a@example.test')
        .executeTakeFirstOrThrow();
      const lock = await holdEventLock(event);
      const both = Promise.all([rotate(manageA, 'management'), rotate(emailManageA, 'management')]);
      try {
        await lock.waitForBlocked(2); // both requests were submitted while A and B were valid
      } finally {
        lock.release();
      }
      await lock.done;
      const [r1, r2] = await both;
      expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
      const rows = await h.db
        .selectFrom('app.rotation_requests')
        .select(['new_token_id', 'decided_at'])
        .orderBy('decided_at')
        .execute();
      expect(rows).toHaveLength(2);
      const t1 = tokenFromLink(r1.json().newLink);
      const t2 = tokenFromLink(r2.json().newLink);
      const valid = [await manageOk(t1), await manageOk(t2)];
      expect(valid.filter(Boolean)).toHaveLength(1); // the token of the later commit
      expect(await manageOk(manageA)).toBe(false);
      expect(await manageOk(emailManageA)).toBe(false);
      await drain(h);
      expect(mails('a@example.test', 'Your management link was replaced')).toHaveLength(2); // two logical messages
      // A token revoked BEFORE submission never authorizes a rotation (FR-ROT-9).
      expect((await rotate(manageA, 'management')).body).toBe(GENERIC_INVALID_LINK_BODY);
    }
  });

  it('the same request ID submitted twice at once rotates once', async () => {
    const { manageA } = await setup();
    const requestId = randomUUID();
    const results = await Promise.all([
      rotate(manageA, 'management', requestId),
      rotate(manageA, 'management', requestId),
    ]);
    expect(results.map((r) => r.json().result).sort()).toEqual(['already_replaced', 'rotated']);
    await drain(h);
    expect(mails('a@example.test', 'Your management link was replaced')).toHaveLength(1);
  });

  it('rotation vs. participant cancellation with different tokens: exactly one of them succeeds', async () => {
    for (let round = 0; round < 4; round += 1) {
      await resetData(h);
      const { manageA, emailManageA } = await setup();
      const [rotation, cancel] = await Promise.all([
        rotate(emailManageA, 'management'),
        linkPost('cancel', manageA, { confirmed: true }),
      ]);
      // Rotation first: it revokes the cancelling token. Cancellation first: the rotation finds no active registration.
      expect([rotation.statusCode === 200, cancel.statusCode === 200].filter(Boolean)).toHaveLength(1);
      if (cancel.statusCode !== 200) expect(cancel.body).toBe(GENERIC_INVALID_LINK_BODY);
      else expect(rotation.body).toBe(GENERIC_INVALID_LINK_BODY);
    }
  });

  it('rotation vs. event cancellation: never a valid link afterwards, no replacement email once cancelled', async () => {
    for (let round = 0; round < 4; round += 1) {
      await resetData(h);
      const { s, event, manageA } = await setup();
      const [rotation, cancellation] = await Promise.all([
        rotate(manageA, 'management'),
        h.app.inject({
          method: 'POST',
          url: `/api/events/${event.id}/cancellation`,
          headers: organizerHeaders(s),
          payload: { confirmed: true },
        }),
      ]);
      expect(cancellation.statusCode).toBe(200);
      if (rotation.statusCode === 200)
        expect(await manageOk(tokenFromLink(rotation.json().newLink))).toBe(false);
      else expect(rotation.body).toBe(GENERIC_INVALID_LINK_BODY);
      await drain(h);
      expect(mails('a@example.test', 'Your management link was replaced')).toHaveLength(0); // dropped at claim
      expect(mails('a@example.test', 'Event cancelled')).toHaveLength(1);
    }
  });

  it('a rotated registration does not block event deletion, and a deleted event’s links are invalid (PD-47)', async () => {
    const { s, event, manageA, manageW } = await setup();
    const rotated = tokenFromLink((await rotate(manageA, 'management')).json().newLink);
    await rotate(rotated, 'share');
    await linkPost('cancel', rotated, { confirmed: true });
    await linkPost('cancel', manageW, { confirmed: true });
    await drain(h);
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
    expect(await h.db.selectFrom('app.rotation_requests').select('id').execute()).toHaveLength(0);
    expect((await rotate(rotated, 'management')).body).toBe(GENERIC_INVALID_LINK_BODY);
  });
});

describe('no raw token is stored or logged (FR-LNK-1, FR-ROT-10, ENG-ERR-6)', () => {
  it('keeps raw tokens out of the database and out of the request logs', async () => {
    const lines: string[] = [];
    const logStream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const app = await buildWebApp(h.config, h.db, { logger: true, logStream });
    try {
      const { manageA, shareA } = await setup();
      const raws = [manageA, shareA];
      const rotation = await linkPost(
        'rotations',
        manageA,
        { linkType: 'management', requestId: randomUUID(), confirmed: true },
        app,
      );
      raws.push(tokenFromLink(rotation.json().newLink));
      const share = await linkPost('share-links', raws[2]!, undefined, app);
      raws.push(tokenFromLink(share.json().shareLink));
      await linkPost('resend', raws[2]!, { requestId: randomUUID() }, app);
      await app.inject({
        method: 'GET',
        url: '/api/links/manage',
        headers: { authorization: `Link ${raws[2]}` },
      });
      await drain(h);

      const logs = lines.join('\n');
      expect(logs).toContain('/api/links/manage/rotations'); // the requests were logged…
      for (const raw of raws) expect(logs).not.toContain(raw); // …without their tokens

      const tables = ['access_tokens', 'outbox_messages', 'audit_records', 'rotation_requests'] as const;
      for (const table of tables) {
        const rows = await sql`SELECT * FROM ${sql.table(`app.${table}`)}`.execute(h.db);
        const dump = JSON.stringify(rows.rows, (_k, v: unknown) =>
          Buffer.isBuffer(v) ? v.toString('base64url') : (v as unknown),
        );
        for (const raw of raws) expect(dump, table).not.toContain(raw);
      }
    } finally {
      await app.close();
    }
  });
});
