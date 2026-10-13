import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, freemem, totalmem } from 'node:os';
import { resolve } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { readMailbox } from '../src/modules/messaging/fake-provider.js';
import { hashPassword } from '../src/platform/passwords.js';
import resetTestDatabase from '../test/global-setup.js';

// K-723 (PD-102): load measurements of the critical paths. Starts the built web and worker processes
// (as in production, one of each) against the test database, which is recreated first, so nothing
// touches the development data, and drives them over HTTP with synthetic participants. Every client
// sends its own X-Forwarded-For address (TRUST_PROXY_HOPS=1, as behind Caddy), so per-IP limits apply
// per synthetic client, as they would for real visitors. Prints the measurements and writes them to
// var/bench/<time>.json. Run with `pnpm bench` (needs the test database from .env).

const SERVER = resolve(import.meta.dirname, '..');
const REPO = resolve(SERVER, '../..');
const PORT = 3300;
const BASE = `http://127.0.0.1:${PORT}`;
const MAILBOX = resolve(REPO, 'var/bench-mailbox');
const MEDIA = resolve(REPO, 'var/bench-media');
const PARTICIPANTS = Number(process.env.BENCH_PARTICIPANTS ?? 600);
const CAPACITY = Number(process.env.BENCH_CAPACITY ?? 100);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 32);

interface Result {
  name: string;
  requests: number;
  concurrency: number;
  seconds: number;
  perSecond: number;
  statuses: Record<string, number>;
  ms: { p50: number; p95: number; p99: number; max: number };
}

const results: Result[] = [];
const checks: Record<string, unknown> = {};
let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]! * 10) / 10;
}

/** Runs `count` requests with at most `concurrency` in flight and records latency and status codes. */
async function measure<T>(
  name: string,
  count: number,
  concurrency: number,
  run: (i: number) => Promise<{ status: number; value?: T }>,
): Promise<(T | undefined)[]> {
  const times: number[] = [];
  const statuses: Record<string, number> = {};
  const values: (T | undefined)[] = new Array(count);
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, count) }, async () => {
      for (let i = next++; i < count; i = next++) {
        const t0 = performance.now();
        const { status, value } = await run(i);
        times.push(performance.now() - t0);
        statuses[status] = (statuses[status] ?? 0) + 1;
        values[i] = value;
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  times.sort((a, b) => a - b);
  const result: Result = {
    name,
    requests: count,
    concurrency,
    seconds: Math.round(seconds * 100) / 100,
    perSecond: Math.round(count / seconds),
    statuses,
    ms: {
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      max: percentile(times, 100),
    },
  };
  results.push(result);
  console.log(
    `${name}: ${count} requests, ${concurrency} at a time, ${result.seconds} s (${result.perSecond}/s); ` +
      `p50 ${result.ms.p50} ms, p95 ${result.ms.p95} ms, p99 ${result.ms.p99} ms, max ${result.ms.max} ms; ${JSON.stringify(statuses)}`,
  );
  return values;
}

async function http(
  method: string,
  path: string,
  init: { headers?: Record<string, string>; body?: unknown } = {},
) {
  const isBuffer = Buffer.isBuffer(init.body);
  const response = await fetch(BASE + path, {
    method,
    headers: {
      origin: BASE,
      'x-forwarded-for': nextIp(),
      ...(init.body !== undefined && !isBuffer ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
    ...(init.body !== undefined
      ? { body: isBuffer ? (init.body as Buffer) : JSON.stringify(init.body) }
      : {}),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return {
    status: response.status,
    json: json as Record<string, unknown> | undefined,
    headers: response.headers,
  };
}

function memoryOf(pid: number): number | null {
  const out =
    process.platform === 'win32'
      ? spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], {
          encoding: 'utf8',
        })
      : spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  const n = Number(out.stdout.trim());
  if (!Number.isFinite(n) || n === 0) return null;
  return Math.round((process.platform === 'win32' ? n : n * 1024) / 1_048_576);
}

async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  what: string,
): Promise<number> {
  const started = performance.now();
  while (!(await check())) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return performance.now() - started;
}

interface DbStats {
  xact_commit: number;
  xact_rollback: number;
  tup_returned: number;
  tup_fetched: number;
  tup_inserted: number;
  tup_updated: number;
  tup_deleted: number;
  blks_hit: number;
  blks_read: number;
  deadlocks: number;
}

async function dbStats(client: pg.Client): Promise<DbStats> {
  const r = await client.query(
    `SELECT xact_commit, xact_rollback, tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted,
            blks_hit, blks_read, deadlocks
       FROM pg_stat_database WHERE datname = current_database()`,
  );
  return Object.fromEntries(
    Object.entries(r.rows[0] as object).map(([k, v]) => [k, Number(v)]),
  ) as unknown as DbStats;
}

// --- Start the system ------------------------------------------------------------------------------

const build = spawnSync('pnpm --filter @ers/server build', { cwd: REPO, stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);
await resetTestDatabase(); // loads .env; recreates the test database's schema
rmSync(MAILBOX, { recursive: true, force: true });
rmSync(MEDIA, { recursive: true, force: true });
const owner = new pg.Client({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL });
await owner.connect();

const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: String(PORT),
  PUBLIC_ORIGIN: BASE,
  TRUST_PROXY_HOPS: '1',
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  EMAIL_PROVIDER: 'fake',
  DEV_MAILBOX_DIR: MAILBOX,
  MEDIA_DIR: MEDIA,
};
const children: ChildProcess[] = ['web', 'worker'].map((name) =>
  spawn(process.execPath, [`dist/entrypoints/${name}.js`], {
    cwd: SERVER,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  }),
);
const [web, worker] = children as [ChildProcess, ChildProcess];
let stopping = false;
for (const child of children)
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`a process stopped unexpectedly (${code})`);
      process.exit(1);
    }
  });

try {
  await waitFor(
    async () => (await fetch(`${BASE}/readyz`).catch(() => null))?.ok === true,
    30_000,
    'readiness',
  );
  const memoryAtStart = { web: memoryOf(web.pid!), worker: memoryOf(worker.pid!) };
  // Database load: the server's statistics for this database before and after, and the number of
  // connections to it sampled every 250 ms.
  const statsAtStart = await dbStats(owner);
  const sampler = new pg.Client({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL });
  await sampler.connect();
  const connections = { max: 0, active: 0 };
  const sampling = setInterval(() => {
    sampler
      .query(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE state = 'active')::int AS active
           FROM pg_stat_activity WHERE datname = current_database()`,
      )
      .then((r) => {
        connections.max = Math.max(connections.max, r.rows[0].n);
        connections.active = Math.max(connections.active, r.rows[0].active);
      })
      .catch(() => undefined);
  }, 250);

  // Synthetic organizers with passwords (setup written with the owner role, as the tests do).
  const password = `bench-${randomUUID()}`;
  const hash = await hashPassword(password);
  const organizers = Array.from({ length: 5 }, (_, i) => `organizer${i}@bench.example.test`);
  for (const email of organizers) {
    const account = await owner.query(
      `INSERT INTO app.accounts (email, created_at, email_verified_at, password_hash, password_changed_at)
       VALUES ($1, now(), now(), $2, now()) RETURNING id`,
      [email, hash],
    );
    const org = await owner.query(
      `INSERT INTO app.organizations (name, status, created_at, updated_at, email_verified_at, submitted_at, decided_at)
       VALUES ($1, 'active', now(), now(), now(), now(), now()) RETURNING id`,
      [email],
    );
    await owner.query(
      `INSERT INTO app.organization_memberships (organization_id, account_id, role, created_at) VALUES ($1, $2, 'owner', now())`,
      [org.rows[0].id, account.rows[0].id],
    );
  }

  // 1. Password sign-in (Argon2id), four per organizer.
  const sessions = await measure('password sign-in', 20, 4, async (i) => {
    const r = await http('POST', '/api/auth/password-sessions', {
      body: { email: organizers[i % organizers.length], password },
    });
    const cookie = r.headers
      .getSetCookie()
      .find((c) => c.startsWith('__Host-ers_org='))
      ?.split(';')[0];
    return { status: r.status, value: cookie };
  });
  const cookie = sessions[0]!;
  const me = await http('GET', '/api/auth/session', { headers: { cookie } });
  const organizer = { cookie, 'x-csrf-token': String(me.json?.csrfToken) };

  // 2. Session validation: every organizer request starts by resolving the session cookie.
  await measure('session validation', 1000, CONCURRENCY, async () => {
    const r = await http('GET', '/api/auth/session', { headers: { cookie } });
    return { status: r.status };
  });

  // 3. Event creation.
  const newEvent = (title: string, capacity: number) =>
    http('POST', '/api/events', {
      headers: organizer,
      body: {
        requestId: randomUUID(),
        title,
        description: 'Synthetic event for the load measurements',
        localStart: new Date(Date.now() + 48 * 3_600_000).toISOString().slice(0, 16),
        timeZone: 'UTC',
        capacity,
      },
    });
  const extraEvents = await measure('event creation', 50, 8, async (i) => {
    const r = await newEvent(`Load measurement ${i}`, 1);
    return { status: r.status, value: (r.json as { event?: { id: string; publicId: string } })?.event };
  });

  // The main event: capacity CAPACITY, two days ahead (registration open).
  const created = await newEvent('Load measurement', CAPACITY);
  if (created.status !== 201) throw new Error(`event not created: ${created.status}`);
  const event = (created.json as { event: { id: string; publicId: string } }).event;

  // 4. The public event page's data: read by every visitor, and polled every 15 s by open pages
  // (the live availability).
  await measure('public event page and availability poll', 2000, CONCURRENCY, async () => {
    const r = await http('GET', `/api/public/events/${event.publicId}`);
    return { status: r.status };
  });

  // 5. Registration requests (each writes the registration and its verification email in one transaction).
  const emails = Array.from({ length: PARTICIPANTS }, (_, i) => `participant${i}@bench.example.test`);
  const registeredAt = performance.now();
  await measure('registration request', PARTICIPANTS, CONCURRENCY, async (i) => {
    const r = await http('POST', `/api/public/events/${event.publicId}/registrations`, {
      body: { email: emails[i] },
    });
    return { status: r.status };
  });

  // 6. Email throughput: the worker sends every verification email (fake provider: a file per email).
  const verificationMails = () =>
    readMailbox(MAILBOX).filter((m) => m.subject.startsWith('Confirm your registration'));
  const requestsDoneAfter = (performance.now() - registeredAt) / 1000;
  await waitFor(() => verificationMails().length >= PARTICIPANTS, 300_000, 'verification emails');
  const emailSeconds = (performance.now() - registeredAt) / 1000;
  checks.verificationEmails = {
    count: verificationMails().length,
    secondsFromFirstRequest: Math.round(emailSeconds * 10) / 10,
    secondsAfterLastRequest: Math.round((emailSeconds - requestsDoneAfter) * 10) / 10,
    emailsPerSecondOverall: Math.round(PARTICIPANTS / emailSeconds),
  };
  console.log(
    `verification emails: ${PARTICIPANTS} sent ${emailSeconds.toFixed(1)} s after the first request`,
  );
  const tokenFor = new Map<string, string>();
  for (const m of verificationMails()) tokenFor.set(m.to, /\/verify#t=([A-Za-z0-9_-]{43})/.exec(m.text)![1]!);

  // 7. Verification under contention: everyone confirms at once; the event lock orders them.
  const confirmations = await measure('verification (confirm)', PARTICIPANTS, CONCURRENCY, async (i) => {
    const r = await http('POST', '/api/links/verify/confirm', {
      headers: { authorization: `Link ${tokenFor.get(emails[i]!)}` },
    });
    return { status: r.status, value: r.json };
  });
  const confirmed = confirmations.filter((c) => (c as { result?: string })?.result === 'confirmed');
  const counts = await owner.query(
    `SELECT count(*) FILTER (WHERE state = 'CONFIRMED')::int AS confirmed,
            count(*) FILTER (WHERE state = 'WAITLISTED')::int AS waitlisted,
            count(DISTINCT waitlist_seq) FILTER (WHERE state = 'WAITLISTED')::int AS distinct_places,
            (SELECT count(*)::int FROM app.tickets WHERE event_id = $1) AS tickets
       FROM app.registrations WHERE event_id = $1`,
    [event.id],
  );
  const row = counts.rows[0] as {
    confirmed: number;
    waitlisted: number;
    distinct_places: number;
    tickets: number;
  };
  checks.afterVerification = {
    confirmed: row.confirmed,
    waitlisted: row.waitlisted,
    tickets: row.tickets,
    confirmedResponses: confirmed.length,
    everyWaitingPlaceDistinct: row.distinct_places === row.waitlisted,
    expected: {
      confirmed: Math.min(CAPACITY, PARTICIPANTS),
      waitlisted: Math.max(0, PARTICIPANTS - CAPACITY),
    },
  };
  console.log('after verification:', JSON.stringify(checks.afterVerification));

  // 8. The last seat: fifty participants of a capacity-1 event confirm at the same moment.
  const lastSeat = extraEvents[0]!;
  const seatEmails = Array.from({ length: 50 }, (_, i) => `seat${i}@bench.example.test`);
  for (const email of seatEmails)
    await http('POST', `/api/public/events/${lastSeat.publicId}/registrations`, { body: { email } });
  const seatMails = () =>
    readMailbox(MAILBOX).filter(
      (m) => seatEmails.includes(m.to) && m.subject.startsWith('Confirm your registration'),
    );
  await waitFor(() => seatMails().length >= seatEmails.length, 120_000, 'last-seat verification emails');
  const seatTokens = seatMails().map((m) => /\/verify#t=([A-Za-z0-9_-]{43})/.exec(m.text)![1]!);
  const seatResults = await measure('last seat: 50 confirmations at once', 50, 50, async (i) => {
    const r = await http('POST', '/api/links/verify/confirm', {
      headers: { authorization: `Link ${seatTokens[i]}` },
    });
    return { status: r.status, value: String(r.json?.result) };
  });
  checks.lastSeat = seatResults.reduce<Record<string, number>>(
    (acc, o) => ({ ...acc, [o!]: (acc[o!] ?? 0) + 1 }),
    {},
  );

  // 9. Concurrent cancellations with waiting-list promotion: fifty confirmed participants cancel at
  // once; each frees a seat for the first waiting participant, who is emailed.
  const cancelling = confirmed.slice(0, 50) as { links: { management: string } }[];
  const cancelStarted = performance.now();
  await measure(
    'cancellation with promotion (50 at once)',
    cancelling.length,
    cancelling.length,
    async (i) => {
      const r = await http('POST', '/api/links/manage/cancel', {
        headers: { authorization: `Link ${cancelling[i]!.links.management.split('#t=')[1]}` },
        body: { confirmed: true },
      });
      return { status: r.status };
    },
  );
  const promotionsSent = async () =>
    (
      await owner.query(
        `SELECT count(*)::int AS n FROM app.outbox_messages
          WHERE event_id = $1 AND message_type = 'promotion' AND status = 'ACCEPTED'`,
        [event.id],
      )
    ).rows[0].n as number;
  await waitFor(async () => (await promotionsSent()) >= cancelling.length, 120_000, 'promotion emails');
  const afterCancel = (
    await owner.query(
      `SELECT count(*) FILTER (WHERE state = 'CONFIRMED')::int AS confirmed,
              count(*) FILTER (WHERE state = 'WAITLISTED')::int AS waitlisted,
              count(*) FILTER (WHERE state = 'CANCELLED')::int AS cancelled
         FROM app.registrations WHERE event_id = $1`,
      [event.id],
    )
  ).rows[0];
  checks.cancellationAndPromotion = {
    ...afterCancel,
    promotionEmailsSent: await promotionsSent(),
    secondsUntilAllPromotionEmailsSent: Math.round((performance.now() - cancelStarted) / 100) / 10,
  };
  console.log('after cancellations:', JSON.stringify(checks.cancellationAndPromotion));

  // 10. The organizer's dashboard, polled every 15 s by each open organizer page, and the participant list.
  await measure('organizer dashboard poll', 1000, CONCURRENCY, async () => {
    const r = await http('GET', `/api/events/${event.id}/dashboard`, { headers: organizer });
    return { status: r.status };
  });
  await measure('organizer participant list', 200, 8, async () => {
    const r = await http('GET', `/api/events/${event.id}/participants`, { headers: organizer });
    return { status: r.status };
  });
  // The whole list, page by page, as the organizer page loads it.
  const listed: { registrationId: string; state: string; position?: number }[] = [];
  let pages = 0;
  for (let cursor: string | null = null; ;) {
    const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const r = await http('GET', `/api/events/${event.id}/participants${query}`, { headers: organizer });
    pages += 1;
    listed.push(...((r.json?.items ?? []) as typeof listed));
    cursor = (r.json?.nextCursor as string | null | undefined) ?? null;
    if (!cursor) break;
  }
  const positions = listed
    .filter((p) => p.state === 'WAITLISTED')
    .map((p) => p.position ?? 0)
    .sort((a, b) => a - b);
  checks.participantList = {
    pages,
    items: listed.length,
    distinctItems: new Set(listed.map((p) => p.registrationId)).size,
    waitingPositionsAreOneToN: positions.length > 0 && positions.every((p, i) => p === i + 1),
  };

  // 11. Check-in at the door: the event is moved into its check-in window (setup, owner role).
  await owner.query(`UPDATE app.events SET starts_at = now() + interval '1 hour' WHERE id = $1`, [event.id]);
  const codes = confirmed.slice(50).map((c) => (c as { ticket: { code: string } }).ticket.code);
  const reserved = codes.pop(); // kept for the ten-devices check below
  const outcomes = await measure('check-in', codes.length, 16, async (i) => {
    const r = await http('POST', `/api/events/${event.id}/check-ins`, {
      headers: organizer,
      body: { code: codes[i], requestId: randomUUID() },
    });
    return { status: r.status, value: String(r.json?.outcome) };
  });
  checks.checkIns = outcomes.reduce<Record<string, number>>(
    (acc, o) => ({ ...acc, [o!]: (acc[o!] ?? 0) + 1 }),
    {},
  );
  // 12. Live counts: 200 open dashboards and staff phones (server-sent events); the time until every
  // one of them receives the new count after a check-in.
  const STREAMS = 200;
  const aborter = new AbortController();
  const received: number[] = [];
  let checkInSentAt = 0;
  const expectedCount = codes.length + 1; // after the reserved ticket below is admitted
  const streams = await Promise.all(
    Array.from({ length: STREAMS }, async () => {
      const r = await fetch(`${BASE}/api/events/${event.id}/live`, {
        headers: { cookie, 'x-forwarded-for': nextIp() },
        signal: aborter.signal,
      });
      const reader = r.body!.getReader();
      void (async () => {
        // Only what arrives after the check-in counts, and only the new count (each stream also
        // receives the current count when it opens).
        let text = '';
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) return;
            if (!checkInSentAt) continue;
            text += Buffer.from(value).toString('utf8');
            if (text.includes(`event: count\ndata: {"checkedIn":${expectedCount}}`)) {
              received.push(performance.now() - checkInSentAt);
              return;
            }
          }
        } catch {
          /* aborted */
        }
      })();
      return r.status;
    }),
  );
  await new Promise((r) => setTimeout(r, 1000)); // every stream has received its opening count
  const memoryWithStreams = { web: memoryOf(web.pid!) };

  // The same ticket scanned by ten devices at once: exactly one admission (and one live update).
  if (reserved) {
    checkInSentAt = performance.now();
    const same = await Promise.all(
      Array.from({ length: 10 }, () =>
        http('POST', `/api/events/${event.id}/check-ins`, {
          headers: organizer,
          body: { code: reserved, requestId: randomUUID() },
        }),
      ),
    );
    checks.sameTicketTenAtOnce = same.reduce<Record<string, number>>((acc, r) => {
      const o = String(r.json?.outcome);
      return { ...acc, [o]: (acc[o] ?? 0) + 1 };
    }, {});
  }
  await waitFor(() => received.length >= STREAMS, 15_000, 'live updates').catch(() => undefined);
  received.sort((a, b) => a - b);
  checks.liveStreams = {
    opened: streams.filter((st) => st === 200).length,
    receivedUpdate: received.length,
    msUntilUpdate: {
      p50: percentile(received, 50),
      p95: percentile(received, 95),
      max: percentile(received, 100),
    },
    webMemoryMbWithStreamsOpen: memoryWithStreams.web,
  };
  console.log('live updates:', JSON.stringify(checks.liveStreams));
  aborter.abort();

  // 13. Image upload and processing (a 3000 x 2000 photograph-like image, re-encoded to WebP).
  const photo = await sharp({
    create: {
      width: 3000,
      height: 2000,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
    .jpeg({ quality: 85 })
    .toBuffer();
  checks.uploadBytes = photo.length;
  const uploads = await measure('image upload (3000 x 2000 JPEG)', 6, 1, async (i) => {
    const r = await http('POST', `/api/events/${event.id}/images?role=${i === 0 ? 'cover' : 'gallery'}`, {
      headers: { ...organizer, 'content-type': 'image/jpeg' },
      body: photo,
    });
    return { status: r.status, value: r.json as { url: string } | undefined };
  });

  // 14. Image downloads (the processed WebP files, as the event page loads them).
  const imageUrls = uploads.map((u) => u!.url);
  let downloadedBytes = 0;
  await measure('image download', 2000, CONCURRENCY, async (i) => {
    const r = await fetch(BASE + imageUrls[i % imageUrls.length], {
      headers: { 'x-forwarded-for': nextIp() },
    });
    downloadedBytes += (await r.arrayBuffer()).byteLength;
    return { status: r.status };
  });
  checks.imageDownloadAverageBytes = Math.round(downloadedBytes / 2000);

  const memoryAtEnd = { web: memoryOf(web.pid!), worker: memoryOf(worker.pid!) };
  clearInterval(sampling);
  await sampler.end();
  const statsAtEnd = await dbStats(owner);
  const hit = statsAtEnd.blks_hit - statsAtStart.blks_hit;
  const read = statsAtEnd.blks_read - statsAtStart.blks_read;
  const database = {
    ...Object.fromEntries(
      Object.keys(statsAtEnd).map((k) => [
        k,
        statsAtEnd[k as keyof DbStats] - statsAtStart[k as keyof DbStats],
      ]),
    ),
    cacheHitRatio: Math.round((hit / Math.max(1, hit + read)) * 10000) / 10000,
    maxConnections: connections.max,
    maxActiveConnections: connections.active,
  };
  const errors = results.map((r) => ({
    name: r.name,
    non2xx: Object.entries(r.statuses)
      .filter(([status]) => !status.startsWith('2'))
      .reduce((n, [, c]) => n + c, 0),
  }));
  const ready = await http('GET', '/readyz');
  const pgVersion = (await owner.query('SHOW server_version')).rows[0].server_version as string;
  const report = {
    at: new Date().toISOString(),
    machine: {
      cpu: cpus()[0]?.model,
      cores: cpus().length,
      memoryGb: Math.round(totalmem() / 1e9),
      freeMemoryGbAtEnd: Math.round(freemem() / 1e9),
      platform: process.platform,
      node: process.version,
      postgres: pgVersion,
    },
    setup: {
      participants: PARTICIPANTS,
      capacity: CAPACITY,
      concurrency: CONCURRENCY,
      mode: 'built web and worker, NODE_ENV=development (debug logging), fake email provider',
    },
    results,
    errors,
    checks,
    database,
    memoryMb: { atStart: memoryAtStart, atEnd: memoryAtEnd },
    readyAtEnd: ready.json,
  };
  mkdirSync(resolve(REPO, 'var/bench'), { recursive: true });
  const file = resolve(REPO, `var/bench/${report.at.replaceAll(':', '-')}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({ machine: report.machine, errors, checks, database, memoryMb: report.memoryMb }, null, 2),
  );
  console.log(`written to ${file}`);
} finally {
  stopping = true;
  for (const child of children) child.kill();
  await owner.end();
}
