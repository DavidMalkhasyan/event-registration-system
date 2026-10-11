import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
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

const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  PORT: String(E2E_PORT),
  PUBLIC_ORIGIN: ORIGIN,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  DEV_MAILBOX_DIR: E2E_MAILBOX,
  CLIENT_DIST_DIR: resolve(REPO_ROOT, 'apps/client/dist'),
};
const server = resolve(REPO_ROOT, 'apps/server');
const children: ChildProcess[] = ['web', 'worker'].map((name) =>
  spawn(process.execPath, ['--import', 'tsx', `src/entrypoints/${name}.ts`], {
    cwd: server,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  }),
);
for (const child of children) child.on('exit', (code) => process.exit(code ?? 1));
const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
