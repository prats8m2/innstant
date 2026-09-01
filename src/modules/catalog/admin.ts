import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import {
  outlets, outletHours, menuCategories, menuItems, modifierGroups, modifierOptions,
  menuItemModifierGroups, menuItemAvailabilityWindows,
} from '@/db/schema/catalog';
import { parseClock } from '@/lib/clock';
import type { OutletHoursDay, ItemAvailabilityWindow } from './hours';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { CurrencyCode } from '@/lib/money';

/**
 * Editing the menu. The other half of menu.ts — that file shapes the catalog
 * for a guest, this one lets a hotel change it.
 *
 * Two rules run through everything here.
 *
 * **D-008: rows are ARCHIVED, never deleted.** A receipt from last March still
 * points at the dish it sold, and `order_items` snapshots the name and price it
 * charged (#6) so the receipt survives even a rename. Archiving is what keeps
 * the analytics FK resolvable; deleting would null it.
 *
 * **Every edit that changes what a guest sees writes an `event_log` row.** Not
 * because #7 demands it — that is about status changes — but because "who took
 * laal maas off the menu at 9pm on Saturday" is a question a GM asks, and the
 * only place that can answer it is a log written in the same transaction as
 * the change.
 */

/**
 * What a dish is made of, as a fixed vocabulary.
 *
 * Free text here would mean a menu where one dish says `VEG` and the next says
 * `Vegetarian`, and a guest filter that can never be built. Deliberately about
 * COMPOSITION — a guest's own allergy lives on `guest_property_profiles` and
 * uses a different list, because "contains nuts" and "is allergic to nuts" are
 * not the same fact and must not share a column.
 */
export const MENU_DIETARY_FLAGS = [
  'VEGETARIAN', 'VEGAN', 'JAIN', 'GLUTEN_FREE', 'CONTAINS_NUTS', 'CONTAINS_DAIRY',
] as const;

export type MenuDietaryFlag = (typeof MENU_DIETARY_FLAGS)[number];

/* ── The editor's read ───────────────────────────────────────────────────── */

export interface AdminMenuItem {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: CurrencyCode;
  isAvailable: boolean;
  sortOrder: number;
  dietaryFlags: string[];
  spiceLevel: number | null;
  prepTimeMinutes: number | null;
  imageUrl: string | null;
}

export interface AdminMenuCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  items: AdminMenuItem[];
}

export interface AdminMenu {
  outlet: {
    id: string;
    name: string;
    currency: CurrencyCode;
    isAcceptingOrders: boolean;
    prepTimeMinutes: number;
  };
  categories: AdminMenuCategory[];
  /** Items whose category was archived under them — otherwise invisible. */
  orphanedItems: AdminMenuItem[];
}

/**
 * The whole menu, as an editor needs it.
 *
 * Unlike the guest's read this includes UNAVAILABLE items — a dish that is 86'd
 * is precisely the one an F&B manager has come here to turn back on. Archived
 * rows stay excluded: they are history, and nothing on this screen can bring
 * one back (D-008 — reviving a row a receipt points at is how a receipt starts
 * lying).
 */
export async function getAdminMenu(
  tx: Tx,
  input: { outletId: string },
): Promise<AdminMenu | null> {
  const outletRows = await tx.select({
    id: outlets.id,
    name: outlets.name,
    currency: outlets.currency,
    isAcceptingOrders: outlets.isAcceptingOrders,
    prepTimeMinutes: outlets.prepTimeMinutes,
  }).from(outlets)
    .where(and(eq(outlets.id, input.outletId), isNull(outlets.archivedAt)))
    .limit(1);

  const outlet = outletRows[0];
  if (!outlet) return null;

  const categories = await tx.select({
    id: menuCategories.id,
    name: menuCategories.name,
    description: menuCategories.description,
    sortOrder: menuCategories.sortOrder,
  }).from(menuCategories)
    .where(and(
      eq(menuCategories.outletId, input.outletId),
      isNull(menuCategories.archivedAt),
    ))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));

  const items = await tx.select({
    id: menuItems.id,
    categoryId: menuItems.categoryId,
    name: menuItems.name,
    description: menuItems.description,
    priceMinor: menuItems.priceMinor,
    currency: menuItems.currency,
    isAvailable: menuItems.isAvailable,
    sortOrder: menuItems.sortOrder,
    dietaryFlags: menuItems.dietaryFlags,
    spiceLevel: menuItems.spiceLevel,
    prepTimeMinutes: menuItems.prepTimeMinutes,
    imageUrl: menuItems.imageUrl,
  }).from(menuItems)
    .where(and(eq(menuItems.outletId, input.outletId), isNull(menuItems.archivedAt)))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));

  const shape = (row: (typeof items)[number]): AdminMenuItem => ({
    id: row.id,
    name: row.name,
    description: row.description,
    priceMinor: row.priceMinor,
    currency: row.currency as CurrencyCode,
    isAvailable: row.isAvailable,
    sortOrder: row.sortOrder,
    dietaryFlags: Array.isArray(row.dietaryFlags) ? (row.dietaryFlags as string[]) : [],
    spiceLevel: row.spiceLevel,
    prepTimeMinutes: row.prepTimeMinutes,
    imageUrl: row.imageUrl,
  });

  const known = new Set(categories.map((c) => c.id));

  return {
    outlet: {
      ...outlet,
      currency: outlet.currency as CurrencyCode,
    },
    categories: categories.map((category) => ({
      ...category,
      items: items.filter((i) => i.categoryId === category.id).map(shape),
    })),
    // A category can be archived while its items are not. Showing them under a
    // heading of their own beats a dish that exists, is orderable by URL, and
    // appears nowhere an editor can reach it.
    orphanedItems: items.filter((i) => !known.has(i.categoryId)).map(shape),
  };
}

/** One item, for the edit form. Includes which modifier groups it carries. */
export interface AdminMenuItemDetail extends AdminMenuItem {
  categoryId: string;
  modifierGroupIds: string[];
  /** When the dish is on, if it is not on all the time. */
  availabilityWindows: ItemAvailabilityWindow[];
}

export async function getAdminMenuItem(
  tx: Tx,
  input: { outletId: string; itemId: string },
): Promise<AdminMenuItemDetail | null> {
  const rows = await tx.select({
    id: menuItems.id,
    categoryId: menuItems.categoryId,
    name: menuItems.name,
    description: menuItems.description,
    priceMinor: menuItems.priceMinor,
    currency: menuItems.currency,
    isAvailable: menuItems.isAvailable,
    sortOrder: menuItems.sortOrder,
    dietaryFlags: menuItems.dietaryFlags,
    spiceLevel: menuItems.spiceLevel,
    prepTimeMinutes: menuItems.prepTimeMinutes,
    imageUrl: menuItems.imageUrl,
  }).from(menuItems)
    .where(and(
      eq(menuItems.id, input.itemId),
      // Scoped to the outlet, not just the id. RLS confines this to the tenant;
      // an id from a sister property's outlet is a 404, not an edit form.
      eq(menuItems.outletId, input.outletId),
      isNull(menuItems.archivedAt),
    ))
    .limit(1);

  const item = rows[0];
  if (!item) return null;

  const groups = await tx.select({ id: menuItemModifierGroups.modifierGroupId })
    .from(menuItemModifierGroups)
    .where(eq(menuItemModifierGroups.menuItemId, item.id))
    .orderBy(asc(menuItemModifierGroups.sortOrder));

  const windows = await tx.select({
    dayOfWeek: menuItemAvailabilityWindows.dayOfWeek,
    startsAt: menuItemAvailabilityWindows.startsAt,
    endsAt: menuItemAvailabilityWindows.endsAt,
  }).from(menuItemAvailabilityWindows)
    .where(eq(menuItemAvailabilityWindows.menuItemId, item.id))
    .orderBy(asc(menuItemAvailabilityWindows.startsAt));

  return {
    ...item,
    currency: item.currency as CurrencyCode,
    dietaryFlags: Array.isArray(item.dietaryFlags) ? (item.dietaryFlags as string[]) : [],
    modifierGroupIds: groups.map((g) => g.id),
    availabilityWindows: windows,
  };
}

export interface AdminModifierGroup {
  id: string;
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  optionNames: string[];
}

/** The outlet's reusable modifier groups, for the item form's checkboxes. */
export async function listModifierGroups(
  tx: Tx,
  input: { outletId: string },
): Promise<AdminModifierGroup[]> {
  const groups = await tx.select({
    id: modifierGroups.id,
    name: modifierGroups.name,
    isRequired: modifierGroups.isRequired,
    minSelections: modifierGroups.minSelections,
    maxSelections: modifierGroups.maxSelections,
  }).from(modifierGroups)
    .where(and(
      eq(modifierGroups.outletId, input.outletId),
      isNull(modifierGroups.archivedAt),
    ))
    .orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.name));

  if (!groups.length) return [];

  const options = await tx.select({
    groupId: modifierOptions.groupId,
    name: modifierOptions.name,
  }).from(modifierOptions)
    .where(isNull(modifierOptions.archivedAt))
    .orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name));

  return groups.map((group) => ({
    ...group,
    optionNames: options.filter((o) => o.groupId === group.id).map((o) => o.name),
  }));
}

/* ── Categories ─────────────────────────────────────────────────────────── */

export interface CategoryInput {
  tenantId: string;
  propertyId: string;
  outletId: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  actorStaffId: string;
}

export async function createMenuCategory(
  tx: Tx,
  input: CategoryInput,
): Promise<{ id: string }> {
  await assertOutlet(tx, input.outletId);
  const name = requireName(input.name, 'a category');

  const [row] = await tx.insert(menuCategories).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: input.outletId,
    name,
    description: input.description?.trim() || null,
    sortOrder: input.sortOrder ?? await nextSortOrder(tx, {
      table: 'menu_categories', column: 'outlet_id', id: input.outletId,
    }),
  }).returning({ id: menuCategories.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_category',
    entityId: row!.id,
    eventType: 'menu_category.created',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name },
  });

  return { id: row!.id };
}

export async function updateMenuCategory(
  tx: Tx,
  input: Omit<CategoryInput, 'sortOrder'> & { categoryId: string; sortOrder?: number },
): Promise<void> {
  const name = requireName(input.name, 'a category');

  const updated = await tx.update(menuCategories)
    .set({
      name,
      description: input.description?.trim() || null,
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(menuCategories.id, input.categoryId),
      eq(menuCategories.outletId, input.outletId),
      isNull(menuCategories.archivedAt),
    ))
    .returning({ id: menuCategories.id });

  if (!updated[0]) throw new NotFoundError('That section is not on this menu.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_category',
    entityId: input.categoryId,
    eventType: 'menu_category.updated',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name },
  });
}

/**
 * Archive a section.
 *
 * Refuses while it still holds dishes, rather than archiving them with it or
 * leaving them orphaned. Bulk-archiving a menu's worth of items behind one
 * click is not something to do silently, and an orphaned dish is still
 * orderable by URL.
 */
export async function archiveMenuCategory(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    categoryId: string; actorStaffId: string;
  },
): Promise<void> {
  const remaining = await tx.select({ n: count() }).from(menuItems)
    .where(and(
      eq(menuItems.categoryId, input.categoryId),
      isNull(menuItems.archivedAt),
    ));

  const n = Number(remaining[0]?.n ?? 0);
  if (n > 0) {
    throw new ConflictError(
      `Move or archive the ${n} ${n === 1 ? 'dish' : 'dishes'} in this section first.`,
    );
  }

  const archived = await tx.update(menuCategories)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(menuCategories.id, input.categoryId),
      eq(menuCategories.outletId, input.outletId),
      isNull(menuCategories.archivedAt),
    ))
    .returning({ id: menuCategories.id, name: menuCategories.name });

  if (!archived[0]) throw new NotFoundError('That section is not on this menu.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_category',
    entityId: input.categoryId,
    eventType: 'menu_category.archived',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name: archived[0].name },
  });
}

/* ── Items ──────────────────────────────────────────────────────────────── */

export interface MenuItemWriteInput {
  tenantId: string;
  propertyId: string;
  outletId: string;
  categoryId: string;
  name: string;
  description?: string | null;
  priceMinor: number;
  currency: CurrencyCode;
  dietaryFlags?: readonly string[];
  spiceLevel?: number | null;
  prepTimeMinutes?: number | null;
  imageUrl?: string | null;
  isAvailable?: boolean;
  sortOrder?: number;
  actorStaffId: string;
}

export async function createMenuItem(
  tx: Tx,
  input: MenuItemWriteInput,
): Promise<{ id: string }> {
  await assertOutlet(tx, input.outletId);
  await assertCategory(tx, { outletId: input.outletId, categoryId: input.categoryId });
  const name = requireName(input.name, 'a dish');

  const [row] = await tx.insert(menuItems).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: input.outletId,
    categoryId: input.categoryId,
    name,
    description: input.description?.trim() || null,
    priceMinor: input.priceMinor,
    currency: input.currency,
    dietaryFlags: [...(input.dietaryFlags ?? [])],
    spiceLevel: input.spiceLevel ?? null,
    prepTimeMinutes: input.prepTimeMinutes ?? null,
    imageUrl: input.imageUrl?.trim() || null,
    isAvailable: input.isAvailable ?? true,
    sortOrder: input.sortOrder ?? await nextSortOrder(tx, {
      table: 'menu_items', column: 'category_id', id: input.categoryId,
    }),
  }).returning({ id: menuItems.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_item',
    entityId: row!.id,
    eventType: 'menu_item.created',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name, priceMinor: input.priceMinor, currency: input.currency },
  });

  return { id: row!.id };
}

/**
 * Update a dish.
 *
 * A price change gets its OWN event, separate from the edit, and carries both
 * numbers. Repricing is the catalog change that shows up in a dispute — "we
 * were charged more than the menu said" — and answering it needs the old price
 * and the moment it changed, not just the current row.
 */
export async function updateMenuItem(
  tx: Tx,
  input: MenuItemWriteInput & { itemId: string },
): Promise<void> {
  await assertCategory(tx, { outletId: input.outletId, categoryId: input.categoryId });
  const name = requireName(input.name, 'a dish');

  const existing = await tx.select({
    priceMinor: menuItems.priceMinor,
    currency: menuItems.currency,
  }).from(menuItems)
    .where(and(
      eq(menuItems.id, input.itemId),
      eq(menuItems.outletId, input.outletId),
      isNull(menuItems.archivedAt),
    ))
    .limit(1);

  const before = existing[0];
  if (!before) throw new NotFoundError('That dish is not on this menu.');

  await tx.update(menuItems)
    .set({
      categoryId: input.categoryId,
      name,
      description: input.description?.trim() || null,
      priceMinor: input.priceMinor,
      currency: input.currency,
      dietaryFlags: [...(input.dietaryFlags ?? [])],
      spiceLevel: input.spiceLevel ?? null,
      prepTimeMinutes: input.prepTimeMinutes ?? null,
      imageUrl: input.imageUrl?.trim() || null,
      ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      updatedAt: new Date(),
    })
    .where(eq(menuItems.id, input.itemId));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_item',
    entityId: input.itemId,
    eventType: 'menu_item.updated',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name },
  });

  if (before.priceMinor !== input.priceMinor) {
    await recordEvent(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      entityType: 'menu_item',
      entityId: input.itemId,
      eventType: 'menu_item.repriced',
      actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
      payload: {
        name,
        fromMinor: before.priceMinor,
        toMinor: input.priceMinor,
        currency: input.currency,
      },
    });
  }
}

/**
 * The 86 switch.
 *
 * Its own function and its own permission (`catalog:availability`), because a
 * kitchen must be able to say "we are out of sole" mid-service without holding
 * the permission to reprice the menu — see the KITCHEN role in permissions.ts.
 */
export async function setMenuItemAvailability(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    itemId: string; isAvailable: boolean; actorStaffId: string;
  },
): Promise<{ name: string }> {
  const updated = await tx.update(menuItems)
    .set({ isAvailable: input.isAvailable, updatedAt: new Date() })
    .where(and(
      eq(menuItems.id, input.itemId),
      eq(menuItems.outletId, input.outletId),
      isNull(menuItems.archivedAt),
    ))
    .returning({ id: menuItems.id, name: menuItems.name });

  const item = updated[0];
  if (!item) throw new NotFoundError('That dish is not on this menu.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_item',
    entityId: item.id,
    eventType: input.isAvailable ? 'menu_item.available' : 'menu_item.unavailable',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name: item.name },
  });

  return { name: item.name };
}

/** D-008 — archived, never deleted. Old receipts still resolve. */
export async function archiveMenuItem(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    itemId: string; actorStaffId: string;
  },
): Promise<{ name: string }> {
  const archived = await tx.update(menuItems)
    .set({ archivedAt: new Date(), isAvailable: false, updatedAt: new Date() })
    .where(and(
      eq(menuItems.id, input.itemId),
      eq(menuItems.outletId, input.outletId),
      isNull(menuItems.archivedAt),
    ))
    .returning({ id: menuItems.id, name: menuItems.name });

  const item = archived[0];
  if (!item) throw new NotFoundError('That dish is not on this menu.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_item',
    entityId: item.id,
    eventType: 'menu_item.archived',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name: item.name },
  });

  return { name: item.name };
}

/**
 * Which modifier groups a dish carries.
 *
 * Replace, not add: the form posts the full set of ticked boxes, and a diff
 * would need the client to tell us what it thinks the previous state was.
 * Deleting the join rows is safe — `order_item_modifiers` snapshots the name
 * and the price delta it charged (#6), so a past order is untouched.
 */
export async function setMenuItemModifierGroups(
  tx: Tx,
  input: {
    tenantId: string; outletId: string; itemId: string;
    groupIds: readonly string[];
  },
): Promise<void> {
  const owned = input.groupIds.length
    ? await tx.select({ id: modifierGroups.id }).from(modifierGroups)
        .where(and(
          eq(modifierGroups.outletId, input.outletId),
          isNull(modifierGroups.archivedAt),
        ))
    : [];

  const allowed = new Set(owned.map((g) => g.id));
  const groupIds = [...new Set(input.groupIds)];
  // A group id from another outlet would price a dish from a menu it is not on.
  if (groupIds.some((id) => !allowed.has(id))) {
    throw new ValidationError('One of those option groups is not on this menu.');
  }

  await tx.delete(menuItemModifierGroups)
    .where(eq(menuItemModifierGroups.menuItemId, input.itemId));

  if (!groupIds.length) return;

  await tx.insert(menuItemModifierGroups).values(
    groupIds.map((groupId, i) => ({
      tenantId: input.tenantId,
      menuItemId: input.itemId,
      modifierGroupId: groupId,
      sortOrder: i,
    })),
  );
}

/* ── The outlet itself ──────────────────────────────────────────────────── */

/**
 * The kitchen's open/closed switch.
 *
 * Separate from the hours: hours are the plan, this is tonight. `placeOrder()`
 * refuses when it is off, so this is the one control that stops orders arriving
 * without editing a schedule at 11pm.
 */
export async function setOutletAcceptingOrders(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    isAcceptingOrders: boolean; actorStaffId: string;
  },
): Promise<void> {
  const updated = await tx.update(outlets)
    .set({ isAcceptingOrders: input.isAcceptingOrders, updatedAt: new Date() })
    .where(and(
      eq(outlets.id, input.outletId),
      eq(outlets.propertyId, input.propertyId),
      isNull(outlets.archivedAt),
    ))
    .returning({ id: outlets.id, name: outlets.name });

  if (!updated[0]) throw new NotFoundError('No such outlet at this property.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'outlet',
    entityId: input.outletId,
    eventType: input.isAcceptingOrders ? 'outlet.opened' : 'outlet.closed',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name: updated[0].name },
  });
}

/**
 * When a dish is on, if it is not on all the time.
 *
 * `menu_item_availability_windows` — written by nothing and read by nothing
 * until the sweep. Distinct from `is_available`, which is tonight's 86 list;
 * this is "breakfast until 10:30", written once and then true every day.
 *
 * Replace, not merge: the form posts every row it has, and a dish with no rows
 * is a dish on all day — which is both the default and the way to clear a
 * schedule.
 */
export async function setMenuItemAvailabilityWindows(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string; itemId: string;
    windows: readonly ItemAvailabilityWindow[];
    actorStaffId: string;
  },
): Promise<void> {
  const item = await tx.select({ id: menuItems.id, name: menuItems.name }).from(menuItems)
    .where(and(
      eq(menuItems.id, input.itemId),
      eq(menuItems.outletId, input.outletId),
      isNull(menuItems.archivedAt),
    ))
    .limit(1);
  if (!item[0]) throw new NotFoundError('That dish is not on this menu.');

  for (const w of input.windows) {
    if (w.dayOfWeek !== null
        && (!Number.isInteger(w.dayOfWeek) || w.dayOfWeek < 0 || w.dayOfWeek > 6)) {
      throw new ValidationError('A day of the week is 0 (Sunday) to 6, or every day.');
    }

    let starts: number;
    let ends: number;
    try {
      starts = parseClock(w.startsAt);
      ends = parseClock(w.endsAt);
    } catch {
      throw new ValidationError('Times are 24-hour, like 07:00 and 10:30.');
    }

    // `isItemOnNow()` reads an equal pair as contributing nothing, which would
    // take the dish off the menu. Refuse it here rather than have someone
    // wonder why breakfast vanished.
    if (starts === ends) {
      throw new ValidationError('A window that starts and ends at the same minute shows nothing.');
    }
  }

  await tx.delete(menuItemAvailabilityWindows)
    .where(eq(menuItemAvailabilityWindows.menuItemId, input.itemId));

  if (input.windows.length) {
    await tx.insert(menuItemAvailabilityWindows).values(
      input.windows.map((w) => ({
        tenantId: input.tenantId,
        menuItemId: input.itemId,
        dayOfWeek: w.dayOfWeek,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        // Stored rather than inferred, so the row says what it means. The read
        // derives the same answer from the times; keeping the column truthful
        // costs nothing and a future query may filter on it.
        crossesMidnight: parseClock(w.endsAt) < parseClock(w.startsAt),
      })),
    );
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_item',
    entityId: input.itemId,
    eventType: 'menu_item.schedule_changed',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: {
      name: item[0].name,
      windows: input.windows.map((w) => `${w.dayOfWeek ?? 'all'}:${w.startsAt}-${w.endsAt}`),
    },
  });
}

/* ── Outlet settings and hours ──────────────────────────────────────────── */

export interface AdminOutletSettings {
  id: string;
  name: string;
  description: string | null;
  currency: CurrencyCode;
  taxRateBps: number;
  serviceChargeBps: number;
  deliveryFeeMinor: number;
  minimumOrderMinor: number;
  prepTimeMinutes: number;
  isAcceptingOrders: boolean;
  hours: OutletHoursDay[];
}

export async function getOutletSettings(
  tx: Tx,
  input: { propertyId: string; outletId: string },
): Promise<AdminOutletSettings | null> {
  const rows = await tx.select({
    id: outlets.id,
    name: outlets.name,
    description: outlets.description,
    currency: outlets.currency,
    taxRateBps: outlets.taxRateBps,
    serviceChargeBps: outlets.serviceChargeBps,
    deliveryFeeMinor: outlets.deliveryFeeMinor,
    minimumOrderMinor: outlets.minimumOrderMinor,
    prepTimeMinutes: outlets.prepTimeMinutes,
    isAcceptingOrders: outlets.isAcceptingOrders,
  }).from(outlets)
    .where(and(
      eq(outlets.id, input.outletId),
      eq(outlets.propertyId, input.propertyId),
      isNull(outlets.archivedAt),
    ))
    .limit(1);

  const outlet = rows[0];
  if (!outlet) return null;

  const hours = await tx.select({
    dayOfWeek: outletHours.dayOfWeek,
    opensAt: outletHours.opensAt,
    closesAt: outletHours.closesAt,
    crossesMidnight: outletHours.crossesMidnight,
  }).from(outletHours)
    .where(eq(outletHours.outletId, input.outletId))
    .orderBy(asc(outletHours.dayOfWeek));

  return { ...outlet, currency: outlet.currency as CurrencyCode, hours };
}

/**
 * The money settings, which are also the ones a mistake is expensive in.
 *
 * Rates arrive as integer basis points (`parseRateBps` at the edge did the
 * reading), never as a float percentage — the rate is exact and rounding
 * happens once, in `applyRateBps`. Fees are minor units (#5).
 *
 * Every change is logged with BOTH values, for the same reason a reprice is: a
 * folio dispute a fortnight later is settled by what the rate was on the night,
 * and the row only knows what it is now.
 */
export interface OutletSettingsInput {
  tenantId: string;
  propertyId: string;
  outletId: string;
  name: string;
  description?: string | null;
  taxRateBps: number;
  serviceChargeBps: number;
  deliveryFeeMinor: number;
  minimumOrderMinor: number;
  prepTimeMinutes: number;
  actorStaffId: string;
}

export async function updateOutletSettings(
  tx: Tx,
  input: OutletSettingsInput,
): Promise<void> {
  const name = requireName(input.name, 'the outlet');

  for (const [label, bps] of [
    ['Tax', input.taxRateBps], ['Service charge', input.serviceChargeBps],
  ] as const) {
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new ValidationError(`${label} must be a percentage between 0 and 100.`);
    }
  }

  for (const [label, minor] of [
    ['The delivery fee', input.deliveryFeeMinor],
    ['The minimum order', input.minimumOrderMinor],
  ] as const) {
    if (!Number.isInteger(minor) || minor < 0) {
      throw new ValidationError(`${label} cannot be negative.`);
    }
  }

  if (!Number.isInteger(input.prepTimeMinutes)
      || input.prepTimeMinutes < 1 || input.prepTimeMinutes > 240) {
    throw new ValidationError('Give the kitchen between 1 and 240 minutes.');
  }

  const before = await tx.select({
    taxRateBps: outlets.taxRateBps,
    serviceChargeBps: outlets.serviceChargeBps,
    deliveryFeeMinor: outlets.deliveryFeeMinor,
    minimumOrderMinor: outlets.minimumOrderMinor,
    prepTimeMinutes: outlets.prepTimeMinutes,
  }).from(outlets)
    .where(and(
      eq(outlets.id, input.outletId),
      eq(outlets.propertyId, input.propertyId),
      isNull(outlets.archivedAt),
    ))
    .limit(1);

  const previous = before[0];
  if (!previous) throw new NotFoundError('No such outlet at this property.');

  await tx.update(outlets)
    .set({
      name,
      description: input.description?.trim() || null,
      taxRateBps: input.taxRateBps,
      serviceChargeBps: input.serviceChargeBps,
      deliveryFeeMinor: input.deliveryFeeMinor,
      minimumOrderMinor: input.minimumOrderMinor,
      prepTimeMinutes: input.prepTimeMinutes,
      updatedAt: new Date(),
    })
    .where(eq(outlets.id, input.outletId));

  const changed = Object.fromEntries(
    (Object.keys(previous) as Array<keyof typeof previous>)
      .filter((key) => previous[key] !== input[key])
      .map((key) => [key, { from: previous[key], to: input[key] }]),
  );

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'outlet',
    entityId: input.outletId,
    eventType: 'outlet.settings_updated',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name, changed },
  });
}

/**
 * Replace the week's hours.
 *
 * Replace, not merge: the form posts all seven days, and a day the hotel has
 * closed is a day with no row (hours.ts). A merge would need a way to express
 * "delete Tuesday", which is what an absent row already is.
 *
 * The rows are validated here rather than trusted from the form, because they
 * are read back by `outletOpenState()` and bad data there tells a guest the
 * kitchen is shut when it is not.
 */
export async function setOutletHours(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    hours: readonly OutletHoursDay[]; actorStaffId: string;
  },
): Promise<void> {
  const outlet = await tx.select({ id: outlets.id }).from(outlets)
    .where(and(
      eq(outlets.id, input.outletId),
      eq(outlets.propertyId, input.propertyId),
      isNull(outlets.archivedAt),
    ))
    .limit(1);
  if (!outlet[0]) throw new NotFoundError('No such outlet at this property.');

  const seen = new Set<number>();
  for (const day of input.hours) {
    if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      throw new ValidationError('A day of the week is 0 (Sunday) to 6.');
    }
    if (seen.has(day.dayOfWeek)) {
      throw new ValidationError('One set of hours per day. Split shifts are not supported yet.');
    }
    seen.add(day.dayOfWeek);

    // Throws RangeError on anything that is not HH:MM — mapped to a
    // ValidationError so a bad form field is a 422 and not a 500.
    let opens: number;
    let closes: number;
    try {
      opens = parseClock(day.opensAt);
      closes = parseClock(day.closesAt);
    } catch {
      throw new ValidationError('Times are 24-hour, like 07:00 and 23:30.');
    }

    if (!day.crossesMidnight && closes <= opens) {
      throw new ValidationError(
        'Closing before opening only makes sense past midnight — tick that instead.',
      );
    }
    if (day.crossesMidnight && closes >= opens) {
      throw new ValidationError(
        'A closing time past midnight is earlier in the day than the opening one.',
      );
    }
  }

  await tx.delete(outletHours).where(eq(outletHours.outletId, input.outletId));

  if (input.hours.length) {
    await tx.insert(outletHours).values(
      input.hours.map((day) => ({
        tenantId: input.tenantId,
        outletId: input.outletId,
        dayOfWeek: day.dayOfWeek,
        opensAt: day.opensAt,
        closesAt: day.closesAt,
        crossesMidnight: day.crossesMidnight,
      })),
    );
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'outlet',
    entityId: input.outletId,
    eventType: 'outlet.hours_updated',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: {
      days: input.hours
        .slice()
        .sort((x, y) => x.dayOfWeek - y.dayOfWeek)
        .map((d) => `${d.dayOfWeek}:${d.opensAt}-${d.closesAt}`),
    },
  });
}

/* ── Shared guards ──────────────────────────────────────────────────────── */

function requireName(raw: string, what: string): string {
  const name = raw.trim();
  if (!name) throw new ValidationError(`Give ${what} a name.`);
  if (name.length > 120) throw new ValidationError('That name is too long for a menu.');
  return name;
}

async function assertOutlet(tx: Tx, outletId: string): Promise<void> {
  const rows = await tx.select({ id: outlets.id }).from(outlets)
    .where(and(eq(outlets.id, outletId), isNull(outlets.archivedAt))).limit(1);
  if (!rows[0]) throw new NotFoundError('No such outlet at this property.');
}

async function assertCategory(
  tx: Tx,
  input: { outletId: string; categoryId: string },
): Promise<void> {
  const rows = await tx.select({ id: menuCategories.id }).from(menuCategories)
    .where(and(
      eq(menuCategories.id, input.categoryId),
      eq(menuCategories.outletId, input.outletId),
      isNull(menuCategories.archivedAt),
    ))
    .limit(1);
  if (!rows[0]) throw new ValidationError('Pick a section that is on this menu.');
}

/**
 * Next free sort order, so a new row lands at the end rather than fighting for
 * position 0 with everything the seeder wrote.
 *
 * Parameterised through the drizzle `sql` template; the table and column are
 * from the two literal call sites above, never from input.
 */
async function nextSortOrder(
  tx: Tx,
  input: { table: 'menu_categories' | 'menu_items'; column: 'outlet_id' | 'category_id'; id: string },
): Promise<number> {
  const rows = await tx.execute<{ next: number }>(sql`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
    FROM ${sql.identifier(input.table)}
    WHERE ${sql.identifier(input.column)} = ${input.id}
      AND archived_at IS NULL
  `);
  return Number(rows.rows[0]?.next ?? 0);
}
