import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db';
import {
  outlets, outletHours, menuCategories, menuItems, collections, collectionItems,
  modifierGroups, modifierOptions, menuItemModifierGroups,
} from '@/db/schema/catalog';
import type { MenuItemSeed, ModifierGroupSeed } from './kesari-menu';

/**
 * Outlet provisioning. Every property gets at least an IN_ROOM_DINING outlet —
 * without one there is nothing for a QR scan to lead to.
 *
 * Hours are property-local strings, not timestamps: "opens at 07:00" means
 * 07:00 in `properties.timezone`, on whatever date the guest is looking at.
 * Storing them as timestamptz would silently pin them to a date.
 */
export interface OutletHoursSeed {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  crossesMidnight?: boolean;
}

/** In-room dining runs 07:00 → 01:00 daily. The wrap past midnight is explicit
 *  rather than inferred from opensAt > closesAt — the "After 10pm" collection
 *  depends on it being unambiguous. */
export const DEFAULT_IRD_HOURS: readonly OutletHoursSeed[] =
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek, opensAt: '07:00', closesAt: '01:00', crossesMidnight: true,
  }));

export async function createOutlet(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    kind?: 'IN_ROOM_DINING' | 'RESTAURANT' | 'BAR' | 'CAFE' | 'SPA' | 'OTHER';
    name: string;
    description?: string;
    currency?: string;
    taxRateBps?: number;
    serviceChargeBps?: number;
    deliveryFeeMinor?: number;
    prepTimeMinutes?: number;
    hours?: readonly OutletHoursSeed[];
  },
): Promise<string> {
  const existing = await tx.select({ id: outlets.id })
    .from(outlets)
    .where(and(eq(outlets.propertyId, input.propertyId), eq(outlets.name, input.name)))
    .limit(1);
  if (existing[0]) return existing[0].id;

  const [outlet] = await tx.insert(outlets).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    kind: input.kind ?? 'IN_ROOM_DINING',
    name: input.name,
    description: input.description ?? null,
    currency: input.currency ?? 'INR',
    // Basis points so the rate stays an integer and rounding happens in exactly
    // one place — src/lib/money.ts applyRateBps. 5% GST on food in India.
    taxRateBps: input.taxRateBps ?? 500,
    serviceChargeBps: input.serviceChargeBps ?? 0,
    deliveryFeeMinor: input.deliveryFeeMinor ?? 0,
    prepTimeMinutes: input.prepTimeMinutes ?? 30,
  }).returning({ id: outlets.id });

  const outletId = outlet!.id;
  for (const h of input.hours ?? DEFAULT_IRD_HOURS) {
    await tx.insert(outletHours).values({
      tenantId: input.tenantId,
      outletId,
      dayOfWeek: h.dayOfWeek,
      opensAt: h.opensAt,
      closesAt: h.closesAt,
      crossesMidnight: h.crossesMidnight ?? false,
    });
  }
  return outletId;
}

// ─── Menu seeding ───────────────────────────────────────────────────────────

/**
 * Seeds categories, items and editorial collections for an outlet.
 * Idempotent by (outlet, name) — re-running updates nothing and duplicates
 * nothing, so `demo:reset` is safe to run before every demo.
 */
export async function seedMenu(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    outletId: string;
    currency?: string;
    categories: readonly string[];
    items: readonly MenuItemSeed[];
    collections?: readonly {
      name: string; editorialNote?: string; availableFrom?: string; availableUntil?: string;
      /** D-084. 0 = Sunday; omitted is every day. */
      daysOfWeek?: readonly number[];
      /** Dishes by name, for a collection the dish list itself does not name. */
      members?: readonly string[];
    }[];
    modifierGroups?: readonly ModifierGroupSeed[];
  },
): Promise<{ categories: number; items: number; collections: number; modifierGroups: number }> {
  const currency = input.currency ?? 'INR';

  const categoryIds = new Map<string, string>();
  for (const [i, name] of input.categories.entries()) {
    const found = await tx.select({ id: menuCategories.id }).from(menuCategories)
      .where(and(eq(menuCategories.outletId, input.outletId), eq(menuCategories.name, name))).limit(1);
    categoryIds.set(name, found[0]?.id ?? (
      await tx.insert(menuCategories).values({
        tenantId: input.tenantId, propertyId: input.propertyId,
        outletId: input.outletId, name, sortOrder: i,
      }).returning({ id: menuCategories.id })
    )[0]!.id);
  }

  const itemIds = new Map<string, string>();
  for (const [i, item] of input.items.entries()) {
    const categoryId = categoryIds.get(item.category);
    if (!categoryId) throw new Error(`Menu item "${item.name}" references unknown category "${item.category}"`);

    const found = await tx.select({ id: menuItems.id }).from(menuItems)
      .where(and(eq(menuItems.outletId, input.outletId), eq(menuItems.name, item.name))).limit(1);
    itemIds.set(item.name, found[0]?.id ?? (
      await tx.insert(menuItems).values({
        tenantId: input.tenantId, propertyId: input.propertyId,
        outletId: input.outletId, categoryId,
        name: item.name, description: item.description,
        priceMinor: item.priceMinor, currency,
        dietaryFlags: item.dietaryFlags ?? [],
        spiceLevel: item.spiceLevel ?? null,
        prepTimeMinutes: item.prepTimeMinutes ?? null,
        /* Null unless the seed carries one. A real property uploads its own
           and starts with none — see the note on DEMO photography in
           `kesari-menu.ts`. */
        imageUrl: item.imageUrl ?? null,
        sortOrder: i,
      }).returning({ id: menuItems.id })
    )[0]!.id);
  }

  let collectionCount = 0;
  for (const [i, c] of (input.collections ?? []).entries()) {
    const found = await tx.select({ id: collections.id }).from(collections)
      .where(and(eq(collections.outletId, input.outletId), eq(collections.name, c.name))).limit(1);
    const collectionId = found[0]?.id ?? (
      await tx.insert(collections).values({
        tenantId: input.tenantId, propertyId: input.propertyId, outletId: input.outletId,
        name: c.name, editorialNote: c.editorialNote ?? null,
        availableFrom: c.availableFrom ?? null, availableUntil: c.availableUntil ?? null,
        daysOfWeek: c.daysOfWeek ? [...c.daysOfWeek] : null,
        sortOrder: i,
      }).returning({ id: collections.id })
    )[0]!.id;
    if (!found[0]) collectionCount += 1;

    const members = input.items.filter((it) =>
      it.collections?.includes(c.name) || c.members?.includes(it.name));
    for (const [j, member] of members.entries()) {
      const menuItemId = itemIds.get(member.name);
      if (!menuItemId) continue;
      const already = await tx.select({ id: collectionItems.id }).from(collectionItems)
        .where(and(
          eq(collectionItems.collectionId, collectionId),
          eq(collectionItems.menuItemId, menuItemId),
        )).limit(1);
      if (!already[0]) {
        await tx.insert(collectionItems).values({
          tenantId: input.tenantId, collectionId, menuItemId, sortOrder: j,
        });
      }
    }
  }

  const modifierGroupCount = await seedModifierGroups(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: input.outletId,
    currency,
    groups: input.modifierGroups ?? [],
    itemIds,
  });

  return {
    categories: categoryIds.size,
    items: itemIds.size,
    collections: collectionCount,
    modifierGroups: modifierGroupCount,
  };
}

/**
 * Modifier groups and their options, plus the join rows that attach a group to
 * the items that carry it.
 *
 * The options and the joins go in as ONE insert each rather than a round trip
 * per row. Provisioning is a sales moment; a per-row loop here is invisible on
 * a laptop against a local database and very visible on a real property.
 */
async function seedModifierGroups(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    outletId: string;
    currency: string;
    groups: readonly ModifierGroupSeed[];
    itemIds: Map<string, string>;
  },
): Promise<number> {
  let created = 0;

  for (const [i, group] of input.groups.entries()) {
    const found = await tx.select({ id: modifierGroups.id }).from(modifierGroups)
      .where(and(
        eq(modifierGroups.outletId, input.outletId),
        eq(modifierGroups.name, group.name),
      )).limit(1);
    if (found[0]) continue;

    const [row] = await tx.insert(modifierGroups).values({
      tenantId: input.tenantId, propertyId: input.propertyId, outletId: input.outletId,
      name: group.name,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      isRequired: group.isRequired,
      sortOrder: i,
    }).returning({ id: modifierGroups.id });
    const groupId = row!.id;
    created += 1;

    await tx.insert(modifierOptions).values(
      group.options.map((option, j) => ({
        tenantId: input.tenantId,
        groupId,
        name: option.name,
        priceDeltaMinor: option.priceDeltaMinor ?? 0,
        currency: input.currency,
        isDefault: option.isDefault ?? false,
        sortOrder: j,
      })),
    );

    const attachments = group.items
      .map((name) => input.itemIds.get(name))
      .filter((id): id is string => id !== undefined)
      .map((menuItemId, j) => ({
        tenantId: input.tenantId, menuItemId, modifierGroupId: groupId, sortOrder: j,
      }));

    if (attachments.length) await tx.insert(menuItemModifierGroups).values(attachments);
  }

  return created;
}
