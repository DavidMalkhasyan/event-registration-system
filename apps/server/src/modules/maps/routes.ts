import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { AppError } from '../../platform/errors.js';
import { TileCache, venueTile } from './tiles.js';

// K-714 (PD-96): venue map tiles from our own origin. Not under /api/, so the browser may cache them.

const params = z.object({
  publicId: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  z: z.coerce.number().int().min(0).max(22),
  x: z.coerce.number().int().min(0),
  y: z.coerce.number().int().min(0),
});

export function registerMapRoutes(app: FastifyInstance, ctx: AppContext): void {
  const tiles = new TileCache(ctx.config.TILE_CACHE_DIR, ctx.config);
  app.get('/map-tiles/:publicId/:z/:x/:file', async (request, reply) => {
    const raw = request.params as Record<string, string>;
    const y = /^(\d+)\.png$/.exec(raw.file ?? '')?.[1];
    const parsed = params.safeParse({ ...raw, y });
    if (!parsed.success) throw new AppError(404, 'not_found');
    const { publicId, ...zxy } = parsed.data;
    const tile = await venueTile(ctx, tiles, publicId, zxy, request.ip);
    const maxAge = Math.max(0, Math.min(7 * 86_400, Math.floor((tile.freshUntil - Date.now()) / 1000)));
    return reply
      .header('content-type', 'image/png')
      .header('cache-control', `public, max-age=${maxAge}`)
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
      .header('cross-origin-resource-policy', 'same-origin')
      .send(tile.body);
  });
}
