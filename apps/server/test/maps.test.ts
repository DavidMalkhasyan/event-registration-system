import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { freshnessOf, tileAllowed } from '../src/modules/maps/tiles.js';
import {
  ORIGIN,
  createHarness,
  localIn,
  organizerHeaders,
  registerConfirmed,
  resetData,
  signIn,
  tokenFromLink,
  type Harness,
  type Session,
} from './harness.js';

// K-714 (amendment A-6, PD-96): the participant map's tile proxy. A local stand-in for the tile service
// records exactly what reaches it, so the tests check identification, caching, revalidation, bounds and
// that nothing of the participant is forwarded. No test contacts OpenStreetMap.

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6a40000000049454e44ae426082',
  'hex',
);
const CONTACT = 'https://example.test/contact';

let upstream: Server;
let seen: { url: string; headers: IncomingHttpHeaders }[] = [];
let behaviour: 'fresh' | 'revalidate' | 'fail' = 'fresh';

let h: Harness;
beforeAll(async () => {
  upstream = createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers });
    if (behaviour === 'fail') {
      res.writeHead(500).end('down');
      return;
    }
    if (behaviour === 'revalidate' && req.headers['if-none-match'] === '"v1"') {
      res.writeHead(304, { etag: '"v1"', 'cache-control': 'max-age=0' }).end();
      return;
    }
    res
      .writeHead(200, {
        'content-type': 'image/png',
        etag: '"v1"',
        'cache-control': behaviour === 'revalidate' ? 'max-age=0' : 'max-age=600',
      })
      .end(PNG);
  });
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  const port = (upstream.address() as AddressInfo).port;
  h = await createHarness({
    MAP_TILE_URL: `http://127.0.0.1:${port}/osm/{z}/{x}/{y}.png`,
    MAP_TILE_CONTACT: CONTACT,
  });
});
afterAll(async () => {
  await h.close();
  await new Promise((r) => upstream.close(r));
});
beforeEach(async () => {
  await resetData(h);
  seen = [];
  behaviour = 'fresh';
});

const VENUE = { latitude: 40.177628, longitude: 44.512546 };

async function eventAt(owner: Session, coordinates: typeof VENUE | null) {
  const r = await h.app.inject({
    method: 'POST',
    url: '/api/events',
    headers: organizerHeaders(owner),
    payload: {
      requestId: randomUUID(),
      title: 'Concert',
      localStart: localIn(48),
      timeZone: 'UTC',
      capacity: 1,
      location: {
        venueName: 'Riverside Hall',
        streetAddress: '12 Mill Lane',
        city: 'Yerevan',
        country: 'Armenia',
        ...(coordinates ?? {}),
      },
    },
  });
  expect(r.statusCode).toBe(201);
  return r.json().event as { id: string; publicId: string };
}

/** The tile containing a point. */
function tileOf(lat: number, lon: number, z: number) {
  const x = Math.floor(((lon + 180) / 360) * 2 ** z);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  return { x, y };
}

const tile = (publicId: string, z: number, x: number, y: number, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url: `/map-tiles/${publicId}/${z}/${x}/${y}.png`, headers });

describe('the participant map', () => {
  it('is given to confirmed participants with their venue’s coordinates, without any token in it', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const event = await eventAt(owner, VENUE);
    const anna = await registerConfirmed(h, event.publicId, 'anna@example.test');
    const ben = await registerConfirmed(h, event.publicId, 'ben@example.test'); // waiting list
    const manage = (token: string) =>
      h.app.inject({ method: 'GET', url: '/api/links/manage', headers: { authorization: `Link ${token}` } });

    const confirmed = (await manage(tokenFromLink(anna.links.management))).json();
    expect(confirmed.map).toMatchObject({
      tileUrl: `/map-tiles/${event.publicId}/{z}/{x}/{y}.png`,
      center: VENUE,
      minZoom: 12,
      maxZoom: 18,
      attribution: '© OpenStreetMap contributors',
    });
    expect(JSON.stringify(confirmed.map)).not.toContain(tokenFromLink(anna.links.management));
    const share = await h.app.inject({
      method: 'GET',
      url: '/api/links/ticket',
      headers: { authorization: `Link ${tokenFromLink(anna.links.share)}` },
    });
    expect(share.json().map.center).toEqual(VENUE);
    expect((await manage(tokenFromLink(ben.links.management))).json().map).toBeUndefined();

    const noCoordinates = await eventAt(owner, null);
    const cleo = await registerConfirmed(h, noCoordinates.publicId, 'cleo@example.test');
    expect((await manage(tokenFromLink(cleo.links.management))).json().map).toBeNull();
  });

  it('fetches a tile once, identified, with nothing of the participant, and serves it from the cache', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const event = await eventAt(owner, VENUE);
    const { x, y } = tileOf(VENUE.latitude, VENUE.longitude, 16);
    const visitor = {
      cookie: '__Host-ers_org=secret-session; other=1',
      'user-agent': 'Participant-Browser/9.9',
      'x-forwarded-for': '203.0.113.7',
      referer: 'https://eventflow.example/manage#t=SECRET',
    };
    const first = await tile(event.publicId, 16, x, y, visitor);
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('image/png');
    expect(first.headers['cache-control']).toMatch(/^public, max-age=\d+$/);
    expect(first.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(first.rawPayload.equals(PNG)).toBe(true);
    expect(seen).toHaveLength(1);
    const sent = seen[0]!;
    expect(sent.url).toBe(`/osm/16/${x}/${y}.png`);
    expect(sent.headers['user-agent']).toBe(`EventFlow/1.0 (participant venue maps; +${CONTACT})`);
    expect(sent.headers.referer).toBe(`${ORIGIN}/`);
    expect(sent.headers.cookie).toBeUndefined();
    expect(sent.headers['x-forwarded-for']).toBeUndefined();
    expect(sent.headers['cache-control']).toBeUndefined();
    expect(sent.headers.pragma).toBeUndefined();
    expect(JSON.stringify(sent.headers)).not.toMatch(
      /Participant-Browser|SECRET|203\.0\.113\.7|secret-session/,
    );

    expect((await tile(event.publicId, 16, x, y)).statusCode).toBe(200);
    expect(seen).toHaveLength(1); // the cache answered
  });

  it('revalidates an expired tile with a conditional request', async () => {
    behaviour = 'revalidate';
    const owner = await signIn(h, 'owner@example.test');
    const event = await eventAt(owner, VENUE);
    const { x, y } = tileOf(VENUE.latitude, VENUE.longitude, 15);
    expect((await tile(event.publicId, 15, x, y)).statusCode).toBe(200);
    const again = await tile(event.publicId, 15, x, y);
    expect(again.statusCode).toBe(200);
    expect(again.rawPayload.equals(PNG)).toBe(true);
    expect(seen).toHaveLength(2);
    expect(seen[0]!.headers['if-none-match']).toBeUndefined();
    expect(seen[1]!.headers['if-none-match']).toBe('"v1"');
  });

  it('serves only tiles around the venue, at zoom 12 to 18, of events with coordinates', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const event = await eventAt(owner, VENUE);
    const plain = await eventAt(owner, null);
    const at = (z: number) => tileOf(VENUE.latitude, VENUE.longitude, z);
    const far = tileOf(48.8566, 2.3522, 16); // Paris
    for (const [publicId, z, x, y] of [
      [event.publicId, 16, far.x, far.y],
      [event.publicId, 11, at(11).x, at(11).y],
      [event.publicId, 19, at(19).x, at(19).y],
      [event.publicId, 16, at(16).x + 40, at(16).y],
      [plain.publicId, 16, at(16).x, at(16).y],
      ['A'.repeat(22), 16, at(16).x, at(16).y],
    ] as const)
      expect((await tile(publicId, z, x, y)).statusCode, `${z}/${x}/${y}`).toBe(404);
    for (const url of [
      `/map-tiles/${event.publicId}/16/1/../../x.png`,
      `/map-tiles/${event.publicId}/16/1/2.jpg`,
    ])
      expect((await h.app.inject({ method: 'GET', url })).statusCode, url).toBe(404);
    expect(seen).toEqual([]); // nothing was fetched for refused requests
    // The venue's own tile is allowed at every zoom; from zoom 15 (tiles of about 1 km) its neighbours too.
    for (let z = 12; z <= 18; z += 1) {
      const t = at(z);
      expect(tileAllowed(VENUE.latitude, VENUE.longitude, z, t.x, t.y)).toBe(true);
      if (z >= 15) expect(tileAllowed(VENUE.latitude, VENUE.longitude, z, t.x + 1, t.y)).toBe(true);
    }
  });

  it('answers 502 when the tile service fails and nothing is cached, and keeps serving a cached copy', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const event = await eventAt(owner, VENUE);
    const a = tileOf(VENUE.latitude, VENUE.longitude, 14);
    behaviour = 'fail';
    const failed = await tile(event.publicId, 14, a.x, a.y);
    expect(failed.statusCode).toBe(502);
    expect(failed.json().code).toBe('map_tile_unavailable');
    behaviour = 'revalidate'; // cached, but immediately stale
    expect((await tile(event.publicId, 14, a.x, a.y)).statusCode).toBe(200);
    behaviour = 'fail';
    const stale = await tile(event.publicId, 14, a.x, a.y);
    expect(stale.statusCode).toBe(200);
    // A stale copy is reused for 60 s counted from the request's start; the header gives the whole
    // seconds left when the reply is sent: 60, or 59 once the clock has ticked in between.
    const maxAge = Number(/^public, max-age=(\d+)$/.exec(String(stale.headers['cache-control']))?.[1]);
    expect(maxAge).toBeGreaterThanOrEqual(50);
    expect(maxAge).toBeLessThanOrEqual(60);
  });

  it('limits each client', async () => {
    const owner = await signIn(h, 'owner@example.test');
    const event = await eventAt(owner, VENUE);
    const { x, y } = tileOf(VENUE.latitude, VENUE.longitude, 16);
    let last = 0;
    for (let i = 0; i < 601; i += 1) last = (await tile(event.publicId, 16, x, y)).statusCode;
    expect(last).toBe(429);
    expect(seen).toHaveLength(1);
  });

  it('reads the tile service’s caching headers, with seven days when there are none', () => {
    const now = Date.UTC(2026, 9, 13);
    expect(freshnessOf(new Headers({ 'cache-control': 'public, max-age=3600' }), now)).toBe(now + 3_600_000);
    expect(freshnessOf(new Headers({ expires: 'Wed, 14 Oct 2026 00:00:00 GMT' }), now)).toBe(
      now + 86_400_000,
    );
    expect(freshnessOf(new Headers(), now)).toBe(now + 7 * 86_400_000);
  });
});

describe('without an operator contact', () => {
  it('has no map, and its tiles are not served', async () => {
    const plain = await createHarness();
    try {
      await resetData(plain);
      const owner = await signIn(plain, 'owner@example.test');
      const r = await plain.app.inject({
        method: 'POST',
        url: '/api/events',
        headers: organizerHeaders(owner),
        payload: {
          requestId: randomUUID(),
          title: 'Concert',
          localStart: localIn(48),
          timeZone: 'UTC',
          capacity: 2,
          location: {
            venueName: 'Hall',
            streetAddress: '1 Road',
            city: 'Yerevan',
            country: 'Armenia',
            ...VENUE,
          },
        },
      });
      const event = r.json().event;
      const anna = await registerConfirmed(plain, event.publicId, 'anna@example.test');
      const view = await plain.app.inject({
        method: 'GET',
        url: '/api/links/manage',
        headers: { authorization: `Link ${tokenFromLink(anna.links.management)}` },
      });
      expect(view.json().map).toBeNull();
      expect(view.json().event.location.coordinates).toEqual(VENUE); // the address and directions remain
      const { x, y } = tileOf(VENUE.latitude, VENUE.longitude, 16);
      expect(
        (await plain.app.inject({ method: 'GET', url: `/map-tiles/${event.publicId}/16/${x}/${y}.png` }))
          .statusCode,
      ).toBe(404);
      expect(seen).toEqual([]);
    } finally {
      await plain.close();
    }
  });
});
