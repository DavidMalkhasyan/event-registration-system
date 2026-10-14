import { z } from 'zod';
import type { AppContext } from '../../composition/context.js';
import type { Database } from '../../platform/db.js';
import { AppError } from '../../platform/errors.js';
import { RULES } from '../../platform/ratelimit.js';
import { withEventLock, type Tx } from '../../platform/tx.js';
import { recordAudit } from '../audit/audit.js';
import { sessionStillValid, type OrganizerPrincipal } from '../identity/sessions.js';
import { assertEventAccess } from '../organizations/access.js';
import { processImage } from './processing.js';
import { newMediaKey } from './storage.js';

// Event photographs (K-712, amendment A-4, PD-92): one cover and up to eight gallery images per event.
// Files are processed and written to the media storage before the transaction; the database row is
// written under the exclusive event lock (limits, roles and positions are decided there); if the
// transaction fails, the new files are removed. Files that a change replaced or removed are deleted
// after the commit. Images are served from our own origin under their random names (routes.ts).

export const GALLERY_MAX = 8;
export type ImageRole = 'cover' | 'gallery';

interface ImageRow {
  id: string;
  role: string;
  position: number;
  storage_key: string;
  width: number;
  height: number;
  alt_text: string | null;
}

export interface ImageView {
  id: string;
  role: ImageRole;
  position: number;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  alt: string | null;
}

export const mediaUrl = (key: string, variant: 'full' | 'thumb') =>
  `/media/images/${key}${variant === 'thumb' ? '-thumb' : ''}.webp`;

export function imageView(row: ImageRow): ImageView {
  return {
    id: row.id,
    role: row.role as ImageRole,
    position: row.position,
    url: mediaUrl(row.storage_key, 'full'),
    thumbnailUrl: mediaUrl(row.storage_key, 'thumb'),
    width: row.width,
    height: row.height,
    alt: row.alt_text,
  };
}

const COLUMNS = ['id', 'role', 'position', 'storage_key', 'width', 'height', 'alt_text'] as const;

/** The images of some events, cover first, then the gallery in order. */
export async function imagesOf(db: Database | Tx, eventIds: string[]): Promise<Map<string, ImageView[]>> {
  const result = new Map<string, ImageView[]>(eventIds.map((id) => [id, []]));
  if (eventIds.length === 0) return result;
  const rows = await db
    .selectFrom('app.event_images')
    .select(['event_id', ...COLUMNS])
    .where('event_id', 'in', eventIds)
    .orderBy('event_id')
    .orderBy('position')
    .execute();
  for (const row of rows) result.get(row.event_id)!.push(imageView(row));
  return result;
}

/** The public shape: the cover and the gallery in order. */
export function publicImages(images: ImageView[]) {
  return {
    cover: images.find((i) => i.role === 'cover') ?? null,
    gallery: images.filter((i) => i.role === 'gallery'),
  };
}

export const altSchema = z
  .object({ alt: z.string().trim().max(300).nullable() })
  .strict()
  .transform((v) => ({ alt: v.alt ? v.alt : null }));
export const orderSchema = z.object({ imageIds: z.array(z.uuid()).max(GALLERY_MAX) }).strict();
export const roleSchema = z.object({ role: z.enum(['cover', 'gallery']) }).strict();

function uuidOr404(id: string) {
  if (!z.uuid().safeParse(id).success) throw new AppError(404, 'not_found');
}

/**
 * Runs a change of an event's images under the exclusive event lock, after the organizer's access, the
 * session and the event's state are checked again there (as every other organizer change).
 */
async function underLock<T>(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  fn: (trx: Tx, now: Date) => Promise<T>,
): Promise<T> {
  uuidOr404(eventId);
  const result = await withEventLock(ctx.db, eventId, 'exclusive', async ({ trx, now, event }) => {
    await assertEventAccess(trx, principal.accountId, event);
    if (!(await sessionStillValid(trx, principal.sessionId, now))) throw new AppError(401, 'unauthenticated');
    if (event.status !== 'SCHEDULED') throw new AppError(409, 'event_not_scheduled');
    return { value: await fn(trx, now) };
  });
  if (!result) throw new AppError(404, 'not_found');
  return result.value;
}

async function limitUploads(ctx: AppContext, principal: OrganizerPrincipal) {
  const r = await ctx.limiter.hit(RULES.imageUploadsPerAccount, principal.accountId);
  if (!r.allowed) throw new AppError(429, 'rate_limited', { retryAfterSeconds: r.retryAfterSeconds });
}

/** Processes the upload and writes its files; returns the new key and what to record. */
async function intake(ctx: AppContext, data: Buffer) {
  const processed = await processImage(data);
  const key = newMediaKey();
  try {
    await ctx.media.put(key, { full: processed.full, thumb: processed.thumb });
  } catch {
    // K-719: a full or failing disk is the server's problem, said plainly; nothing was recorded.
    throw new AppError(503, 'media_storage_unavailable');
  }
  return { key, processed };
}

async function discard(ctx: AppContext, keys: string[]) {
  // Best effort after the commit; a leftover file is unreachable (serving needs its row) and harmless.
  await Promise.all(keys.map((k) => ctx.media.remove(k).catch(() => undefined)));
}

async function rowOf(trx: Tx, eventId: string, imageId: string) {
  uuidOr404(imageId);
  const row = await trx
    .selectFrom('app.event_images')
    .select(COLUMNS)
    .where('id', '=', imageId)
    .where('event_id', '=', eventId)
    .executeTakeFirst();
  if (!row) throw new AppError(404, 'not_found');
  return row;
}

/** Renumbers the gallery 1..n in its current order (after a removal or a role change). */
async function compactGallery(trx: Tx, eventId: string) {
  const gallery = await trx
    .selectFrom('app.event_images')
    .select('id')
    .where('event_id', '=', eventId)
    .where('role', '=', 'gallery')
    .orderBy('position')
    .execute();
  for (const [i, g] of gallery.entries())
    await trx
      .updateTable('app.event_images')
      .set({ position: i + 1 })
      .where('id', '=', g.id)
      .execute();
}

/** POST /api/events/:id/images?role=cover|gallery with the image as the request body. */
export async function addImage(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  role: ImageRole,
  data: Buffer,
): Promise<ImageView> {
  uuidOr404(eventId);
  await limitUploads(ctx, principal);
  const { key, processed } = await intake(ctx, data);
  try {
    return await underLock(ctx, principal, eventId, async (trx, now) => {
      const existing = await trx
        .selectFrom('app.event_images')
        .select(['role', 'position'])
        .where('event_id', '=', eventId)
        .execute();
      let position = 0;
      if (role === 'cover') {
        if (existing.some((e) => e.role === 'cover')) throw new AppError(409, 'cover_exists');
      } else {
        const gallery = existing.filter((e) => e.role === 'gallery');
        if (gallery.length >= GALLERY_MAX) throw new AppError(409, 'gallery_full', { max: GALLERY_MAX });
        position = Math.max(0, ...gallery.map((g) => g.position)) + 1;
      }
      const row = await trx
        .insertInto('app.event_images')
        .values({
          event_id: eventId,
          role,
          position,
          storage_key: key,
          width: processed.width,
          height: processed.height,
          byte_size: processed.full.length,
          thumb_byte_size: processed.thumb.length,
          created_at: now,
          created_by_account_id: principal.accountId,
        })
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      await recordAudit(trx, {
        now,
        action: 'image_added',
        actorKind: 'owner',
        actorAccountId: principal.accountId,
        eventId,
        subjectId: row.id,
        outcome: 'success',
        details: { role },
      });
      return imageView(row);
    });
  } catch (error) {
    await discard(ctx, [key]);
    throw error;
  }
}

/** PUT /api/events/:id/images/:imageId/file: the same place (role, position, alt text), a new picture. */
export async function replaceImage(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  imageId: string,
  data: Buffer,
): Promise<ImageView> {
  uuidOr404(eventId);
  uuidOr404(imageId);
  await limitUploads(ctx, principal);
  const { key, processed } = await intake(ctx, data);
  let old: string | undefined;
  try {
    const view = await underLock(ctx, principal, eventId, async (trx, now) => {
      const current = await rowOf(trx, eventId, imageId);
      old = current.storage_key;
      const row = await trx
        .updateTable('app.event_images')
        .set({
          storage_key: key,
          width: processed.width,
          height: processed.height,
          byte_size: processed.full.length,
          thumb_byte_size: processed.thumb.length,
        })
        .where('id', '=', imageId)
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      await recordAudit(trx, {
        now,
        action: 'image_replaced',
        actorKind: 'owner',
        actorAccountId: principal.accountId,
        eventId,
        subjectId: imageId,
        outcome: 'success',
      });
      return imageView(row);
    });
    await discard(ctx, [old!]);
    return view;
  } catch (error) {
    await discard(ctx, [key]);
    throw error;
  }
}

/** PATCH /api/events/:id/images/:imageId: the alternative text read by screen readers. */
export async function setAltText(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  imageId: string,
  input: z.infer<typeof altSchema>,
): Promise<ImageView> {
  return underLock(ctx, principal, eventId, async (trx) => {
    await rowOf(trx, eventId, imageId);
    const row = await trx
      .updateTable('app.event_images')
      .set({ alt_text: input.alt })
      .where('id', '=', imageId)
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
    return imageView(row);
  });
}

/** DELETE /api/events/:id/images/:imageId. The gallery closes the gap. */
export async function removeImage(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  imageId: string,
): Promise<void> {
  const key = await underLock(ctx, principal, eventId, async (trx, now) => {
    const row = await rowOf(trx, eventId, imageId);
    await trx.deleteFrom('app.event_images').where('id', '=', imageId).execute();
    if (row.role === 'gallery') await compactGallery(trx, eventId);
    await recordAudit(trx, {
      now,
      action: 'image_removed',
      actorKind: 'owner',
      actorAccountId: principal.accountId,
      eventId,
      subjectId: imageId,
      outcome: 'success',
      details: { role: row.role },
    });
    return row.storage_key;
  });
  await discard(ctx, [key]);
}

/** PUT /api/events/:id/images/order: the complete gallery in its new order. */
export async function reorderGallery(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  input: z.infer<typeof orderSchema>,
): Promise<ImageView[]> {
  return underLock(ctx, principal, eventId, async (trx, now) => {
    const gallery = await trx
      .selectFrom('app.event_images')
      .select('id')
      .where('event_id', '=', eventId)
      .where('role', '=', 'gallery')
      .execute();
    const current = new Set(gallery.map((g) => g.id));
    if (input.imageIds.length !== current.size || !input.imageIds.every((id) => current.has(id)))
      throw new AppError(409, 'gallery_changed'); // not exactly the gallery: reload and try again
    for (const [i, id] of input.imageIds.entries())
      await trx
        .updateTable('app.event_images')
        .set({ position: i + 1 })
        .where('id', '=', id)
        .execute();
    await recordAudit(trx, {
      now,
      action: 'gallery_reordered',
      actorKind: 'owner',
      actorAccountId: principal.accountId,
      eventId,
      outcome: 'success',
    });
    return (await imagesOf(trx, [eventId])).get(eventId)!;
  });
}

/**
 * POST /api/events/:id/images/:imageId/cover: a gallery image becomes the cover. The previous cover, if
 * any, takes that image's place in the gallery, so nothing is lost and the gallery stays within eight.
 */
export async function makeCover(
  ctx: AppContext,
  principal: OrganizerPrincipal,
  eventId: string,
  imageId: string,
): Promise<ImageView[]> {
  return underLock(ctx, principal, eventId, async (trx, now) => {
    const chosen = await rowOf(trx, eventId, imageId);
    if (chosen.role === 'cover') return (await imagesOf(trx, [eventId])).get(eventId)!;
    const cover = await trx
      .selectFrom('app.event_images')
      .select('id')
      .where('event_id', '=', eventId)
      .where('role', '=', 'cover')
      .executeTakeFirst();
    // Positions are unique at commit (deferred), so the two rows can trade places.
    if (cover)
      await trx
        .updateTable('app.event_images')
        .set({ role: 'gallery', position: chosen.position })
        .where('id', '=', cover.id)
        .execute();
    await trx
      .updateTable('app.event_images')
      .set({ role: 'cover', position: 0 })
      .where('id', '=', imageId)
      .execute();
    if (!cover) await compactGallery(trx, eventId);
    await recordAudit(trx, {
      now,
      action: 'cover_changed',
      actorKind: 'owner',
      actorAccountId: principal.accountId,
      eventId,
      subjectId: imageId,
      outcome: 'success',
    });
    return (await imagesOf(trx, [eventId])).get(eventId)!;
  });
}

/** For event deletion: the keys whose files go once the deleting transaction has committed. */
export async function deleteEventImages(trx: Tx, eventId: string): Promise<string[]> {
  const rows = await trx
    .deleteFrom('app.event_images')
    .where('event_id', '=', eventId)
    .returning('storage_key')
    .execute();
  return rows.map((r) => r.storage_key);
}
