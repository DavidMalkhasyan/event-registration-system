import { ConfigError, requireEnv } from '../platform/config.js';
import { runMigrations } from '../platform/migrations.js';

// The only process that applies migrations (ENG-CI-6).
try {
  const url = requireEnv('MIGRATION_DATABASE_URL');
  const count = await runMigrations(url, (line) => process.stdout.write(`${line}\n`));
  process.stdout.write(count === 0 ? 'schema is up to date\n' : `${count} migration(s) applied\n`);
} catch (error) {
  process.stderr.write(`${error instanceof ConfigError ? error.message : (error as Error).message}\n`);
  process.exit(1);
}
