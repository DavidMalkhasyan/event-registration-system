import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { backup, restoreDrill } from '../ops/backup.js';
import { REPO_ROOT, loadConfigOrExit, requireEnv } from '../platform/config.js';

// K-721 (PD-101): operator commands for backups.
//   pnpm ops:backup [--out <directory>]        database dump + media copy + manifest (default var/backups/<time>)
//   pnpm ops:restore-drill --from <directory>  restore into a throwaway database, check, drop
// Uses MIGRATION_DATABASE_URL (the owner) for the dump and RESTORE_ADMIN_URL (a role that may create
// databases) for the drill; PG_BIN may point to the PostgreSQL client tools. Prints a JSON summary
// (counts and checks; no rows, no secrets).

// Relative paths are relative to where the operator ran the command (pnpm runs it from apps/server).
const fromCaller = (path: string) => resolve(process.env.INIT_CWD ?? process.cwd(), path);

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: { out: { type: 'string' }, from: { type: 'string' }, keep: { type: 'boolean', default: false } },
  strict: true,
});
try {
  if (command === 'backup') {
    const config = loadConfigOrExit();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = values.out ? fromCaller(values.out) : resolve(REPO_ROOT, 'var/backups', stamp);
    const manifest = await backup({
      databaseUrl: requireEnv('MIGRATION_DATABASE_URL'),
      mediaDir: config.MEDIA_DIR,
      outDir,
      ...(process.env.PG_BIN ? { pgBin: process.env.PG_BIN } : {}),
    });
    process.stdout.write(
      `${JSON.stringify({ outDir, schemaVersion: manifest.schemaVersion, counts: manifest.counts, consistency: manifest.consistency, mediaFiles: manifest.media.files, mediaBytes: manifest.media.bytes }, null, 2)}\n` +
        'The backup contains personal data: keep it on encrypted, access-controlled storage, never in Git. Verify it with pnpm ops:restore-drill.\n',
    );
  } else if (command === 'restore-drill') {
    if (!values.from) throw new Error('usage: ops:restore-drill --from <backup directory>');
    const report = await restoreDrill({
      backupDir: fromCaller(values.from),
      adminUrl: requireEnv('RESTORE_ADMIN_URL'),
      keep: values.keep,
      ...(process.env.PG_BIN ? { pgBin: process.env.PG_BIN } : {}),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } else {
    throw new Error('commands: backup, restore-drill');
  }
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
}
