import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LocalMediaStorage, newMediaKey } from '../src/modules/media/storage.js';
import { sweepMedia } from '../src/modules/media/sweep.js';
import { createEvent, createHarness, organizerHeaders, resetData, signIn, type Harness } from './harness.js';

// K-719 (PD-100): orphan recovery after crashes. Only files the storage names, that no row owns, older than
// the grace period are removed; a dry run removes nothing; legitimate images are never touched.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const png = () =>
  sharp({ create: { width: 400, height: 300, channels: 3, background: '#5d7f5f' } })
    .png()
    .toBuffer();
const twoDaysAgo = () => new Date(Date.now() - 2 * 86_400_000);
const age = (path: string) => utimesSync(path, twoDaysAgo(), twoDaysAgo());
const fileOf = (key: string, thumb = false) =>
  join(h.config.MEDIA_DIR, 'images', key.slice(0, 2), `${key}${thumb ? '-thumb' : ''}.webp`);

async function scene() {
  const owner = await signIn(h, 'owner@example.test');
  const event = await createEvent(h, owner, { capacity: 3, startsInHours: 48 });
  const upload = async () =>
    (
      await h.app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/images?role=gallery`,
        headers: { ...organizerHeaders(owner), 'content-type': 'image/png' },
        payload: await png(),
      })
    ).json() as { url: string };
  const kept = await upload();
  const lost = await upload();
  const keyOf = (url: string) => url.slice('/media/images/'.length, -'.webp'.length);
  const keptKey = keyOf(kept.url);
  const lostKey = keyOf(lost.url);
  for (const k of [keptKey, lostKey]) for (const t of [false, true]) age(fileOf(k, t)); // old, legitimate
  // A row whose files were lost (for example a disk restored from an older copy).
  rmSync(fileOf(lostKey), { force: true });
  rmSync(fileOf(lostKey, true), { force: true });

  const storage = new LocalMediaStorage(h.config.MEDIA_DIR);
  const thumb = Buffer.from('thumb');
  // A crash after the files were written, before the row was committed (two days ago).
  const crashed = newMediaKey();
  await storage.put(crashed, { full: Buffer.from('full'), thumb });
  age(fileOf(crashed));
  age(fileOf(crashed, true));
  // An upload in progress right now: files written, row not yet committed.
  const inProgress = newMediaKey();
  await storage.put(inProgress, { full: Buffer.from('full'), thumb });
  // A temporary file left by an interrupted write, and a file the storage never names.
  const temp = join(h.config.MEDIA_DIR, 'images', crashed.slice(0, 2), `${crashed}.webp.0123456789ab.tmp`);
  writeFileSync(temp, 'partial');
  age(temp);
  const unknown = join(h.config.MEDIA_DIR, 'images', 'README.txt');
  writeFileSync(unknown, 'operator notes');
  age(unknown);
  return { kept, keptKey, lostKey, crashed, inProgress, temp, unknown };
}

describe('the media sweep', () => {
  it('reports without removing anything in a dry run', async () => {
    const s = await scene();
    const report = await sweepMedia(h.db, h.config.MEDIA_DIR, { dryRun: true });
    expect(report).toMatchObject({
      dryRun: true,
      orphanKeys: [s.crashed],
      tooRecentOrphans: 1,
      staleTemporaryFiles: 1,
      unknownFiles: ['README.txt'],
      rowsWithMissingFiles: [s.lostKey],
      removedFiles: 0,
    });
    for (const p of [fileOf(s.crashed), s.temp, fileOf(s.inProgress), s.unknown])
      expect(existsSync(p)).toBe(true);
  });

  it('removes only old orphans and temporary files; owned, recent and unknown files stay', async () => {
    const s = await scene();
    const report = await sweepMedia(h.db, h.config.MEDIA_DIR, { dryRun: false });
    expect(report).toMatchObject({ orphanKeys: [s.crashed], removedFiles: 3, staleTemporaryFiles: 1 });
    expect(existsSync(fileOf(s.crashed))).toBe(false);
    expect(existsSync(fileOf(s.crashed, true))).toBe(false);
    expect(existsSync(s.temp)).toBe(false);
    expect(existsSync(fileOf(s.inProgress))).toBe(true); // within the grace period
    expect(existsSync(s.unknown)).toBe(true); // never named by the storage: left alone
    expect(existsSync(fileOf(s.keptKey))).toBe(true);
    expect((await h.app.inject({ method: 'GET', url: s.kept.url })).statusCode).toBe(200);
    // A second sweep finds nothing more to do.
    const again = await sweepMedia(h.db, h.config.MEDIA_DIR, { dryRun: false });
    expect(again).toMatchObject({ orphanKeys: [], removedFiles: 0 });
  });

  it('never uses a grace period shorter than an hour', async () => {
    const s = await scene();
    const report = await sweepMedia(h.db, h.config.MEDIA_DIR, { dryRun: false, graceMs: 0 });
    expect(report.tooRecentOrphans).toBe(1);
    expect(existsSync(fileOf(s.inProgress))).toBe(true);
  });

  it('copes with an empty or missing media directory', async () => {
    const report = await sweepMedia(h.db, join(tmpdir(), `ers-none-${Date.now()}`), { dryRun: true });
    expect(report).toMatchObject({ scannedFiles: 0, orphanKeys: [], rowsWithMissingFiles: [] });
  });
});

describe('a failing media disk', () => {
  it('answers 503 and records nothing when the files cannot be written', async () => {
    const blocked = join(tmpdir(), `ers-blocked-${Date.now()}`);
    const broken = await createHarness({ MEDIA_DIR: blocked });
    try {
      await resetData(broken); // (empties the media directory)
      writeFileSync(blocked, 'not a directory'); // the media directory path is now a file: every write fails
      const owner = await signIn(broken, 'owner@example.test');
      const event = await createEvent(broken, owner, { capacity: 3, startsInHours: 48 });
      const r = await broken.app.inject({
        method: 'POST',
        url: `/api/events/${event.id}/images?role=gallery`,
        headers: { ...organizerHeaders(owner), 'content-type': 'image/png' },
        payload: await png(),
      });
      expect(r.statusCode).toBe(503);
      expect(r.json().code).toBe('media_storage_unavailable');
      expect(await broken.db.selectFrom('app.event_images').select('id').execute()).toEqual([]);
    } finally {
      await broken.close();
      rmSync(blocked, { force: true, recursive: true });
      mkdirSync(h.config.MEDIA_DIR, { recursive: true });
    }
  });
});
