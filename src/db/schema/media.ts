import { pgTable, text, integer, uuid, index } from 'drizzle-orm/pg-core';
import { pk, tenantId, propertyId, createdAt } from './_shared';
import { staffUsers } from './identity';

/**
 * Pictures a manager uploaded (0014, D-093).
 *
 * One row per upload. The bytes are not here: they are in object storage (a
 * Railway bucket in production, a folder on disk in development), at
 * `media/<id>/<width>.webp`, one object per width in `widths`. A row is
 * written only after every width has been stored, so a row always has its
 * files.
 *
 * Nothing references this table by foreign key. What a dish, a logo or a
 * cover stores is the picture's PATH, `/media/<id>/1280.webp`, in the
 * `image_url` it always had — relative, so it survives a change of domain or
 * of storage, and it is what an order line snapshots (#6). This row is the
 * record behind that path: who uploaded it, its size and its blurhash.
 *
 * Pictures are public once uploaded: they are served to guests on a menu,
 * by an id nobody can guess, without a session.
 */
export const mediaAssets = pgTable('media_assets', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  /** What it was uploaded FOR — `dish`, `logo`, `cover`. Decides the
   *  permission the upload needed and how it was cut. */
  purpose: text('purpose').notNull(),
  /** Of the largest stored width, after rotation. */
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  /** The widths stored, ascending. Never wider than the original. */
  widths: integer('widths').array().notNull(),
  blurhash: text('blurhash'),
  /** Of every stored width together — what it costs to keep. */
  bytes: integer('bytes').notNull(),
  uploadedByStaffId: uuid('uploaded_by_staff_id').references(() => staffUsers.id),
  createdAt: createdAt(),
}, (t) => [index('media_assets_property_idx').on(t.propertyId, t.createdAt)]);
