import { buildWebApp } from '../composition/web-app.js';
import { loadConfigOrExit } from '../platform/config.js';
import { createDatabase } from '../platform/db.js';
import { assertSchemaVersion } from '../platform/migrations.js';
import { LiveHub } from '../modules/reporting/live.js';

const config = loadConfigOrExit();
try {
  await assertSchemaVersion(config.DATABASE_URL);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}
const db = createDatabase(config.DATABASE_URL);
const liveHub = new LiveHub(config.DATABASE_URL);
await liveHub.start();
const app = await buildWebApp(config, db, { liveHub });

const shutdown = async () => {
  await app.close();
  await liveHub.stop();
  await db.destroy();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('unhandledRejection', (error) => {
  app.log.error({ err: error }, 'unhandled rejection');
  process.exit(1);
});

await app.listen({ host: config.HOST, port: config.PORT });
