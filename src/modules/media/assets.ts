import { eq } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { mediaAssets } from '@/db/schema/media';
import { ValidationError } from '@/lib/errors';
import type { PreparedMedia } from './process';
import { parseMediaPath } from './paths';
import { mediaStorage } from './storage';

/**
 * Store every width of a prepared picture.
 *
 * Before the row, not inside its transaction: a transaction held open across
 * three uploads to a bucket is a pooled connection held for seconds. The cost
 * of that order is that a failure between the two leaves files no row points
 * at — unreachable, and pennies — never a row with no files, which would be a
 * broken picture on a menu.
 */
export async function storeMedia(prepared: PreparedMedia): Promise<void> {
  const storage = mediaStorage();
  for (const variant of prepared.variants) {
    await storage.put(variant.key, variant.body, 'image/webp');
  }
}

/** The record of an upload, and its audit row (#7), in the caller's tenant
 *  transaction. Returns the path to save on whatever it was uploaded for. */
export async function recordMedia(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    staffUserId: string;
    prepared: PreparedMedia;
  },
): Promise<{ id: string; path: string; blurhash: string | null }> {
  const { prepared } = input;
  await tx.insert(mediaAssets).values({
    id: prepared.id,
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    purpose: prepared.purpose,
    width: prepared.width,
    height: prepared.height,
    widths: prepared.variants.map((v) => v.width),
    blurhash: prepared.blurhash,
    bytes: prepared.bytes,
    uploadedByStaffId: input.staffUserId,
  });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'media_asset',
    entityId: prepared.id,
    eventType: 'media.uploaded',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { purpose: prepared.purpose, width: prepared.width, height: prepared.height, bytes: prepared.bytes },
  });

  return { id: prepared.id, path: prepared.path, blurhash: prepared.blurhash };
}

/**
 * An upload of THIS property's, or null. What a save checks before writing a
 * `/media/...` path onto a dish or a logo: RLS keeps another hotel's rows out,
 * and the property check keeps a sister property's out too.
 */
export async function findMediaAsset(
  tx: Tx,
  input: { propertyId: string; id: string },
): Promise<{ id: string; purpose: string; blurhash: string | null } | null> {
  const [row] = await tx
    .select({ id: mediaAssets.id, purpose: mediaAssets.purpose, blurhash: mediaAssets.blurhash, propertyId: mediaAssets.propertyId })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, input.id))
    .limit(1);
  if (!row || row.propertyId !== input.propertyId) return null;
  return { id: row.id, purpose: row.purpose, blurhash: row.blurhash };
}

/**
 * Before a save writes a value onto a dish or a logo: if it is an upload's
 * path, the upload must be this property's. Anything else (empty, or a URL
 * pasted before uploads existed) passes through for the caller's own rules.
 *
 * Returns the upload's blurhash when it is one, so a dish can carry it.
 */
export async function checkOwnMedia(
  tx: Tx,
  input: { propertyId: string; value: string | null | undefined; label: string },
): Promise<{ isUpload: boolean; blurhash: string | null }> {
  const parsed = parseMediaPath(input.value);
  if (!parsed) return { isUpload: false, blurhash: null };
  const asset = await findMediaAsset(tx, { propertyId: input.propertyId, id: parsed.id });
  if (!asset) {
    throw new ValidationError(`${input.label} is not a picture uploaded here. Upload it again.`);
  }
  return { isUpload: true, blurhash: asset.blurhash };
}
