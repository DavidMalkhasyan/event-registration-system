import { createDatabase } from '../platform/db.js';
import { ConfigError, requireEnv } from '../platform/config.js';
import { SeedError, assertLocal, ensureDemoAdminTotp } from '../demo/accounts.js';

// Local demo only (compose.demo.yaml, service `demo-bootstrap`): runs after the migrations and before
// the web server and worker. Refuses production and non-local database hosts, then fills the demo data
// and accounts (seed-demo.ts, idempotent) and enrols the demo Super Admin's second factor (once).
// It prints no password and no secret, so its container log is safe to keep.

try {
  assertLocal(requireEnv('MIGRATION_DATABASE_URL'));
  await import('./seed-demo.js'); // creates the organizer, the Super Admin and the six events
  const db = createDatabase(requireEnv('MIGRATION_DATABASE_URL'), 1);
  try {
    const enrolled = await ensureDemoAdminTotp(
      db,
      process.env.ADMIN_TOTP_KEY,
      process.env.DEMO_ADMIN_TOTP_SECRET,
    );
    process.stdout.write(`Demo Super Admin second factor: ${enrolled ? 'enrolled' : 'already enrolled'}.\n`);
  } finally {
    await db.destroy();
  }
} catch (error) {
  const known = error instanceof SeedError || error instanceof ConfigError;
  process.stderr.write(
    `${known ? (error as Error).message : 'demo-bootstrap failed: ' + (error as Error).message}\n`,
  );
  process.exit(1);
}
