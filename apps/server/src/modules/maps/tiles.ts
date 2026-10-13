import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AppContext } from '../../composition/context.js';
import type { Config } from '../../platform/config.js';
import { AppError } from '../../platform/errors.js';
import { RULES } from '../../platform/ratelimit.js';
import type { Location } from '../event-core/location.js';

// The participant map (K-714, amendment A-6, PD-96). Map tiles come from OpenStreetMap's standard tile
// service through this same-origin, identified and bounded caching proxy, so that participant pages
// keep their CSP (`img-src 'self'`) and their `Referrer-Policy: no-referrer`, and no participant's IP
// address, link token, email address or browser details reach the tile provider. What the proxy does
// to follow the OSM Tile Usage Policy (https://operations.osmfoundation.org/policies/tiles/):
//  - identification: a stable User-Agent naming EventFlow with the operator's contact (MAP_TILE_CONTACT;
//    without it the map is off), and an accurate Referer: the site's own origin. Nothing of the client
//    request is forwarded (no cookies, IP address, User-Agent or page URL);
//  - caching: tiles are kept on disk and reused while fresh by the upstream Cache-Control / Expires
//    headers (7 days when there are none); expired tiles are revalidated with If-None-Match /
//    If-Modified-Since; requests never carry no-cache headers;
//  - no bulk use: only tiles that a viewer asks for, only within about 3 km of an event's own
//    coordinates and at zoom 12 to 18, nothing prefetched or seeded; per-client and global limits.
// OSMF does not recommend proxies in general and gives no service guarantee: this serves development
// and the assignment demonstration (stakeholder decision, option A); a production deployment needs a
// tile provider with an agreement (POST_RELEASE_PLAN.md, options B and C).

export const MAP_MIN_ZOOM = 12;
export const MAP_MAX_ZOOM = 18;
export const MAP_DEFAULT_ZOOM = 16;
const HALF_SPAN_DEG = 0.027; // about 3 km north and south of the venue
const DEFAULT_FRESH_MS = 7 * 24 * 3_600_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const MAX_TILE_BYTES = 1024 * 1024;
const MAX_CONCURRENT_UPSTREAM = 2;
// At most this many upstream fetches per minute per web process; beyond it, stale copies or a 503.
const UPSTREAM_PER_MINUTE = 60;
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export interface MapView {
  tileUrl: string;
  center: { latitude: number; longitude: number };
  bounds: [[number, number], [number, number]];
  minZoom: number;
  maxZoom: number;
  zoom: number;
  attribution: string;
}

function boundsOf(lat: number, lon: number): { south: number; west: number; north: number; east: number } {
  const lonSpan = HALF_SPAN_DEG / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return {
    south: Math.max(-85, lat - HALF_SPAN_DEG),
    north: Math.min(85, lat + HALF_SPAN_DEG),
    west: Math.max(-180, lon - lonSpan),
    east: Math.min(180, lon + lonSpan),
  };
}

export function mapsEnabled(config: Config): boolean {
  return !!config.MAP_TILE_CONTACT;
}

/** The map of a venue for a participant page, or null (no coordinates, or the map is not configured). */
export function mapView(config: Config, publicId: string, location: Location | null): MapView | null {
  if (!location?.coordinates || !mapsEnabled(config)) return null;
  const { latitude, longitude } = location.coordinates;
  const b = boundsOf(latitude, longitude);
  return {
    tileUrl: `/map-tiles/${publicId}/{z}/{x}/{y}.png`,
    center: { latitude, longitude },
    bounds: [
      [b.south, b.west],
      [b.north, b.east],
    ],
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,
    zoom: MAP_DEFAULT_ZOOM,
    attribution: OSM_ATTRIBUTION,
  };
}

const lon2x = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Whether a tile lies within the area around the venue that its map may show. */
export function tileAllowed(lat: number, lon: number, z: number, x: number, y: number): boolean {
  if (z < MAP_MIN_ZOOM || z > MAP_MAX_ZOOM) return false;
  const b = boundsOf(lat, lon);
  return x >= lon2x(b.west, z) && x <= lon2x(b.east, z) && y >= lat2y(b.north, z) && y <= lat2y(b.south, z);
}

interface CacheMeta {
  etag: string | null;
  lastModified: string | null;
  freshUntil: number;
}

/** Freshness from the upstream headers (Cache-Control max-age, then Expires), else 7 days. */
export function freshnessOf(headers: Headers, now: number): number {
  const cc = headers.get('cache-control') ?? '';
  const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(cc);
  if (maxAge) return now + Number(maxAge[1]) * 1000;
  const expires = headers.get('expires');
  if (expires && !Number.isNaN(Date.parse(expires))) return Date.parse(expires);
  return now + DEFAULT_FRESH_MS;
}

export class TileCache {
  private inflight = new Map<string, Promise<{ body: Buffer; freshUntil: number }>>();
  private active = 0;
  private budget: { windowStart: number; used: number } = { windowStart: 0, used: 0 };
  private waiting: (() => void)[] = [];

  constructor(
    private readonly dir: string,
    private readonly config: Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private paths(z: number, x: number, y: number) {
    const base = join(this.dir, String(z), String(x), String(y));
    return { body: `${base}.png`, meta: `${base}.json` };
  }

  private async read(z: number, x: number, y: number) {
    const p = this.paths(z, x, y);
    try {
      const [body, meta] = await Promise.all([readFile(p.body), readFile(p.meta, 'utf8')]);
      return { body, meta: JSON.parse(meta) as CacheMeta };
    } catch {
      return null;
    }
  }

  private async write(z: number, x: number, y: number, body: Buffer | null, meta: CacheMeta) {
    const p = this.paths(z, x, y);
    await mkdir(join(p.body, '..'), { recursive: true });
    const tag = randomBytes(6).toString('hex');
    if (body) {
      await writeFile(`${p.body}.${tag}.tmp`, body);
      await rename(`${p.body}.${tag}.tmp`, p.body);
    }
    await writeFile(`${p.meta}.${tag}.tmp`, JSON.stringify(meta));
    await rename(`${p.meta}.${tag}.tmp`, p.meta);
  }

  private async slot(): Promise<() => void> {
    if (this.active >= MAX_CONCURRENT_UPSTREAM) await new Promise<void>((r) => this.waiting.push(r));
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }

  /** A tile: from the cache while fresh, otherwise fetched or revalidated upstream (one fetch per tile at a time). */
  async get(
    z: number,
    x: number,
    y: number,
    now = Date.now(),
  ): Promise<{ body: Buffer; freshUntil: number }> {
    const cached = await this.read(z, x, y);
    if (cached && cached.meta.freshUntil > now)
      return { body: cached.body, freshUntil: cached.meta.freshUntil };
    const key = `${z}/${x}/${y}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const work = this.fetchUpstream(z, x, y, cached, now).finally(() => this.inflight.delete(key));
    this.inflight.set(key, work);
    return work;
  }

  private async fetchUpstream(
    z: number,
    x: number,
    y: number,
    cached: { body: Buffer; meta: CacheMeta } | null,
    now: number,
  ): Promise<{ body: Buffer; freshUntil: number }> {
    if (now - this.budget.windowStart >= 60_000) this.budget = { windowStart: now, used: 0 };
    if (this.budget.used >= UPSTREAM_PER_MINUTE) {
      if (cached) return { body: cached.body, freshUntil: now + 60_000 };
      throw new AppError(503, 'map_tile_unavailable');
    }
    this.budget.used += 1;
    const release = await this.slot();
    try {
      const url = this.config.MAP_TILE_URL.replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
      const headers: Record<string, string> = {
        'user-agent': `EventFlow/1.0 (participant venue maps; +${this.config.MAP_TILE_CONTACT})`,
        referer: `${this.config.PUBLIC_ORIGIN}/`,
        accept: 'image/png',
      };
      if (cached?.meta.etag) headers['if-none-match'] = cached.meta.etag;
      if (cached?.meta.lastModified) headers['if-modified-since'] = cached.meta.lastModified;
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
      } catch {
        if (cached) return { body: cached.body, freshUntil: now + 60_000 }; // stale, briefly
        throw new AppError(502, 'map_tile_unavailable');
      }
      if (response.status === 304 && cached) {
        const meta = {
          etag: response.headers.get('etag') ?? cached.meta.etag,
          lastModified: response.headers.get('last-modified') ?? cached.meta.lastModified,
          freshUntil: freshnessOf(response.headers, now),
        };
        await this.write(z, x, y, null, meta);
        return { body: cached.body, freshUntil: meta.freshUntil };
      }
      const type = response.headers.get('content-type') ?? '';
      const body = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
      if (!response.ok || !type.startsWith('image/') || !body || body.length > MAX_TILE_BYTES) {
        if (cached) return { body: cached.body, freshUntil: now + 60_000 };
        throw new AppError(502, 'map_tile_unavailable');
      }
      const meta = {
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        freshUntil: freshnessOf(response.headers, now),
      };
      await this.write(z, x, y, body, meta);
      return { body, freshUntil: meta.freshUntil };
    } finally {
      release();
    }
  }
}

/** GET /map-tiles/:publicId/:z/:x/:y.png */
export async function venueTile(
  ctx: AppContext,
  tiles: TileCache,
  publicId: string,
  zxy: { z: number; x: number; y: number },
  ip: string,
) {
  if (!mapsEnabled(ctx.config)) throw new AppError(404, 'not_found');
  const event = await ctx.db
    .selectFrom('app.events')
    .select(['latitude', 'longitude'])
    .where('public_id', '=', publicId)
    .executeTakeFirst();
  if (!event?.latitude || !event.longitude) throw new AppError(404, 'not_found');
  if (!tileAllowed(Number(event.latitude), Number(event.longitude), zxy.z, zxy.x, zxy.y))
    throw new AppError(404, 'not_found');
  const r = await ctx.limiter.hit(RULES.mapTilesPerIp, ip);
  if (!r.allowed) throw new AppError(429, 'rate_limited', { retryAfterSeconds: r.retryAfterSeconds });
  return tiles.get(zxy.z, zxy.x, zxy.y);
}
