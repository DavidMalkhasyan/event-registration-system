import sharp from 'sharp';
import { AppError } from '../../platform/errors.js';

// Image intake (K-712, PD-92). An upload is accepted only when its bytes are a JPEG, PNG or WebP image
// (checked by content, never by the declared type or a file name), with sensible dimensions. It is then
// decoded and re-encoded by the server: the stored files are new WebP images without EXIF, XMP, ICC or
// other metadata (location, camera, author), oriented as the camera recorded and scaled down to at most
// 2000 px. SVG, GIF, HEIC, PDF and everything else are refused; nothing from the original file is kept.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MIN_SIDE = 200;
const MAX_INPUT_PIXELS = 40_000_000; // decompression-bomb guard: refused before decoding
const FULL_SIDE = 2000;
const THUMB_SIDE = 640;

type Format = 'jpeg' | 'png' | 'webp';

/** The format the bytes really are, from their signature; null for anything else. */
export function sniffFormat(data: Buffer): Format | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (
    data.length >= 8 &&
    data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'webp';
  return null;
}

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

function refuse(reason: string): AppError {
  return new AppError(422, 'image_rejected', { reason });
}

// K-719: decoding is CPU- and memory-heavy; at most this many images are processed at once per web
// process, the rest wait (each upload is also limited per organizer and to 10 MB).
const MAX_CONCURRENT = 2;
let active = 0;
const waiting: (() => void)[] = [];
async function slot(): Promise<() => void> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active += 1;
  return () => {
    active -= 1;
    waiting.shift()?.();
  };
}

export async function processImage(data: Buffer): Promise<ProcessedImage> {
  const release = await slot();
  try {
    return await processOne(data);
  } finally {
    release();
  }
}

async function processOne(data: Buffer): Promise<ProcessedImage> {
  if (data.length === 0) throw refuse('empty');
  if (data.length > MAX_UPLOAD_BYTES) throw new AppError(413, 'image_too_large');
  const format = sniffFormat(data);
  if (!format) throw refuse('unsupported_type');
  const input = () =>
    sharp(data, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
      animated: false,
      sequentialRead: true,
    });
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>;
  try {
    meta = await input().metadata();
  } catch (error) {
    // libvips enforces limitInputPixels on the header alone, before decoding anything.
    throw refuse(/pixel limit/i.test((error as Error).message) ? 'too_many_pixels' : 'unreadable');
  }
  if (meta.format !== format) throw refuse('unsupported_type');
  if (!meta.width || !meta.height) throw refuse('unreadable');
  if ((meta.pages ?? 1) > 1) throw refuse('animated');
  // The header's dimensions, before any pixel is decoded (a small file can claim a huge image).
  if (meta.width * meta.height > MAX_INPUT_PIXELS) throw refuse('too_many_pixels');
  // Orientation 5 to 8 swaps the sides once applied.
  const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  if (w < MIN_SIDE || h < MIN_SIDE) throw refuse('too_small');
  try {
    const full = await input()
      .rotate() // applies the EXIF orientation, then the metadata is not written out
      .resize({ width: FULL_SIDE, height: FULL_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    const thumb = await input()
      .rotate()
      .resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 74, effort: 4 })
      .toBuffer();
    return { full: full.data, thumb, width: full.info.width, height: full.info.height };
  } catch {
    throw refuse('unreadable');
  }
}
