import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { crc32, deflateSync } from 'node:zlib';
import { mkdirSync, openSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import resetTestDatabase from '../server/test/global-setup.js';
import { E2E_MAILBOX, E2E_PORT, ORIGIN, REPO_ROOT } from './tests/env.js';

// Starts the system the way it runs for real, against the test database: the built client is
// served by the web process (one origin, ADR-013), and a separate worker process sends email
// through the fake provider. The test database is recreated first, so every run starts empty.

const build = spawnSync('pnpm --filter @ers/client build', {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);

await resetTestDatabase(); // loads .env, drops the "app" schema of the test database, applies migrations
rmSync(E2E_MAILBOX, { recursive: true, force: true });
rmSync(resolve(REPO_ROOT, 'var/e2e-media'), { recursive: true, force: true });
rmSync(resolve(REPO_ROOT, 'var/e2e-tile-cache'), { recursive: true, force: true });

// K-714: a local stand-in for the map tile service, so browser tests never contact OpenStreetMap. It
// answers each tile with a small PNG and caching headers, and fails for the southern hemisphere, which
// the tests use to check the map's error handling.
const TILE_PORT = E2E_PORT + 99;
function solidPng(size: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + size * 3, 0xe4);
  row[0] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const TILE = solidPng(256);
const tileServer = createServer((req, res) => {
  const m = /^\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(req.url ?? '');
  if (!m) return void res.writeHead(404).end();
  const [z, y] = [Number(m[1]), Number(m[3])];
  if (y >= 2 ** (z - 1)) return void res.writeHead(500).end('unavailable');
  res
    .writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=86400', etag: '"stub"' })
    .end(TILE);
});
tileServer.listen(TILE_PORT, '127.0.0.1');

const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: String(E2E_PORT),
  PUBLIC_ORIGIN: ORIGIN,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  DEV_MAILBOX_DIR: E2E_MAILBOX,
  MEDIA_DIR: resolve(REPO_ROOT, 'var/e2e-media'),
  MAP_TILE_URL: `http://127.0.0.1:${TILE_PORT}/tiles/{z}/{x}/{y}.png`,
  MAP_TILE_CONTACT: 'https://github.com/DavidMalkhasyan/event-registration-system (browser tests)',
  TILE_CACHE_DIR: resolve(REPO_ROOT, 'var/e2e-tile-cache'),
  CLIENT_DIST_DIR: resolve(REPO_ROOT, 'apps/client/dist'),
};
const server = resolve(REPO_ROOT, 'apps/server');
// K-722: each process's log is kept in var/e2e-logs, so the audit can check that no link token is ever
// written to a log (ENG-ERR-6) by the real processes, not only in the server's own tests.
const LOGS = resolve(REPO_ROOT, 'var/e2e-logs');
rmSync(LOGS, { recursive: true, force: true });
mkdirSync(LOGS, { recursive: true });
const children: ChildProcess[] = ['web', 'worker'].map((name) =>
  spawn(process.execPath, ['--import', 'tsx', `src/entrypoints/${name}.ts`], {
    cwd: server,
    env,
    stdio: ['ignore', openSync(resolve(LOGS, `${name}.log`), 'a'), 'inherit'],
  }),
);
for (const child of children) child.on('exit', (code) => process.exit(code ?? 1));
const stop = () => {
  for (const child of children) child.kill();
  tileServer.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
