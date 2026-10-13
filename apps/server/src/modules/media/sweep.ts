import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '../../platform/db.js';

// Orphan image recovery (K-719, PD-100). An upload writes its files before its database row, and a
// replacement or removal deletes the old files after its commit; a crash between the two leaves files
// that no row owns (they are never served: serving needs the row). This sweep finds them and removes
// them conservatively:
//  - only files named as the media storage names them (`<32 hex>.webp`, `<32 hex>-thumb.webp`) or its
//    temporary files (`… .tmp`); anything else is reported and left alone;
//  - only when the database has no row with that key, checked in the same pass, right before deleting;
//  - only when the file is older than the grace period (default 24 hours; at least 1 hour), so an
//    upload in progress (files written, row not yet committed) is never touched;
//  - a dry run (the default of the command) only reports.
// It also reports rows whose files are missing (it cannot restore them: that is what backups are for).
// Logs carry counts and the random keys only.

export const DEFAULT_GRACE_MS = 24 * 3_600_000;
const MIN_GRACE_MS = 3_600_000;
const NAME = /^([0-9a-f]{32})(-thumb)?\.webp$/;
const TEMP = /^[0-9a-f]{32}(-thumb)?\.webp\.[0-9a-f]{12}\.tmp$/;

export interface SweepReport {
  dryRun: boolean;
  scannedFiles: number;
  keptFiles: number;
  orphanKeys: string[];
  removedFiles: number;
  tooRecentOrphans: number;
  staleTemporaryFiles: number;
  unknownFiles: string[];
  rowsWithMissingFiles: string[];
}

async function* walk(dir: string): AsyncGenerator<{ path: string; name: string }> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // no media yet
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield { path, name: entry.name };
  }
}

export async function sweepMedia(
  db: Database,
  mediaDir: string,
  options: { dryRun: boolean; graceMs?: number; nowMs?: number },
): Promise<SweepReport> {
  const graceMs = Math.max(MIN_GRACE_MS, options.graceMs ?? DEFAULT_GRACE_MS);
  const now = options.nowMs ?? Date.now();
  const report: SweepReport = {
    dryRun: options.dryRun,
    scannedFiles: 0,
    keptFiles: 0,
    orphanKeys: [],
    removedFiles: 0,
    tooRecentOrphans: 0,
    staleTemporaryFiles: 0,
    unknownFiles: [],
    rowsWithMissingFiles: [],
  };
  const root = join(mediaDir, 'images');
  const byKey = new Map<string, { path: string; mtimeMs: number }[]>();
  const temporary: { path: string; mtimeMs: number }[] = [];
  for await (const file of walk(root)) {
    report.scannedFiles += 1;
    const info = await stat(file.path);
    const m = NAME.exec(file.name);
    if (m) {
      const list = byKey.get(m[1]!) ?? [];
      list.push({ path: file.path, mtimeMs: info.mtimeMs });
      byKey.set(m[1]!, list);
    } else if (TEMP.test(file.name)) temporary.push({ path: file.path, mtimeMs: info.mtimeMs });
    else report.unknownFiles.push(file.path.slice(root.length + 1));
  }

  // Database ownership, in batches.
  const keys = [...byKey.keys()];
  const owned = new Set<string>();
  for (let i = 0; i < keys.length; i += 500) {
    const rows = await db
      .selectFrom('app.event_images')
      .select('storage_key')
      .where('storage_key', 'in', keys.slice(i, i + 500))
      .execute();
    for (const r of rows) owned.add(r.storage_key);
  }

  for (const [key, files] of byKey) {
    if (owned.has(key)) {
      report.keptFiles += files.length;
      continue;
    }
    if (files.some((f) => now - f.mtimeMs < graceMs)) {
      report.tooRecentOrphans += 1; // maybe an upload in progress: left for a later sweep
      report.keptFiles += files.length;
      continue;
    }
    report.orphanKeys.push(key);
    if (options.dryRun) continue;
    // Checked again just before deleting: a row committed since the first look keeps its files.
    const claimed = await db
      .selectFrom('app.event_images')
      .select('id')
      .where('storage_key', '=', key)
      .executeTakeFirst();
    if (claimed) {
      report.orphanKeys.pop();
      report.keptFiles += files.length;
      continue;
    }
    for (const f of files) {
      await rm(f.path, { force: true });
      report.removedFiles += 1;
    }
  }
  for (const t of temporary) {
    if (now - t.mtimeMs < graceMs) continue;
    report.staleTemporaryFiles += 1;
    if (!options.dryRun) {
      await rm(t.path, { force: true });
      report.removedFiles += 1;
    }
  }

  // Rows whose files are gone (reported only).
  const rows = await db.selectFrom('app.event_images').select('storage_key').execute();
  for (const r of rows) {
    const files = byKey.get(r.storage_key) ?? [];
    if (files.length < 2) report.rowsWithMissingFiles.push(r.storage_key);
  }
  return report;
}
