import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Dispatcher } from '../src/modules/messaging/dispatcher.js';
import type { EmailProvider, ProviderResult } from '../src/modules/messaging/fake-provider.js';
import { verifySvix } from '../src/modules/messaging/webhooks.js';
import { ORIGIN, createEvent, createHarness, register, resetData, signIn, type Harness } from './harness.js';

// K-402 (PD-98): Resend delivery webhooks, signed with Svix. Only verified, recent events are stored, once;
// facts are recomputed from all events; evidence settles unknown outcomes; nothing personal is kept.

const SECRET = `whsec_${randomBytes(24).toString('base64')}`;
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ RESEND_WEBHOOK_SECRET: SECRET });
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

function signed(body: unknown, opts: { id?: string; at?: number; secret?: string } = {}) {
  const raw = JSON.stringify(body);
  const id = opts.id ?? `msg_${randomUUID()}`;
  const ts = String(opts.at ?? Math.floor(Date.now() / 1000));
  const key = Buffer.from((opts.secret ?? SECRET).replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  return { raw, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` } };
}
const post = (raw: string, headers: Record<string, string>) =>
  h.app.inject({
    method: 'POST',
    url: '/api/webhooks/resend',
    headers: { 'content-type': 'application/json', ...headers },
    payload: raw,
  });
const event = (type: string, emailId: string, at = new Date().toISOString(), extra: object = {}) => ({
  type,
  created_at: at,
  data: { email_id: emailId, to: ['anna@example.test'], subject: 'Your ticket: Secret party', ...extra },
});

/** A registration whose verification email the scripted provider answers; returns its outbox row. */
async function sentMessage(result: ProviderResult | Error) {
  const owner = await signIn(h, 'owner@example.test');
  const ev = await createEvent(h, owner, { capacity: 3, startsInHours: 48 });
  await register(h, ev.publicId, 'anna@example.test');
  const provider: EmailProvider = {
    async send() {
      if (result instanceof Error) throw result;
      return result;
    },
  };
  await new Dispatcher(h.db, provider, ORIGIN, 'w').runOnce();
  const message = await h.db
    .selectFrom('app.outbox_messages')
    .selectAll()
    .where('recipient_email', '=', 'anna@example.test')
    .executeTakeFirstOrThrow();
  return { message, owner, ev };
}
const generation = (outboxId: string) =>
  h.db
    .selectFrom('app.outbox_generations')
    .selectAll()
    .where('outbox_id', '=', outboxId)
    .executeTakeFirstOrThrow();

describe('signature verification', () => {
  it('accepts only the right secret, an untouched body and a recent timestamp', () => {
    const now = Math.floor(Date.now() / 1000);
    const s = signed({ a: 1 }, { at: now });
    const headers = {
      id: s.headers['svix-id'],
      timestamp: s.headers['svix-timestamp'],
      signature: s.headers['svix-signature'],
    };
    expect(verifySvix(SECRET, headers, s.raw, now)).toBe(true);
    expect(verifySvix(SECRET, headers, s.raw.replace('1', '2'), now)).toBe(false);
    expect(verifySvix(`whsec_${randomBytes(24).toString('base64')}`, headers, s.raw, now)).toBe(false);
    expect(verifySvix(SECRET, headers, s.raw, now + 301)).toBe(false); // too old
    expect(verifySvix(SECRET, { ...headers, signature: `v2,abc ${headers.signature}` }, s.raw, now)).toBe(
      true,
    ); // several
    expect(verifySvix(SECRET, { ...headers, signature: 'v1,' }, s.raw, now)).toBe(false);
    expect(verifySvix(SECRET, { ...headers, id: undefined }, s.raw, now)).toBe(false);
  });

  it('refuses unsigned, wrongly signed and stale requests over HTTP and stores nothing', async () => {
    const body = event('email.delivered', 'em_1');
    expect((await post(JSON.stringify(body), {})).statusCode).toBe(401);
    const bad = signed(body, { secret: `whsec_${randomBytes(24).toString('base64')}` });
    expect((await post(bad.raw, bad.headers)).statusCode).toBe(401);
    const stale = signed(body, { at: Math.floor(Date.now() / 1000) - 3600 });
    expect((await post(stale.raw, stale.headers)).statusCode).toBe(401);
    expect(await h.db.selectFrom('app.provider_events').select('id').execute()).toEqual([]);
  });
});

describe('delivery evidence', () => {
  it('records a delivery once, even when Svix redelivers it', async () => {
    const { message } = await sentMessage({
      category: 'accepted',
      providerMessageId: 'em_1',
      httpStatus: 200,
    });
    const at = '2026-10-13T10:00:00.000Z';
    const s = signed(event('email.delivered', 'em_1', at));
    const first = await post(s.raw, s.headers); // no Origin header: a server sends none
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ received: 'stored' });
    expect((await post(s.raw, s.headers)).json()).toEqual({ received: 'duplicate' });
    expect(await h.db.selectFrom('app.provider_events').select('id').execute()).toHaveLength(1);
    expect((await generation(message.id)).delivered_at?.toISOString()).toBe(at);
    // Nothing personal is stored: no recipient, subject or link.
    const stored = await h.db.selectFrom('app.provider_events').selectAll().executeTakeFirstOrThrow();
    expect(JSON.stringify(stored)).not.toMatch(/anna@|Secret party/);
  });

  it('recomputes facts whatever the arrival order, and shows a bounce to the organizer', async () => {
    const { message, owner, ev } = await sentMessage({
      category: 'accepted',
      providerMessageId: 'em_2',
      httpStatus: 200,
    });
    const bounce = signed(
      event('email.bounced', 'em_2', '2026-10-13T10:05:00.000Z', {
        bounce: { type: 'Permanent', subType: 'Suppressed', message: 'x' },
      }),
    );
    const delivered = signed(event('email.delivered', 'em_2', '2026-10-13T10:01:00.000Z'));
    await post(bounce.raw, bounce.headers); // the later event first
    await post(delivered.raw, delivered.headers);
    const g = await generation(message.id);
    expect(g.delivered_at?.toISOString()).toBe('2026-10-13T10:01:00.000Z');
    expect(g.bounced_at?.toISOString()).toBe('2026-10-13T10:05:00.000Z');
    expect(g.failure_reason).toBe('Permanent/Suppressed');
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/events/${ev.id}/participants`,
      headers: { cookie: owner.cookie },
    });
    const anna = list.json().items.find((p: { email: string }) => p.email === 'anna@example.test');
    expect(anna.emailIssues).toEqual([
      expect.objectContaining({
        messageType: 'verification',
        label: 'bounced',
        reason: 'Permanent/Suppressed',
      }),
    ]);
  });

  it('settles an unknown outcome as accepted, and only flags evidence that contradicts a failure', async () => {
    const { message } = await sentMessage(new Error('timeout'));
    expect(message.status).toBe('WAITING_RETRY');
    // The provider's ID is unknown after a timeout: the event is matched by our tags.
    const sent = signed(
      event('email.sent', 'em_unknown', undefined, { tags: { outbox_id: message.id, generation: '1' } }),
    );
    await post(sent.raw, sent.headers);
    const settled = await h.db
      .selectFrom('app.outbox_messages')
      .selectAll()
      .where('id', '=', message.id)
      .executeTakeFirstOrThrow();
    expect(settled).toMatchObject({ status: 'ACCEPTED', settle_reason: 'provider_evidence' });
    const match = await h.db.selectFrom('app.provider_event_matches').selectAll().executeTakeFirstOrThrow();
    expect(match.method).toBe('tag');

    await resetData(h);
    const failed = await sentMessage({ category: 'permanent', httpStatus: 422 });
    expect(failed.message.status).toBe('FAILED');
    const contradiction = signed(
      event('email.delivered', 'x', undefined, {
        tags: [
          { name: 'outbox_id', value: failed.message.id },
          { name: 'generation', value: '1' },
        ],
      }),
    );
    await post(contradiction.raw, contradiction.headers);
    const after = await h.db
      .selectFrom('app.outbox_messages')
      .selectAll()
      .where('id', '=', failed.message.id)
      .executeTakeFirstOrThrow();
    expect(after.status).toBe('FAILED'); // never rewritten
    expect(after.evidence_anomaly_at).not.toBeNull();
  });

  it('keeps events it cannot match, and is off without a secret', async () => {
    const s = signed(event('email.delivered', 'em_nobody'));
    expect((await post(s.raw, s.headers)).json()).toEqual({ received: 'stored' });
    expect(await h.db.selectFrom('app.provider_event_matches').select('outbox_id').execute()).toEqual([]);
    const plain = await createHarness();
    try {
      expect(
        (
          await plain.app.inject({
            method: 'POST',
            url: '/api/webhooks/resend',
            headers: { 'content-type': 'application/json', ...s.headers },
            payload: s.raw,
          })
        ).statusCode,
      ).toBe(404);
    } finally {
      await plain.close();
    }
  });

  it('exempts only the webhook path from the Origin check', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('origin_check_failed');
  });
});
