import { sql } from 'drizzle-orm';
import { pgEnum, timestamp, uuid, text } from 'drizzle-orm/pg-core';

/**
 * Column builders shared by every table. Imported by schema files only.
 *
 * These exist so the invariants are structural rather than remembered. A table
 * that forgets `tenant_id` is a cross-hotel leak (D-004/D-005); a money column
 * that forgets its currency is a silently wrong receipt (#5). Making them
 * one-liners is the cheapest way to make forgetting them visible in review.
 */

/** Timestamps are ALWAYS timestamptz. Rendering happens in the property's
 *  timezone, never the server's — see CLAUDE.md "Dates". */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const pk = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

export const createdAt = () => ts('created_at').notNull().defaultNow();
export const updatedAt = () => ts('updated_at').notNull().defaultNow();

/** Every tenant-scoped table carries this. RLS policies read app.tenant_id
 *  and compare against it. There is no table exempt from this except the
 *  tenants table itself. */
export const tenantId = () => uuid('tenant_id').notNull();

/** Most tables also carry property_id, because that is what queries actually
 *  filter on and it avoids a join on every read path (DATA-MODEL §1). */
export const propertyId = () => uuid('property_id').notNull();

/** Catalog rows are archived, never hard-deleted — a deleted dish would
 *  orphan the analytics FK on past receipts (D-008). */
export const archivedAt = () => ts('archived_at');

/** ISO-4217. Denormalised onto every row holding an amount so historical rows
 *  survive a property switching currency (D-009). */
export const currency = () => text('currency').notNull().default('INR');

// ─── Enums ──────────────────────────────────────────────────────────────────

export const stayStatus = pgEnum('stay_status', [
  'RESERVED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW',
]);

/** EXTENSION-POINTS §3 — the discriminator exists now so booking is one more
 *  enum value later, not the first-ever notion that stays have origins.
 *  'OWN_BOOKING' is added in v2. */
export const staySource = pgEnum('stay_source', ['WALK_IN', 'FRONT_DESK', 'PMS_IMPORT']);

/** D-012. A bare scan grants REQUEST. CHARGE is what triggers the one prompt. */
export const accessTier = pgEnum('access_tier', ['BROWSE', 'REQUEST', 'CHARGE', 'FULL']);

export const escalationTrigger = pgEnum('escalation_trigger', [
  'FIRST_CHARGE', 'FIRST_REQUEST', 'ANY_ACTION', 'NEVER',
]);

export const verificationMethod = pgEnum('verification_method', [
  'PHONE_LAST4', 'OTP_SMS', 'STAFF_VOUCH',
]);

export const orderStatus = pgEnum('order_status', [
  'DRAFT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'CLOSED',
  'REJECTED', 'CANCELLED', 'DISPUTED',
]);

export const serviceRequestStatus = pgEnum('service_request_status', [
  'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED',
  'REJECTED', 'CANCELLED',
]);

export const checkoutRequestStatus = pgEnum('checkout_request_status', [
  'REQUESTED', 'APPROVED', 'COMPLETED', 'DECLINED', 'CANCELLED',
]);

export const folioSource = pgEnum('folio_source', [
  'ORDER', 'SERVICE_REQUEST', 'CHECKOUT_FEE', 'ADJUSTMENT', 'PAYMENT', 'MANUAL',
]);

export const outletKind = pgEnum('outlet_kind', [
  'IN_ROOM_DINING', 'RESTAURANT', 'BAR', 'CAFE', 'SPA', 'OTHER',
]);

export const shiftStatus = pgEnum('shift_status', ['SCHEDULED', 'ON_DUTY', 'ON_BREAK', 'OFF_DUTY']);

/**
 * Where the food is going. D-079.
 *
 * `IN_ROOM` is every order this product placed before property links existed:
 * a guest on a stay, charged to a room. The other three belong to a VISIT —
 * somebody who scanned a table tent or opened a link in an Instagram bio, who
 * has no room and no stay (modules/visit).
 *
 * One enum rather than two because the kitchen asks one question. A ticket says
 * where the tray goes, and "Room 214", "Table 4" and "12 MG Road" are three
 * answers to it, not three different questions.
 */
export const fulfilmentMode = pgEnum('fulfilment_mode', [
  'IN_ROOM', 'DINE_IN', 'TAKEAWAY', 'DELIVERY',
]);

/** What a property link IS, which decides what the visit may become. See
 *  `visit_links.kind` for why the two enums are separate. */
export const visitLinkKind = pgEnum('visit_link_kind', ['TABLE', 'COUNTER', 'ONLINE']);

/** A visit is OPEN while somebody is ordering against it. CLOSED once the
 *  last order is delivered or the link's session has lapsed. */
export const visitStatus = pgEnum('visit_status', ['OPEN', 'CLOSED']);
