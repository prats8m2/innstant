import { randomUUID } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';
import { encode } from 'blurhash';
import { ValidationError } from '@/lib/errors';
import { MEDIA_WIDTHS, mediaKey, mediaPath, type MediaPurpose } from './paths';

/** Larger than a phone's camera roll ever hands over; smaller than the 10MB a
 *  request body may carry through the middleware. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** 50 megapixels. A decompression bomb is a small file that claims a huge
 *  canvas; sharp refuses beyond this before allocating it. */
const MAX_INPUT_PIXELS = 50_000_000;

const ACCEPTED = new Set(['jpeg', 'png', 'webp', 'avif']);

export interface PreparedMedia {
  id: string;
  purpose: MediaPurpose;
  /** The path the picture is saved under — what a dish's `image_url` holds. */
  path: string;
  width: number;
  height: number;
  blurhash: string | null;
  variants: Array<{ key: string; width: number; body: Buffer }>;
  bytes: number;
}

/**
 * An upload, made safe and made small.
 *
 * - The FORMAT is read from the bytes, never from the file name or the type
 *   the browser claimed. Anything sharp cannot decode as JPEG, PNG, WebP or
 *   AVIF is refused, which includes SVG (it can carry script) and every
 *   document pretending to be a picture.
 * - Rotated to how it was taken (`rotate()` reads the EXIF orientation), then
 *   every bit of metadata is dropped. A phone photo carries the GPS position
 *   it was taken at, and these go on a public menu.
 * - Cut to each width of its purpose as WebP, never enlarged.
 * - A blurhash from a 32px copy, for the placeholder while it loads.
 */
export async function prepareMedia(data: Buffer, purpose: MediaPurpose): Promise<PreparedMedia> {
  if (data.length === 0) throw new ValidationError('That file is empty.');
  if (data.length > MAX_UPLOAD_BYTES) {
    throw new ValidationError('That picture is over 8MB. A photo straight from a phone is usually well under.');
  }

  let meta: Metadata;
  try {
    meta = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ValidationError('That is not a picture this can read. Use a JPEG, PNG or WebP.');
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) {
    throw new ValidationError('Use a JPEG, PNG or WebP picture.');
  }

  const id = randomUUID();
  const widths = MEDIA_WIDTHS[purpose];
  // A logo is usually a mark on transparency; keep it crisp. A photograph
  // loses nothing a guest can see at 78.
  const quality = purpose === 'logo' ? 90 : 78;

  const variants: PreparedMedia['variants'] = [];
  let largest = { width: 0, height: 0 };
  for (const width of widths) {
    const { data: body, info } = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, alphaQuality: 100 })
      .toBuffer({ resolveWithObject: true });
    variants.push({ key: mediaKey(id, width), width, body });
    largest = { width: info.width, height: info.height };
  }

  return {
    id,
    purpose,
    path: mediaPath(id, widths.at(-1)!),
    width: largest.width,
    height: largest.height,
    blurhash: await blurhashOf(data),
    variants,
    bytes: variants.reduce((sum, v) => sum + v.body.length, 0),
  };
}

async function blurhashOf(data: Buffer): Promise<string | null> {
  try {
    const { data: pixels, info } = await sharp(data, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return encode(new Uint8ClampedArray(pixels), info.width, info.height, 4, 3);
  } catch {
    // A placeholder is a nicety. A picture without one is still a picture.
    return null;
  }
}
