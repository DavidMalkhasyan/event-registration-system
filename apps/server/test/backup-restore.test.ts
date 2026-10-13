import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backup, restoreDrill } from '../src/ops/backup.js';
import {
  ORIGIN,
  createEvent,
  createHarness,
  organizerHeaders,
  registerConfirmed,
  resetData,
  signIn,
  type Harness,
} from './harness.js';

// K-721 (PD-101): a backup is trusted only after a restore drill. This test makes a real backup of the
// test database and its media (pg_dump), restores it into a throwaway database (pg_restore) and checks
// it, then shows that a damaged backup is caught. It needs RESTORE_ADMIN_URL (a role that may create
// databases, as in CI) and the PostgreSQL client tools on PATH (or PG_BIN); without them it is skipped
// and says so.

const ADMIN_URL = process.env.RESTORE_ADMIN_URL;
const run = ADMIN_URL ? describe : describe.skip;
if (!ADMIN_URL) console.warn('backup-restore.test.ts skipped: RESTORE_ADMIN_URL is not set');

let h: Harness;
let work: string;
beforeAll(async () => {
  h = await createHarness();
  work = mkdtempSync(join(tmpdir(), 'ers-backup-'));
});
afterAll(async () => {
  await h.close();
  rmSync(work, { recursive: true, force: true });
});

run('backup and restore drill', () => {
  it('restores registrations, ownership, tickets, check-ins, staff and images exactly, and drops the drill database', async () => {
    await resetData(h);
    const owner = await signIn(h, 'owner@example.test');
    const event = await createEvent(h, owner, { capacity: 1, startsInHours: 48 });
    const anna = await registerConfirmed(h, event.publicId, 'anna@example.test');
    await registerConfirmed(h, event.publicId, 'ben@example.test'); // waiting list
    const image = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/images?role=cover`,
      headers: { ...organizerHeaders(owner), 'content-type': 'image/png' },
      payload: await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ef7959' } })
        .png()
        .toBuffer(),
    });
    expect(image.statusCode).toBe(201);
    const invited = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/staff-invitations`,
      headers: organizerHeaders(owner),
      payload: { email: 'helper@example.test' },
    });
    expect(invited.statusCode).toBe(201);
    await h.owner
      .updateTable('app.events')
      .set({ starts_at: new Date(Date.now() + 3_600_000) }) // into the check-in window for the check-in
      .where('id', '=', event.id)
      .execute();
    const checkIn = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/check-ins`,
      headers: { ...organizerHeaders(owner), origin: ORIGIN },
      payload: { code: anna.ticket.code, requestId: crypto.randomUUID() },
    });
    expect(checkIn.json().outcome).toBe('CHECKED_IN');

    const out = join(work, 'good');
    const manifest = await backup({
      databaseUrl: process.env.TEST_MIGRATION_DATABASE_URL!,
      mediaDir: h.config.MEDIA_DIR,
      outDir: out,
      ...(process.env.PG_BIN ? { pgBin: process.env.PG_BIN } : {}),
    });
    expect(manifest.counts).toMatchObject({
      events: 1,
      registrations: 2,
      tickets: 1,
      check_ins: 1,
      event_images: 1,
      staff_invitations: 1,
    });
    expect(manifest.media.files).toBe(2);
    expect(Object.values(manifest.consistency).every((n) => n === 0)).toBe(true);
    expect(readdirSync(out).sort()).toEqual(['database.dump', 'manifest.json', 'media']);

    const report = await restoreDrill({
      backupDir: out,
      adminUrl: ADMIN_URL!,
      ...(process.env.PG_BIN ? { pgBin: process.env.PG_BIN } : {}),
    });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.counts.registrations).toEqual({ expected: 2, restored: 2 });
    expect(report.counts.organization_memberships).toEqual({ expected: 1, restored: 1 });
    expect(report.media).toEqual({ files: 2, checksumMismatches: [], missingForRows: [] });
    expect(report.dropped).toBe(true);
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    try {
      const left = await admin.query('SELECT datname FROM pg_database WHERE datname = $1', [report.database]);
      expect(left.rowCount).toBe(0);
    } finally {
      await admin.end();
    }
  }, 120_000);

  it('catches a damaged media file in a backup', async () => {
    const out = join(work, 'good');
    const media = join(out, 'media', 'images');
    const [dir] = readdirSync(media);
    const [file] = readdirSync(join(media, dir!));
    writeFileSync(join(media, dir!, file!), 'damaged');
    const report = await restoreDrill({
      backupDir: out,
      adminUrl: ADMIN_URL!,
      ...(process.env.PG_BIN ? { pgBin: process.env.PG_BIN } : {}),
    });
    expect(report.ok).toBe(false);
    expect(report.media.checksumMismatches).toEqual([`${dir}/${file}`]);
    expect(report.dropped).toBe(true);
  }, 120_000);
});
