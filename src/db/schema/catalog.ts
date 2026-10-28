import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, integer, smallint, date, boolean, jsonb, index, uniqueIndex, primaryKey,
  timestamp,
} from 'drizzle-orm/pg-core';
import {
  pk, createdAt, updatedAt, tenantId, propertyId, archivedAt, currency, outletKind,
  menuOfferScope, menuOfferKind,
} from './_shared';

/**
 * The catalog. D-008: catalog rows change, receipts must not — so everything
 * here is ARCHIVED (`archived_at`), never hard-deleted, and every transactional
 * line snapshots what it needs at write time (see ordering.ts).
 */

export const outlets = pgTable('outlets', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),

  kind: outletKind('kind').notNull().default('IN_ROOM_DINING'),
  name: text('name').notNull(),
  description: text('description'),
  imageUrl: text('image_url'),

  /** Basis points, so the rate itself is an integer and rounding happens in
   *  exactly one place — see src/lib/money.ts applyRateBps. */
  taxRateBps: integer('tax_rate_bps').notNull().default(0),
  serviceChargeBps: integer('service_charge_bps').notNull().default(0),
  deliveryFeeMinor: integer('delivery_fee_minor').notNull().default(0),
  minimumOrderMinor: integer('minimum_order_minor').notNull().default(0),
  currency: currency(),

  isAcceptingOrders: boolean('is_accepting_orders').notNull().default(true),
  prepTimeMinutes: integer('prep_time_minutes').notNull().default(30),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('outlets_property_idx').on(t.propertyId, t.kind)]);

/** Property-local times — a business day rolls over in the property's
 *  timezone, not the server's. `dayOfWeek` 0 = Sunday. */
export const outletHours = pgTable('outlet_hours', {
  id: pk(),
  tenantId: tenantId(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id, { onDelete: 'cascade' }),

  dayOfWeek: integer('day_of_week').notNull(),
  opensAt: text('opens_at').notNull(),
  closesAt: text('closes_at').notNull(),
  /** True when closesAt is past midnight — the "After 10pm" collection needs
   *  this to be explicit rather than inferred from opensAt > closesAt. */
  crossesMidnight: boolean('crosses_midnight').notNull().default(false),

  createdAt: createdAt(),
}, (t) => [index('outlet_hours_outlet_idx').on(t.outletId, t.dayOfWeek)]);

export const menuCategories = pgTable('menu_categories', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('menu_categories_outlet_idx').on(t.outletId, t.sortOrder)]);

export const menuItems = pgTable('menu_items', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').notNull().references(() => menuCategories.id),

  name: text('name').notNull(),
  description: text('description'),

  /** #5 — integer minor units, explicit currency on the same row. */
  priceMinor: integer('price_minor').notNull(),
  currency: currency(),

  imageUrl: text('image_url'),
  /** Rendered while the image loads, so a slow hotel wifi connection does not
   *  show a grey box. Design treats image slots as first-class. */
  blurhash: text('blurhash'),

  dietaryFlags: jsonb('dietary_flags').notNull().default(sql`'[]'::jsonb`),
  spiceLevel: integer('spice_level'),
  prepTimeMinutes: integer('prep_time_minutes'),

  /** D-086 (migration 0012). Portions a day; NULL is no limit. Counted in
   *  `menu_item_daily_sales`, claimed atomically by placeOrder(). */
  dailyLimit: integer('daily_limit'),
  isAvailable: boolean('is_available').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  // DATA-MODEL §9 — the two menu-render queries.
  index('menu_items_category_sort_idx').on(t.categoryId, t.sortOrder),
  index('menu_items_outlet_available_idx').on(t.outletId, t.isAvailable),
]);

/** Reusable across items — that reuse is what forces the join table below. */
export const modifierGroups = pgTable('modifier_groups', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  minSelections: integer('min_selections').notNull().default(0),
  maxSelections: integer('max_selections').notNull().default(1),
  isRequired: boolean('is_required').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('modifier_groups_outlet_idx').on(t.outletId)]);

export const modifierOptions = pgTable('modifier_options', {
  id: pk(),
  tenantId: tenantId(),
  groupId: uuid('group_id').notNull().references(() => modifierGroups.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  /** Signed: a modifier may reduce the price. */
  priceDeltaMinor: integer('price_delta_minor').notNull().default(0),
  currency: currency(),

  isAvailable: boolean('is_available').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('modifier_options_group_idx').on(t.groupId, t.sortOrder)]);

export const menuItemModifierGroups = pgTable('menu_item_modifier_groups', {
  id: pk(),
  tenantId: tenantId(),
  menuItemId: uuid('menu_item_id').notNull().references(() => menuItems.id, { onDelete: 'cascade' }),
  modifierGroupId: uuid('modifier_group_id').notNull().references(() => modifierGroups.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('menu_item_modifier_groups_uq').on(t.menuItemId, t.modifierGroupId)]);

/** Editorial collections — "From the rooftop", "After 10pm",
 *  "Chef Bhairav's table". Curated, not a category. */
export const collections = pgTable('collections', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  /** The GM's own one-line note. This is the editorial voice of the product. */
  editorialNote: text('editorial_note'),
  imageUrl: text('image_url'),

  /** A collection may only surface inside a window — "After 10pm" is literal. */
  availableFrom: text('available_from'),
  availableUntil: text('available_until'),

  /**
   * D-084 (migration 0010). Which days it runs, 0 = Sunday; NULL is every
   * day, and an empty array is refused by a CHECK. Property-local dates,
   * inclusive, either end open. A window past midnight belongs to the day it
   * started — isCollectionLive() in modules/catalog/hours.ts.
   */
  daysOfWeek: smallint('days_of_week').array(),
  startsOn: date('starts_on', { mode: 'string' }),
  endsOn: date('ends_on', { mode: 'string' }),

  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('collections_outlet_idx').on(t.outletId, t.sortOrder)]);

export const collectionItems = pgTable('collection_items', {
  id: pk(),
  tenantId: tenantId(),
  collectionId: uuid('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  menuItemId: uuid('menu_item_id').notNull().references(() => menuItems.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('collection_items_uq').on(t.collectionId, t.menuItemId)]);

/** Scheduled availability, distinct from the `is_available` kill switch the
 *  kitchen flips from the KDS mid-service. */
export const menuItemAvailabilityWindows = pgTable('menu_item_availability_windows', {
  id: pk(),
  tenantId: tenantId(),
  menuItemId: uuid('menu_item_id').notNull().references(() => menuItems.id, { onDelete: 'cascade' }),

  dayOfWeek: integer('day_of_week'),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  crossesMidnight: boolean('crosses_midnight').notNull().default(false),

  createdAt: createdAt(),
}, (t) => [index('menu_item_availability_windows_item_idx').on(t.menuItemId)]);

/**
 * D-085 (migration 0011). An automatic offer: % or ₹ off a dish, a section,
 * or the whole menu, on the same schedule a collection has (D-084). Never
 * stacked: the best single live offer for a dish is the one that applies,
 * decided by `bestOffer()` in modules/catalog/offers.ts. CHECKs keep the
 * target ids honest to `scope`, and exactly one of percent / amount set.
 * NOT `promotions`, which is reserved (CLAUDE.md #12).
 */
export const menuOffers = pgTable('menu_offers', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  outletId: uuid('outlet_id').notNull().references(() => outlets.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  scope: menuOfferScope('scope').notNull(),
  menuItemId: uuid('menu_item_id').references(() => menuItems.id),
  categoryId: uuid('category_id').references(() => menuCategories.id),

  kind: menuOfferKind('kind').notNull(),
  /** PERCENT only. 2000 = 20%. */
  percentBps: integer('percent_bps'),
  /** AMOUNT only, in `currency`. Never takes a dish below zero. */
  amountMinor: integer('amount_minor'),
  currency: currency(),

  availableFrom: text('available_from'),
  availableUntil: text('available_until'),
  daysOfWeek: smallint('days_of_week').array(),
  startsOn: date('starts_on', { mode: 'string' }),
  endsOn: date('ends_on', { mode: 'string' }),

  isActive: boolean('is_active').notNull().default(true),
  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('menu_offers_outlet_idx').on(t.outletId)]);

/**
 * D-086 (migration 0012). How many of a limited dish have gone today, per
 * property-local business date. Written only by claimDailyPortions() (one
 * conditional upsert, so the last portion goes to exactly one order) and
 * releaseDailyPortions() (a rejected or cancelled order gives them back).
 */
export const menuItemDailySales = pgTable('menu_item_daily_sales', {
  tenantId: tenantId(),
  menuItemId: uuid('menu_item_id').notNull().references(() => menuItems.id, { onDelete: 'cascade' }),
  businessDate: date('business_date', { mode: 'string' }).notNull(),
  sold: integer('sold').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.menuItemId, t.businessDate] })]);
