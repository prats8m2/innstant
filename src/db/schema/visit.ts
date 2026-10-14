import { pgTable, uuid, text, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  pk, ts, createdAt, updatedAt, tenantId, propertyId,
  fulfilmentMode, visitLinkKind, visitStatus,
} from './_shared';
import { outlets } from './catalog';
import { guests } from './stay';

/**
 * D-079 — the property link, and what somebody who opens one is doing.
 *
 * ─── Why this is not a stay ────────────────────────────────────────────────
 *
 * The obvious cheap answer is to mint a `stays` row against a virtual room and
 * let the whole product keep working unchanged. It was considered and rejected
 * for reasons that are structural, not aesthetic:
 *
 *   · `stays` carries a partial unique index that permits ONE active stay per
 *     room. Two people ordering from two tables would be a constraint
 *     violation, and one virtual room per table turns a seating plan into a
 *     floor plan the housekeeping board has to pretend is real.
 *   · A stay appears on the room board, the occupancy count, the arrivals list
 *     and the checkout queue. A person eating lunch is on none of those.
 *   · `stays.scheduled_checkout_at` is NOT NULL and load-bearing: it is what
 *     every guest session's expiry is computed from. A diner has no checkout.
 *
 * So a visit is a SIBLING of a stay, not a kind of one. Both are an ordering
 * context: the thing a cart, an order and a guest session hang off. CLAUDE.md
 * #4 is untouched — nothing here inserts into `stays`, and `createStay()`
 * remains the one door for the one thing it is the door to.
 *
 * ─── What a visit deliberately does NOT have ───────────────────────────────
 *
 * A folio. A folio is what a stay accumulates and settles at checkout; a visit
 * pays per order, at the counter or on delivery. `postFolioLine()` is skipped
 * for visit orders rather than given a nullable stay — see modules/billing and
 * D-079. When online payment arrives it attaches to the ORDER, which is where
 * a restaurant's money actually lives.
 */

/**
 * The link itself — the visit-side counterpart of `room_qr_codes`.
 *
 * `public_code` is globally unique for the same reason a room code is: the
 * scan resolves the property FROM the code, so it cannot be scoped to a
 * property at lookup time.
 *
 * Unlike a room sticker, this one is meant to be PUBLIC — printed on a table
 * tent, posted in an Instagram bio, put on a menu board. That changes the
 * threat model rather than removing it: there is no room to charge, so the
 * capability the code grants is "order food and pay for it", which is what a
 * restaurant wants a stranger to be able to do. The code is still random
 * (`newPublicCode()`), because a guessable scheme would let somebody enumerate
 * a chain's tables and that is nobody's idea of a feature.
 */
export const visitLinks = pgTable('visit_links', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  /** Which menu this link opens. A property with a rooftop bar and a cafe
   *  prints two links, and each one lands on its own menu. */
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),

  /** What the URL carries: `/p/{publicCode}`. Random, never sequential — see
   *  the note above and `newPublicCode()`. */
  publicCode: text('public_code').notNull(),

  /**
   * TABLE   — a table tent. Dine-in, and `table_label` is preset from here,
   *           so the diner never types "4" and never mistypes it.
   * COUNTER — a code at the till. Takeaway; the kitchen calls a name.
   * ONLINE  — a link in a bio or a WhatsApp message. The customer chooses
   *           pickup or delivery; delivery asks for an address.
   *
   * Separate from `fulfilment_mode` on purpose. A link is a PLACE a code
   * lives; a fulfilment is what one person decided to do. ONLINE is the whole
   * reason they are not one enum — it resolves to two different fulfilments
   * depending on an answer the link cannot know.
   */
  kind: visitLinkKind('kind').notNull().default('ONLINE'),

  /** What staff call this link in the admin list — "Table 4", "Instagram bio",
   *  "Front counter". Never shown to a customer. */
  label: text('label').notNull(),

  /** Set only for kind = TABLE. What the kitchen ticket says: "Table 4",
   *  "Terrace 2". Copied onto the visit at open, so renaming the link cannot
   *  move an order that is already on the pass (#6's reasoning, one level up). */
  tableLabel: text('table_label'),

  /** Reprinting a tent mints a new version and revokes the old one — exactly
   *  `room_qr_codes`, and for the same reason: a code someone photographed off
   *  an old menu must stop working when the restaurant decides it should. */
  version: integer('version').notNull().default(1),
  revokedAt: ts('revoked_at'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  // Globally unique — the scan resolves the tenant from the code.
  uniqueIndex('visit_links_public_code_uq').on(t.publicCode),
  index('visit_links_property_idx').on(t.propertyId, t.outletId),
]);

/**
 * One person's ordering context. The visit-side `stays`.
 *
 * Created by `openVisit()` and nothing else — the same discipline as
 * EXTENSION-POINTS §A applies here for the same reason, and it is enforced the
 * same way: `src/db/schema/visit` is importable only from `modules/visit`.
 *
 * ─── Why the customer's details are nullable ───────────────────────────────
 *
 * CLAUDE.md #9. Browsing is never gated, and that rule does not soften because
 * the person is on a pavement rather than in a room. A visit opens the instant
 * the link is opened, with nothing known about whoever opened it; the name and
 * the phone are asked for at CHECKOUT, once, because the kitchen has to be able
 * to call when the order is ready and a delivery has to arrive somewhere.
 *
 * That is the same shape as D-012 — one question, at the point it becomes
 * necessary — and not the same mechanism: there is no tier to escalate because
 * there is no room to charge. `placeVisitOrder()` refuses an unnamed visit, and
 * that refusal is a form validation, not an access control.
 */
export const visits = pgTable('visits', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),
  /** Null when staff opened a visit at the counter on somebody's behalf, or
   *  when the link it came from has since been deleted. Kept for analytics —
   *  "which table tent actually gets used" is the question a GM asks first. */
  visitLinkId: uuid('visit_link_id').references(() => visitLinks.id, { onDelete: 'set null' }),

  /**
   * What KIND of link opened this, copied at `openVisit()`. D-081.
   *
   * Denormalised on purpose. The account's order history is DIRECT-link
   * orders only, and `orders.fulfilment` cannot express that rule: TAKEAWAY
   * is produced by both a COUNTER link and an ONLINE one, and only the second
   * counts. Without this column the history query is a two-hop join through
   * `visit_links` to ask a question the visit should be able to answer itself
   * — and `visit_link_id` is ON DELETE SET NULL, so that join does not even
   * survive a deleted link.
   *
   * Null for a visit staff opened at the counter with no link behind it.
   */
  linkKind: visitLinkKind('link_kind'),

  status: visitStatus('status').notNull().default('OPEN'),
  /** Never IN_ROOM — that belongs to a stay. The CHECK is in the migration;
   *  Drizzle cannot express it. */
  fulfilment: fulfilmentMode('fulfilment').notNull().default('DINE_IN'),

  /** Asked for once, at checkout. See the note above. */
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),

  /** DINE_IN. Copied from the link at open so a renamed tent cannot move a
   *  tray that is already cooking. */
  tableLabel: text('table_label'),

  /** DELIVERY. Free text on purpose: an Indian address is a landmark and a
   *  floor as often as it is a line and a pincode, and a form that insists on
   *  structure gets "near the temple" typed into `street_1` anyway. */
  deliveryAddress: text('delivery_address'),
  deliveryNotes: text('delivery_notes'),

  /**
   * EXTENSION-POINTS §2 — tenant-scoped `guests`, reached by (tenant, phone).
   *
   * Filled in at checkout when the phone matches a guest the tenant already
   * knows, which is how a regular at the restaurant and a guest who stayed last
   * March turn out to be one person without anybody merging anything later.
   */
  guestId: uuid('guest_id').references(() => guests.id),

  /** A visit's session expires from here, the way a stay's expires from its
   *  checkout. There is no checkout to hang it on, so the visit carries it. */
  expiresAt: ts('expires_at').notNull(),
  closedAt: ts('closed_at'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('visits_property_status_idx').on(t.propertyId, t.status),
  index('visits_outlet_idx').on(t.outletId, t.createdAt),
  index('visits_link_idx').on(t.visitLinkId),
]);
