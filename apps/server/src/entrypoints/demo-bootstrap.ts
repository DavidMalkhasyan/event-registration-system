import { DEMO_ADMIN_PASSWORD, DEMO_ORGANIZER_PASSWORD, SeedError, assertLocal } from '../demo/accounts.js';
import { ConfigError, requireEnv } from '../platform/config.js';

// Local Docker demo only (compose.demo.yaml, service `demo-bootstrap`): runs after the migrations and
// before the web server and worker. Needs DEMO_MODE=true, refuses production and non-local database
// hosts, then fills the demo data and the two accounts with their static demo passwords (seed-demo.ts,
// idempotent: existing accounts and events are never changed).

try {
  if (process.env.DEMO_MODE !== 'true') throw new SeedError('demo-bootstrap needs DEMO_MODE=true');
  assertLocal(requireEnv('MIGRATION_DATABASE_URL'));
  process.env.DEMO_ORGANIZER_PASSWORD = DEMO_ORGANIZER_PASSWORD;
  process.env.DEMO_ADMIN_PASSWORD = DEMO_ADMIN_PASSWORD;
  await import('./seed-demo.js'); // creates the organizer, the Super Admin and the six events
} catch (error) {
  const known = error instanceof SeedError || error instanceof ConfigError;
  process.stderr.write(
    `${known ? (error as Error).message : 'demo-bootstrap failed: ' + (error as Error).message}\n`,
  );
  process.exit(1);
}
