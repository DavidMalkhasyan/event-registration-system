import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Dispatcher } from '../src/modules/messaging/dispatcher.js';
import type { EmailProvider, ProviderResult } from '../src/modules/messaging/fake-provider.js';
import { ResendEmailProvider, resendIdempotencyKey } from '../src/modules/messaging/resend-provider.js';
import { parseConfig } from '../src/platform/config.js';
import { ORIGIN, createEvent, createHarness, register, resetData, signIn, type Harness } from './harness.js';

// K-717 (PD-97): the Resend provider against a local stand-in for its API (no request reaches Resend),
// and the dispatcher's handling of every outcome class on the real database. "Accepted" is claimed only
// for a 200 with an email ID; refusals never count as possibly accepted.

const KEY = 're_test_0123456789abcdef';
let api: Server;
let seen: { headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
let reply: { status: number; body?: unknown; headers?: Record<string, string>; delayMs?: number } = {
  status: 200,
};
let apiUrl = '';

beforeAll(async () => {
  api = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ headers: req.headers, body: JSON.parse(raw || '{}') });
      const answer = () =>
        res
          .writeHead(reply.status, { 'content-type': 'application/json', ...(reply.headers ?? {}) })
          .end(JSON.stringify(reply.body ?? {}));
      if (reply.delayMs) setTimeout(answer, reply.delayMs);
      else answer();
    });
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
afterAll(async () => new Promise((r) => api.close(r)));

const provider = (timeoutMs?: number) =>
  new ResendEmailProvider({
    apiKey: KEY,
    from: 'EventFlow <events@example.test>',
    replyTo: 'help@example.test',
    apiUrl,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
const send = (p = provider(), key = 'verification:abc:g1') =>
  p.send({
    idempotencyKey: key,
    to: 'anna@example.test',
    email: { subject: 'Confirm', text: 'Open https://x.test/verify#t=SECRET', html: '<p>hi</p>' },
    tags: { outbox_id: '0192f0c4-7a1b-7c3d-9e8f-0123456789ab', generation: '1' },
  });

describe('the Resend provider', () => {
  beforeEach(() => {
    seen = [];
    reply = { status: 200, body: { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' } };
  });

  it('sends one authenticated, identified, idempotent request with the message', async () => {
    const result = await send();
    expect(result).toEqual({
      category: 'accepted',
      providerMessageId: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794',
      httpStatus: 200,
    });
    expect(seen).toHaveLength(1);
    const { headers, body } = seen[0]!;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers['user-agent']).toBe('EventFlow/1.0');
    expect(headers['idempotency-key']).toBe('verification:abc:g1');
    expect(body).toEqual({
      from: 'EventFlow <events@example.test>',
      to: ['anna@example.test'],
      subject: 'Confirm',
      html: '<p>hi</p>',
      text: 'Open https://x.test/verify#t=SECRET',
      reply_to: 'help@example.test',
      tags: [
        { name: 'outbox_id', value: '0192f0c4-7a1b-7c3d-9e8f-0123456789ab' },
        { name: 'generation', value: '1' },
      ],
    });
    const long = 'k'.repeat(300);
    expect(resendIdempotencyKey(long)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(resendIdempotencyKey(long)).toBe(resendIdempotencyKey(long));
    await send(provider(), long);
    expect(seen[1]!.headers['idempotency-key']).toBe(resendIdempotencyKey(long));
  });

  it('classifies every documented answer, and only a 200 with an ID as accepted', async () => {
    const cases: [number, unknown, Record<string, string>, Partial<ProviderResult>][] = [
      [200, {}, {}, { category: 'ambiguous' }], // 200 without an ID proves nothing
      [409, { name: 'invalid_idempotent_request' }, {}, { category: 'idempotent_key_conflict' }],
      [409, { name: 'concurrent_idempotent_requests' }, {}, { category: 'concurrent_conflict' }],
      [
        429,
        { name: 'rate_limit_exceeded' },
        { 'retry-after': '7' },
        { category: 'rate_limited', retryAfterSeconds: 7 },
      ],
      [429, { name: 'daily_quota_exceeded' }, {}, { category: 'rate_limited' }],
      [401, { name: 'missing_api_key' }, {}, { category: 'config_fault' }],
      [403, { name: 'validation_error' }, {}, { category: 'config_fault' }], // unverified domain
      [422, { name: 'missing_required_field' }, {}, { category: 'permanent' }],
      [400, { name: 'validation_error' }, {}, { category: 'permanent' }],
      [500, { name: 'application_error' }, {}, { category: 'ambiguous' }],
      [503, { name: 'service_unavailable' }, {}, { category: 'ambiguous' }],
    ];
    for (const [status, body, headers, expected] of cases) {
      reply = { status, body, headers };
      const result = await send();
      expect(result, `${status} ${JSON.stringify(body)}`).toMatchObject({ ...expected, httpStatus: status });
      if (expected.category !== 'rate_limited' || !headers['retry-after'])
        expect(result.retryAfterSeconds).toBeUndefined();
    }
  });

  it('throws on a timeout (the dispatcher treats it as ambiguous), without the key or the message in the error', async () => {
    reply = { status: 200, body: { id: 'late' }, delayMs: 500 };
    const error = await send(provider(100)).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toMatch(/re_test|SECRET|anna@/);
  });
});

describe('configuration', () => {
  const base = {
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://eventflow.example',
    DATABASE_URL: 'postgres://x',
    CSRF_SECRET: 'a'.repeat(32),
    PRESESSION_SECRET: 'b'.repeat(32),
    RATE_LIMIT_SECRET: 'c'.repeat(32),
    PREVIEW_SECRET: 'd'.repeat(32),
    ADMIN_TOTP_KEY: Buffer.alloc(32, 7).toString('base64'), // K-718: required in production
  };
  it('refuses the fake provider in production, and Resend without its key and sender, naming only the variables', () => {
    // K-718: and without the key for the Super Admins' second factor.
    const { ADMIN_TOTP_KEY: _key, ...withoutKey } = base;
    void _key;
    expect(() =>
      parseConfig({ ...withoutKey, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: KEY, EMAIL_FROM: 'a@b.test' }),
    ).toThrow(/ADMIN_TOTP_KEY/);
    expect(() =>
      parseConfig({
        ...withoutKey,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: KEY,
        EMAIL_FROM: 'a@b.test',
        ADMIN_REQUIRE_TOTP: 'false',
      }),
    ).not.toThrow(); // an explicit, documented opt-out
    expect(() => parseConfig({ ...base })).toThrow(/EMAIL_PROVIDER/);
    // Demo authentication can never be switched on in production, whatever else is set.
    expect(() =>
      parseConfig({
        ...base,
        DEMO_MODE: 'true',
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: KEY,
        EMAIL_FROM: 'a@b.test',
      }),
    ).toThrow(/DEMO_MODE/);
    const missing = (() => {
      try {
        parseConfig({ ...base, EMAIL_PROVIDER: 'resend' });
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(missing).toMatch(/RESEND_API_KEY/);
    expect(missing).toMatch(/EMAIL_FROM/);
    const wrongKey = (() => {
      try {
        parseConfig({
          ...base,
          EMAIL_PROVIDER: 'resend',
          RESEND_API_KEY: 'sk_live_secretvalue',
          EMAIL_FROM: 'a@b.test',
        });
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(wrongKey).toMatch(/RESEND_API_KEY/);
    expect(wrongKey).not.toContain('sk_live_secretvalue');
    const ok = parseConfig({
      ...base,
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: KEY,
      EMAIL_FROM: 'EventFlow <events@eventflow.example>',
    });
    expect(ok.EMAIL_PROVIDER).toBe('resend');
    expect(() =>
      parseConfig({
        ...base,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: KEY,
        EMAIL_FROM: 'a@b.test',
        RESEND_API_URL: 'http://api.resend.com',
      }),
    ).toThrow(/RESEND_API_URL/);
  });
});

describe('the dispatcher with each outcome', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => h.close());
  beforeEach(async () => resetData(h));

  /** A provider that answers with the given results in turn. */
  function scripted(...results: (ProviderResult | Error)[]): EmailProvider {
    return {
      async send() {
        const next = results.shift()!;
        if (next instanceof Error) throw next;
        return next;
      },
    };
  }

  async function queued() {
    const owner = await signIn(h, 'owner@example.test');
    const event = await createEvent(h, owner, { capacity: 3, startsInHours: 48 });
    await register(h, event.publicId, 'anna@example.test');
    return async () =>
      h.db
        .selectFrom('app.outbox_messages')
        .selectAll()
        .where('recipient_email', '=', 'anna@example.test')
        .executeTakeFirstOrThrow();
  }
  const run = (p: EmailProvider) => new Dispatcher(h.db, p, ORIGIN, 'test-worker').runOnce();
  const attempts = async (outboxId: string) =>
    h.db
      .selectFrom('app.outbox_attempts')
      .selectAll()
      .where('outbox_id', '=', outboxId)
      .orderBy('attempt_no')
      .execute();
  const makeDue = (id: string) =>
    h.owner
      .updateTable('app.outbox_messages')
      .set({ next_attempt_at: new Date(0) })
      .where('id', '=', id)
      .execute();

  it('a permanent refusal fails the message at once, never as possibly accepted', async () => {
    const message = await queued();
    await run(scripted({ category: 'permanent', httpStatus: 422, errorCode: 'validation_error' }));
    const m = await message();
    expect(m).toMatchObject({
      status: 'FAILED',
      settle_reason: 'provider_rejected',
      possibly_accepted: false,
      last_error_code: 'validation_error',
    });
    expect((await attempts(m.id))[0]).toMatchObject({
      result_category: 'permanent',
      http_status: 422,
      possibly_accepted: false,
    });
  });

  it('a rate limit retries after Retry-After; a configuration fault retries with back-off; neither counts as accepted', async () => {
    const message = await queued();
    const before = Date.now();
    await run(scripted({ category: 'rate_limited', httpStatus: 429, retryAfterSeconds: 120 }));
    let m = await message();
    expect(m).toMatchObject({
      status: 'WAITING_RETRY',
      possibly_accepted: false,
      last_error_code: 'rate_limited',
    });
    expect(m.next_attempt_at.getTime() - before).toBeGreaterThanOrEqual(119_000);
    await makeDue(m.id);
    await run(scripted({ category: 'config_fault', httpStatus: 403, errorCode: 'validation_error' }));
    m = await message();
    expect(m).toMatchObject({
      status: 'WAITING_RETRY',
      possibly_accepted: false,
      last_error_code: 'config_fault',
    });
    await makeDue(m.id);
    await run(scripted({ category: 'accepted', providerMessageId: 'resend-1', httpStatus: 200 }));
    m = await message();
    expect(m.status).toBe('ACCEPTED');
    const generation = await h.db
      .selectFrom('app.outbox_generations')
      .selectAll()
      .where('outbox_id', '=', m.id)
      .executeTakeFirstOrThrow();
    expect(generation.provider_message_id).toBe('resend-1');
  });

  it('after an ambiguous attempt, a later refusal leaves the outcome unknown, not failed', async () => {
    const message = await queued();
    await run(scripted(new Error('socket hang up')));
    let m = await message();
    expect(m).toMatchObject({ status: 'WAITING_RETRY', possibly_accepted: true });
    expect((await attempts(m.id))[0]).toMatchObject({
      result_category: 'ambiguous',
      error_code: 'network_or_timeout',
    });
    await makeDue(m.id);
    await run(scripted({ category: 'permanent', httpStatus: 422 }));
    m = await message();
    expect(m).toMatchObject({
      status: 'UNCONFIRMED',
      settle_reason: 'provider_rejected',
      possibly_accepted: true,
    });
  });
});
