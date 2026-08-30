import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { pk, ts, createdAt, updatedAt, tenantId, propertyId, currency, orderStatus } from './_shared';
import { stays } from './stay';
import { outlets, menuItems, modifierOptions } from './catalog';

/**
 * Ordering. Two things carry the weight here:
 *
 * #6 — every transactional line SNAPSHOTS name and price. The FK back to the
 * catalog is `ON DELETE SET NULL` and exists for analytics only. Renaming a
 * dish must never alter a past receipt.
 *
 * Carts are the exception, deliberately: they hold LIVE foreign keys and no
 * snapshots. A cart is pre-transactional, so a dish repriced while it sits in
 * a cart should update. Snapshotting happens at placement. The consequence is
 * that a total can change between cart and confirmation — P1 needs a UI
 * affordance for that, it is not a bug.
 */

/** One cart per (stay, outlet) — enforced by the unique index below. */
export const carts = pgTable('carts', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  stayId: uuid('stay_id').notNull().references(() => stays.id),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('carts_stay_outlet_uq').on(t.stayId, t.outletId)]);

export const cartItems = pgTable('cart_items', {
  id: pk(),
  tenantId: tenantId(),
  cartId: uuid('cart_id').notNull().references(() => carts.id, { onDelete: 'cascade' }),
  /** Live FK, not a snapshot — see the note at the top of this file. */
  menuItemId: uuid('menu_item_id').notNull().references(() => menuItems.id, { onDelete: 'cascade' }),

  quantity: integer('quantity').notNull().default(1),
  notes: text('notes'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('cart_items_cart_idx').on(t.cartId)]);

export const cartItemModifiers = pgTable('cart_item_modifiers', {
  id: pk(),
  tenantId: tenantId(),
  cartItemId: uuid('cart_item_id').notNull().references(() => cartItems.id, { onDelete: 'cascade' }),
  modifierOptionId: uuid('modifier_option_id').notNull().references(() => modifierOptions.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('cart_item_modifiers_uq').on(t.cartItemId, t.modifierOptionId)]);

export const orders = pgTable('orders', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  stayId: uuid('stay_id').notNull().references(() => stays.id),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id),

  /** Human-facing, printed on the KDS ticket and quoted by the guest: KE-1184. */
  orderNumber: text('order_number').notNull(),
  status: orderStatus('status').notNull().default('DRAFT'),

  /** #5 — every amount is minor units, and the currency is on the row. */
  subtotalMinor: integer('subtotal_minor').notNull().default(0),
  taxMinor: integer('tax_minor').notNull().default(0),
  serviceChargeMinor: integer('service_charge_minor').notNull().default(0),
  deliveryFeeMinor: integer('delivery_fee_minor').notNull().default(0),
  tipMinor: integer('tip_minor').notNull().default(0),
  totalMinor: integer('total_minor').notNull().default(0),
  currency: currency(),

  /** Copied from the guest's profile at placement (DATA-MODEL §4) — the
   *  kitchen must see the allergy that applied on the night, not today's. */
  dietaryFlags: jsonb('dietary_flags').notNull().default(sql`'[]'::jsonb`),
  guestNotes: text('guest_notes'),

  /** Redundant with event_log on purpose: the timestamps make the dashboard
   *  queries cheap, the log makes them provable (DATA-MODEL §6). */
  placedAt: ts('placed_at'),
  acceptedAt: ts('accepted_at'),
  preparingAt: ts('preparing_at'),
  readyAt: ts('ready_at'),
  outForDeliveryAt: ts('out_for_delivery_at'),
  deliveredAt: ts('delivered_at'),
  closedAt: ts('closed_at'),

  promisedByAt: ts('promised_by_at'),
  rejectionReason: text('rejection_reason'),
  cancellationReason: text('cancellation_reason'),
  assignedRunnerId: uuid('assigned_runner_id'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('orders_property_number_uq').on(t.propertyId, t.orderNumber),
  // DATA-MODEL §9 — the KDS open-ticket query, oldest first.
  index('orders_kds_idx').on(t.outletId, t.status, t.placedAt),
  index('orders_stay_idx').on(t.stayId),
]);

export const orderItems = pgTable('order_items', {
  id: pk(),
  tenantId: tenantId(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),

  /** Analytics only. ON DELETE SET NULL — the receipt survives the dish. */
  menuItemId: uuid('menu_item_id').references(() => menuItems.id, { onDelete: 'set null' }),

  /** #6 — the receipt. These are what render, always. */
  nameSnapshot: text('name_snapshot').notNull(),
  unitPriceMinor: integer('unit_price_minor').notNull(),
  imageUrlSnapshot: text('image_url_snapshot'),
  currency: currency(),

  quantity: integer('quantity').notNull().default(1),
  lineTotalMinor: integer('line_total_minor').notNull(),
  notes: text('notes'),

  createdAt: createdAt(),
}, (t) => [index('order_items_order_idx').on(t.orderId)]);

export const orderItemModifiers = pgTable('order_item_modifiers', {
  id: pk(),
  tenantId: tenantId(),
  orderItemId: uuid('order_item_id').notNull().references(() => orderItems.id, { onDelete: 'cascade' }),

  /** Analytics only, same rule as the item. */
  modifierOptionId: uuid('modifier_option_id').references(() => modifierOptions.id, { onDelete: 'set null' }),

  nameSnapshot: text('name_snapshot').notNull(),
  priceDeltaMinor: integer('price_delta_minor').notNull(),
  currency: currency(),

  createdAt: createdAt(),
}, (t) => [index('order_item_modifiers_item_idx').on(t.orderItemId)]);
