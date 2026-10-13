import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import { AppError } from '../../platform/errors.js';
import { requireOrganizer } from '../identity/sessions.js';
import { getOwnedEvent } from '../event-core/events.js';
import {
  addImage,
  altSchema,
  imagesOf,
  makeCover,
  orderSchema,
  removeImage,
  reorderGallery,
  replaceImage,
  roleSchema,
  setAltText,
} from './images.js';
import { MAX_UPLOAD_BYTES } from './processing.js';

// K-712 (PD-92): the organizer's image API and the same-origin serving of stored images.

const params = z.object({ eventId: z.string(), imageId: z.string().optional() });

// Uploads are the raw image as the request body. The declared type only routes the body here (any
// image type or application/octet-stream); what the bytes are is decided by their content.
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'];

const FILE = /^([0-9a-f]{32})(-thumb)?\.webp$/;

export function registerMediaRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Encapsulated: the raw-body parser and its limit apply to the upload routes only.
  void app.register(async (scope) => {
    scope.addContentTypeParser(
      UPLOAD_TYPES,
      { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
      (_r, body, done) => done(null, body),
    );

    scope.post('/api/events/:eventId/images', async (request, reply) => {
      const principal = await requireOrganizer(ctx, request, { csrf: true });
      const { eventId } = params.parse(request.params);
      const { role } = roleSchema.parse(request.query);
      if (!Buffer.isBuffer(request.body)) throw new AppError(415, 'unsupported_media_type');
      const image = await addImage(ctx, principal, eventId, role, request.body);
      return reply.code(201).send(image);
    });

    scope.put('/api/events/:eventId/images/:imageId/file', async (request) => {
      const principal = await requireOrganizer(ctx, request, { csrf: true });
      const { eventId, imageId } = params.parse(request.params);
      if (!Buffer.isBuffer(request.body)) throw new AppError(415, 'unsupported_media_type');
      return replaceImage(ctx, principal, eventId, imageId!, request.body);
    });
  });

  app.get('/api/events/:eventId/images', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: false });
    const { eventId } = params.parse(request.params);
    await getOwnedEvent(ctx, principal, eventId); // 404 for another organization's event
    return { images: (await imagesOf(ctx.db, [eventId])).get(eventId)! };
  });

  app.patch('/api/events/:eventId/images/:imageId', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const { eventId, imageId } = params.parse(request.params);
    return setAltText(ctx, principal, eventId, imageId!, altSchema.parse(request.body));
  });

  app.delete('/api/events/:eventId/images/:imageId', async (request, reply) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const { eventId, imageId } = params.parse(request.params);
    await removeImage(ctx, principal, eventId, imageId!);
    return reply.code(204).send();
  });

  app.put('/api/events/:eventId/images/order', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const { eventId } = params.parse(request.params);
    return { images: await reorderGallery(ctx, principal, eventId, orderSchema.parse(request.body)) };
  });

  app.post('/api/events/:eventId/images/:imageId/cover', async (request) => {
    const principal = await requireOrganizer(ctx, request, { csrf: true });
    const { eventId, imageId } = params.parse(request.params);
    return { images: await makeCover(ctx, principal, eventId, imageId!) };
  });

  // Same-origin serving (no image CDN). Only images that still have their row are served, so a removed
  // image stops working at once even if its file has not been deleted yet. The names are random and
  // change when a picture is replaced, so the files can be cached for good.
  app.get('/media/images/:file', async (request, reply) => {
    const match = FILE.exec((request.params as { file: string }).file);
    if (!match) throw new AppError(404, 'not_found');
    const [, key, thumb] = match;
    const known = await ctx.db
      .selectFrom('app.event_images')
      .select('id')
      .where('storage_key', '=', key!)
      .executeTakeFirst();
    const path = known ? await ctx.media.locate(key!, thumb ? 'thumb' : 'full') : null;
    if (!path) throw new AppError(404, 'not_found');
    const size = (await stat(path)).size;
    return reply
      .header('content-type', 'image/webp')
      .header('content-length', String(size))
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
      .header('cross-origin-resource-policy', 'same-origin')
      .send(createReadStream(path));
  });
}
