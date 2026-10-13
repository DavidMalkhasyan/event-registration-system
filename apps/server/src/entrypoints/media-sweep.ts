import { parseArgs } from 'node:util';
import { loadConfigOrExit } from '../platform/config.js';
import { createDatabase } from '../platform/db.js';
import { DEFAULT_GRACE_MS, sweepMedia } from '../modules/media/sweep.js';

// K-719 (PD-100): `pnpm media:sweep` reports image files that no database row owns (a dry run);
// `pnpm media:sweep --apply` removes those older than the grace period (`--grace-hours`, default 24,
// at least 1). Prints a summary with counts and random file keys only.

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { apply: { type: 'boolean', default: false }, 'grace-hours': { type: 'string' } },
  strict: true,
});
const config = loadConfigOrExit();
const db = createDatabase(config.DATABASE_URL, 1);
try {
  const graceHours = values['grace-hours'] ? Number(values['grace-hours']) : DEFAULT_GRACE_MS / 3_600_000;
  if (!Number.isFinite(graceHours) || graceHours < 1) throw new Error('--grace-hours must be at least 1');
  const report = await sweepMedia(db, config.MEDIA_DIR, {
    dryRun: !values.apply,
    graceMs: graceHours * 3_600_000,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.dryRun && report.orphanKeys.length + report.staleTemporaryFiles > 0)
    process.stdout.write(
      'Dry run: nothing was removed. Run with --apply to remove the files listed above.\n',
    );
} catch (error) {
  process.stderr.write(`media sweep failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
