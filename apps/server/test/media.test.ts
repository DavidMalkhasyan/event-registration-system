import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  createEvent,
  createHarness,
  organizerHeaders,
  reauthenticate,
  resetData,
  signIn,
  type Harness,
  type Session,
} from './harness.js';

// K-712 (amendment A-4, PD-92): event images. Content-checked uploads, server-side re-encoding without
// metadata, files outside the database under random names, same-origin serving, limits and order.

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => resetData(h));

const SECRET_EXIF = 'Secret Photographer 47.3769N 8.5417E';

/** A real JPEG with EXIF (author, orientation) as a phone would write it. */
async function jpeg(width = 1200, height = 800, orientation?: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 90 } } })
    .jpeg({ quality: 90 })
    .withExif({ IFD0: { Artist: SECRET_EXIF, Copyright: SECRET_EXIF } })
    .withMetadata(orientation ? { orientation } : {})
    .toBuffer();
}
const png = (w = 400, h2 = 300) =>
  sharp({ create: { width: w, height: h2, channels: 4, background: '#5d7f5f' } })
    .png()
    .toBuffer();

/** A complete, 66-byte PNG whose header claims 50 000 × 50 000 pixels (a decompression bomb). */
function hugePngHeader(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(50_000, 0);
  ihdr.writeUInt32BE(50_000, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(1))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function upload(s: Session, eventId: string, body: Buffer, role = 'gallery', type = 'image/jpeg') {
  return h.app.inject({
    method: 'POST',
    url: `/api/events/${eventId}/images?role=${role}`,
    headers: { ...organizerHeaders(s), 'content-type': type },
    payload: body,
  });
}
const get = (url: string, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url, headers });
const send = (s: Session, method: 'PUT' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  h.app.inject({
    method,
    url,
    headers: organizerHeaders(s),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

function filesIn(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true }))
    if (entry.isFile()) out.push(entry.name);
  return out;
}

async function setup() {
  const owner = await signIn(h, 'owner@example.test');
  const event = await createEvent(h, owner, { capacity: 5, startsInHours: 48 });
  return { owner, event };
}

describe('intake', () => {
  it('re-encodes an upload as WebP without its metadata, under a random name, outside the database', async () => {
    const { owner, event } = await setup();
    const original = await jpeg(3000, 2000);
    expect(original.toString('latin1')).toContain(SECRET_EXIF);
    const r = await upload(owner, event.id, original, 'cover');
    expect(r.statusCode).toBe(201);
    const image = r.json();
    expect(image).toMatchObject({ role: 'cover', position: 0, width: 2000, height: 1333, alt: null });
    expect(image.url).toMatch(/^\/media\/images\/[0-9a-f]{32}\.webp$/);
    expect(image.thumbnailUrl).toMatch(/^\/media\/images\/[0-9a-f]{32}-thumb\.webp$/);

    const served = await get(image.url);
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(served.headers['cache-control']).toContain('immutable');
    const body = served.rawPayload;
    expect(body.toString('latin1')).not.toContain(SECRET_EXIF);
    const meta = await sharp(body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    const thumb = await sharp((await get(image.thumbnailUrl)).rawPayload).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(640);

    // Only metadata in the database; the two files in the media directory.
    const row = await h.db.selectFrom('app.event_images').selectAll().executeTakeFirstOrThrow();
    expect(Object.values(row).some((v) => Buffer.isBuffer(v))).toBe(false);
    const key = image.url.slice('/media/images/'.length, -'.webp'.length);
    expect(filesIn(h.config.MEDIA_DIR).sort()).toEqual([`${key}-thumb.webp`, `${key}.webp`]);
  });

  it('applies the camera orientation before removing it', async () => {
    const { owner, event } = await setup();
    const r = await upload(owner, event.id, await jpeg(1200, 800, 6)); // "rotate 90°" in EXIF
    expect(r.json()).toMatchObject({ width: 800, height: 1200 });
  });

  it('decides the type by content: SVG, GIF, text and disguised files are refused; PNG and WebP are accepted', async () => {
    const { owner, event } = await setup();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="900" height="900"/></svg>',
    );
    const gif = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#000' } })
      .gif()
      .toBuffer();
    const refused = [
      [svg, 'image/png'],
      [svg, 'image/jpeg'],
      [gif, 'image/webp'],
      [Buffer.from('just text, not an image'), 'application/octet-stream'],
      [Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500, 7)]), 'image/jpeg'], // a JPEG start, then garbage
    ] as const;
    for (const [body, type] of refused) {
      const r = await upload(owner, event.id, body, 'gallery', type);
      expect(r.statusCode, type).toBe(422);
      expect(r.json().code).toBe('image_rejected');
    }
    expect((await upload(owner, event.id, await png(), 'gallery', 'image/jpeg')).statusCode).toBe(201); // declared type does not matter
    const webp = await sharp({ create: { width: 500, height: 500, channels: 3, background: '#7261b1' } })
      .webp()
      .toBuffer();
    expect((await upload(owner, event.id, webp, 'gallery', 'application/octet-stream')).statusCode).toBe(201);
    // Other declared types never reach the image code.
    expect((await upload(owner, event.id, svg, 'gallery', 'image/svg+xml')).statusCode).toBe(415);
    expect(filesIn(h.config.MEDIA_DIR)).toHaveLength(4); // two accepted images, two files each
  });

  it('refuses tiny images, a header announcing a huge image, and uploads over 10 MB', async () => {
    const { owner, event } = await setup();
    const tiny = await upload(owner, event.id, await png(150, 400));
    expect(tiny.json()).toMatchObject({ code: 'image_rejected', reason: 'too_small' });
    const bomb = await upload(owner, event.id, hugePngHeader(), 'gallery', 'image/png');
    expect(bomb.statusCode).toBe(422);
    expect(bomb.json().reason).toBe('too_many_pixels');
    const big = await upload(owner, event.id, Buffer.alloc(10 * 1024 * 1024 + 1, 1));
    expect(big.statusCode).toBe(413);
    expect(big.json().code).toBe('image_too_large');
    expect(filesIn(h.config.MEDIA_DIR)).toEqual([]);
  });
});

describe('managing the images of an event', () => {
  it('keeps one cover and up to eight gallery images, in an order the organizer sets', async () => {
    const { owner, event } = await setup();
    expect((await upload(owner, event.id, await png(), 'cover')).statusCode).toBe(201);
    const second = await upload(owner, event.id, await png(), 'cover');
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('cover_exists');
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1)
      ids.push((await upload(owner, event.id, await png(300 + i, 300))).json().id);
    const ninth = await upload(owner, event.id, await png());
    expect(ninth.statusCode).toBe(409);
    expect(ninth.json().code).toBe('gallery_full');
    expect(filesIn(h.config.MEDIA_DIR)).toHaveLength(18); // the refused uploads left no files

    const reversed = [...ids].reverse();
    const ordered = await send(owner, 'PUT', `/api/events/${event.id}/images/order`, { imageIds: reversed });
    expect(ordered.statusCode).toBe(200);
    expect(
      ordered
        .json()
        .images.filter((i: { role: string }) => i.role === 'gallery')
        .map((i: { id: string }) => i.id),
    ).toEqual(reversed);
    const partial = await send(owner, 'PUT', `/api/events/${event.id}/images/order`, {
      imageIds: reversed.slice(1),
    });
    expect(partial.statusCode).toBe(409);
    expect(partial.json().code).toBe('gallery_changed');

    // The public page shows the cover and the gallery in that order; the event list shows the cover.
    const pub = (await get(`/api/public/events/${event.publicId}`)).json();
    expect(pub.images.cover.role).toBe('cover');
    expect(pub.images.gallery.map((i: { id: string }) => i.id)).toEqual(reversed);
    const list = (await get('/api/events', { cookie: owner.cookie })).json();
    expect(list.items[0].coverThumbnailUrl).toBe(pub.images.cover.thumbnailUrl);
  });

  it('makes a gallery image the cover; the old cover takes its place in the gallery', async () => {
    const { owner, event } = await setup();
    const cover = (await upload(owner, event.id, await png(), 'cover')).json();
    const a = (await upload(owner, event.id, await png())).json();
    const b = (await upload(owner, event.id, await png())).json();
    const r = await send(owner, 'POST', `/api/events/${event.id}/images/${b.id}/cover`);
    expect(r.statusCode).toBe(200);
    const images = r.json().images as { id: string; role: string; position: number }[];
    expect(images.map((i) => [i.id, i.role, i.position])).toEqual([
      [b.id, 'cover', 0],
      [a.id, 'gallery', 1],
      [cover.id, 'gallery', 2],
    ]);
  });

  it('replaces a picture under a new name and deletes the old files; removal closes the gap', async () => {
    const { owner, event } = await setup();
    const a = (await upload(owner, event.id, await png())).json();
    const b = (await upload(owner, event.id, await png())).json();
    const c = (await upload(owner, event.id, await png())).json();
    await send(owner, 'PATCH', `/api/events/${event.id}/images/${b.id}`, { alt: '  The stage at night ' });

    const replaced = await h.app.inject({
      method: 'PUT',
      url: `/api/events/${event.id}/images/${b.id}/file`,
      headers: { ...organizerHeaders(owner), 'content-type': 'image/jpeg' },
      payload: await jpeg(),
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toMatchObject({ id: b.id, position: 2, alt: 'The stage at night', width: 1200 });
    expect(replaced.json().url).not.toBe(b.url);
    expect((await get(b.url)).statusCode).toBe(404);
    expect((await get(replaced.json().url)).statusCode).toBe(200);

    expect((await send(owner, 'DELETE', `/api/events/${event.id}/images/${a.id}`)).statusCode).toBe(204);
    expect((await get(a.url)).statusCode).toBe(404);
    const left = (await get(`/api/events/${event.id}/images`, { cookie: owner.cookie })).json().images;
    expect(left.map((i: { id: string; position: number }) => [i.id, i.position])).toEqual([
      [b.id, 1],
      [c.id, 2],
    ]);
    expect(filesIn(h.config.MEDIA_DIR)).toHaveLength(4);
  });

  it('is only for the organization’s organizers, with the anti-forgery token, on a scheduled event', async () => {
    const { owner, event } = await setup();
    const other = await signIn(h, 'other@example.test');
    expect((await upload(other, event.id, await png())).statusCode).toBe(404);
    expect((await get(`/api/events/${event.id}/images`, { cookie: other.cookie })).statusCode).toBe(404);
    const noCsrf = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/images?role=gallery`,
      headers: { origin: ORIGIN, cookie: owner.cookie, 'content-type': 'image/png' },
      payload: await png(),
    });
    expect(noCsrf.statusCode).toBe(403);
    const anonymous = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/images?role=gallery`,
      headers: { origin: ORIGIN, 'content-type': 'image/png' },
      payload: await png(),
    });
    expect(anonymous.statusCode).toBe(401);
    await send(owner, 'POST', `/api/events/${event.id}/cancellation`, { confirmed: true });
    const cancelled = await upload(owner, event.id, await png());
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().code).toBe('event_not_scheduled');
    expect(filesIn(h.config.MEDIA_DIR)).toEqual([]);
  });

  it('serves only stored images by their exact names', async () => {
    const { owner, event } = await setup();
    const image = (await upload(owner, event.id, await png())).json();
    for (const url of [
      '/media/images/..%2F..%2Fpackage.json',
      '/media/images/' + 'a'.repeat(32) + '.webp',
      image.url.replace('.webp', '.png'),
      image.url.toUpperCase(),
    ])
      expect((await get(url)).statusCode, url).toBe(404);
  });

  it('removes the images and their files with the event', async () => {
    const { owner, event } = await setup();
    await upload(owner, event.id, await png(), 'cover');
    await upload(owner, event.id, await png());
    expect(filesIn(h.config.MEDIA_DIR)).toHaveLength(4);
    const fresh = await reauthenticate(h, owner, 'owner@example.test');
    const preview = await get(`/api/events/${event.id}/deletion-preview`, { cookie: fresh.cookie });
    expect(preview.statusCode).toBe(200);
    const deleted = await h.app.inject({
      method: 'POST',
      url: `/api/events/${event.id}/deletion`,
      headers: organizerHeaders(fresh),
      payload: { previewToken: preview.json().previewToken, confirmed: true },
    });
    expect(deleted.statusCode).toBe(204);
    expect(await h.db.selectFrom('app.event_images').select('id').execute()).toEqual([]);
    expect(filesIn(h.config.MEDIA_DIR)).toEqual([]);
    expect(existsSync(join(h.config.MEDIA_DIR, 'images'))).toBe(true);
  });
});
