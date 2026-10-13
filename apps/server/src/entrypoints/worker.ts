import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { loadConfigOrExit } from '../platform/config.js';
import { createDatabase } from '../platform/db.js';
import { assertSchemaVersion } from '../platform/migrations.js';
import { Dispatcher } from '../modules/messaging/dispatcher.js';
import { emailProviderFor } from '../modules/messaging/providers.js';
import { runDueTasks } from '../modules/jobs/tasks.js';

const config = loadConfigOrExit();
try {
  await assertSchemaVersion(config.DATABASE_URL);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}
const db = createDatabase(config.DATABASE_URL);
const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const dispatcher = new Dispatcher(db, emailProviderFor(config), config.PUBLIC_ORIGIN, workerId);

let running = true;
process.on('SIGINT', () => (running = false));
process.on('SIGTERM', () => (running = false));
process.on('unhandledRejection', (error) => {
  process.stderr.write(`unhandled rejection: ${(error as Error).message}\n`);
  process.exit(1);
});

process.stdout.write(`worker ${workerId} started (email provider: ${config.EMAIL_PROVIDER})\n`);
while (running) {
  let worked = 0;
  try {
    worked += await runDueTasks(db, randomUUID());
    worked += await dispatcher.runOnce();
  } catch (error) {
    // One failed unit of work never stops the worker (ENG-ERR-5).
    process.stderr.write(`worker iteration failed: ${(error as Error).message}\n`);
  }
  if (worked === 0) await new Promise((r) => setTimeout(r, 500));
}
await db.destroy();
