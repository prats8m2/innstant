import { and, asc, eq, isNull, inArray } from 'drizzle-orm';
import type { Tx } from '@/db';
import {
  outlets, menuCategories, menuItems, collections, collectionItems,
  modifierGroups, modifierOptions, menuItemModifierGroups,
} from '@/db/schema/catalog';

/**
 * Reading the menu, for the guest.
 *
 * The counterpart to provision.ts: that file writes a catalog, this one shapes
 * it for the screen. Everything here is READ-ONLY and archived rows are
 * excluded everywhere — D-008 keeps them forever so old receipts still
 * resolve, and a guest must never see one.
 *
 * ─── Why sections are collections first, then categories ───────────────────
 *
 * The design reference browses the menu editorially: its sections are
 * "From the rooftop", "After 10pm", "Chef Bhairav's table" — collections, not
 * categories — and one dish appears in more than one of them. That is the
 * product's voice and it is deliberate.
 *
 * Collections alone would hide any dish nobody curated, so the categories
 * follow them. A dish appearing twice is native to this design, not a bug.
 */

export interface MenuDish {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  isAvailable: boolean;
  dietaryFlags: string[];
  spiceLevel: number | null;
  prepTimeMinutes: number | null;
  imageUrl: string | null;
  blurhash: string | null;
}

export interface MenuSection {
  /** Stable within one render; used by the rail and the scroll spy. */
  id: string;
  kind: 'COLLECTION' | 'CATEGORY';
  title: string;
  /** The short form for the category rail — "Rooftop", not "From the rooftop". */
  label: string;
  blurb: string | null;
  items: MenuDish[];
}

export interface OutletMenu {
  outlet: {
    id: string;
    name: string;
    currency: string;
    prepTimeMinutes: number;
    isAcceptingOrders: boolean;
    taxRateBps: number;
    serviceChargeBps: number;
    deliveryFeeMinor: number;
    minimumOrderMinor: number;
  };
  sections: MenuSection[];
}

/**
 * The property's in-room dining outlet. A property may run several outlets
 * later (a rooftop bar with its own hours); until the guest can choose, the
 * in-room one is the menu.
 */
export async function getInRoomDiningOutlet(
  tx: Tx,
  propertyId: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await tx
    .select({ id: outlets.id, name: outlets.name })
    .from(outlets)
    .where(and(
      eq(outlets.propertyId, propertyId),
      eq(outlets.kind, 'IN_ROOM_DINING'),
      isNull(outlets.archivedAt),
    ))
    .orderBy(asc(outlets.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * The short form for the rail chip. The rail is horizontal on a 390px screen,
 * so a chip per full section title would not fit two of them.
 *
 * Two rules, both taken from what the reference actually shows:
 *
 *   "From the rooftop"      → "Rooftop"        drop the leading article
 *   "Chef Bhairav's table"  → "Chef Bhairav"   drop a possessive tail
 *
 * The possessive rule only fires when what precedes it is itself two or more
 * words — otherwise "Chef's specials" would collapse to "Chef", which is both
 * less useful and collides with the chip above it.
 */
function railLabel(title: string): string {
  const withoutArticle = title.replace(/^(from the|the)\s+/i, '');

  const possessive = /^(.+?)['\u2019]s\s+\S+$/.exec(withoutArticle);
  const owner = possessive?.[1];
  const trimmed = owner && owner.trim().split(/\s+/).length >= 2 ? owner : withoutArticle;

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** The columns every menu read needs off the outlet row. */
const OUTLET_COLUMNS = {
  id: outlets.id,
  name: outlets.name,
  currency: outlets.currency,
  prepTimeMinutes: outlets.prepTimeMinutes,
  isAcceptingOrders: outlets.isAcceptingOrders,
  taxRateBps: outlets.taxRateBps,
  serviceChargeBps: outlets.serviceChargeBps,
  deliveryFeeMinor: outlets.deliveryFeeMinor,
  minimumOrderMinor: outlets.minimumOrderMinor,
};

/**
 * The menu for one outlet, given its row.
 *
 * Takes the row rather than an id so the caller's outlet lookup is the ONLY
 * one — reading it twice is a wasted round trip, and this screen already makes
 * several. That is invisible in production, where the app and Postgres are in
 * the same region, and very visible from a laptop: about 350ms each against
 * Singapore.
 */
async function buildMenu(
  tx: Tx,
  outlet: OutletMenu['outlet'],
  input: { outletId: string },
): Promise<OutletMenu> {
  // One query for every dish on the menu, then grouped in memory. The
  // alternative is a query per section, which is a round trip per section on a
  // screen a guest opens while standing up (DATA-MODEL §9 indexes this).
  const dishes = await tx
    .select({
      id: menuItems.id,
      name: menuItems.name,
      description: menuItems.description,
      priceMinor: menuItems.priceMinor,
      currency: menuItems.currency,
      isAvailable: menuItems.isAvailable,
      dietaryFlags: menuItems.dietaryFlags,
      spiceLevel: menuItems.spiceLevel,
      prepTimeMinutes: menuItems.prepTimeMinutes,
      imageUrl: menuItems.imageUrl,
      blurhash: menuItems.blurhash,
      categoryId: menuItems.categoryId,
      sortOrder: menuItems.sortOrder,
    })
    .from(menuItems)
    .where(and(eq(menuItems.outletId, input.outletId), isNull(menuItems.archivedAt)))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));

  const byId = new Map<string, MenuDish>(
    dishes.map((d) => [d.id, {
      id: d.id,
      name: d.name,
      description: d.description,
      priceMinor: d.priceMinor,
      currency: d.currency,
      isAvailable: d.isAvailable,
      // jsonb comes back as unknown; the column defaults to '[]' and is only
      // ever written as an array of flag strings.
      dietaryFlags: Array.isArray(d.dietaryFlags) ? (d.dietaryFlags as string[]) : [],
      spiceLevel: d.spiceLevel,
      prepTimeMinutes: d.prepTimeMinutes,
      imageUrl: d.imageUrl,
      blurhash: d.blurhash,
    }]),
  );

  const sections: MenuSection[] = [];

  // ── Collections ────────────────────────────────────────────────────────
  const activeCollections = await tx
    .select({
      id: collections.id,
      name: collections.name,
      editorialNote: collections.editorialNote,
    })
    .from(collections)
    .where(and(
      eq(collections.outletId, input.outletId),
      eq(collections.isActive, true),
      isNull(collections.archivedAt),
    ))
    .orderBy(asc(collections.sortOrder), asc(collections.name));

  if (activeCollections.length) {
    const memberships = await tx
      .select({
        collectionId: collectionItems.collectionId,
        menuItemId: collectionItems.menuItemId,
        sortOrder: collectionItems.sortOrder,
      })
      .from(collectionItems)
      .where(inArray(collectionItems.collectionId, activeCollections.map((c) => c.id)))
      .orderBy(asc(collectionItems.sortOrder));

    for (const collection of activeCollections) {
      const items = memberships
        .filter((m) => m.collectionId === collection.id)
        .map((m) => byId.get(m.menuItemId))
        .filter((d): d is MenuDish => d !== undefined);

      // A collection nobody has curated yet is not a section — an empty
      // heading with a blurb under it reads as a loading failure.
      if (!items.length) continue;

      sections.push({
        id: `collection-${collection.id}`,
        kind: 'COLLECTION',
        title: collection.name,
        label: railLabel(collection.name),
        blurb: collection.editorialNote,
        items,
      });
    }
  }

  // ── Categories ─────────────────────────────────────────────────────────
  const categories = await tx
    .select({
      id: menuCategories.id,
      name: menuCategories.name,
      description: menuCategories.description,
    })
    .from(menuCategories)
    .where(and(
      eq(menuCategories.outletId, input.outletId),
      isNull(menuCategories.archivedAt),
    ))
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));

  const collectionTitles = new Set(sections.map((s) => s.title.toLowerCase()));

  for (const category of categories) {
    // A property may name a category and a collection the same thing — The
    // Kesari has both a "From the rooftop" category and the collection the
    // design draws. Rendering both gives two identical headings and two
    // identical rail chips, which reads as a bug. The collection wins: it is
    // the curated one, and it is what the reference shows.
    if (collectionTitles.has(category.name.toLowerCase())) continue;

    const items = dishes
      .filter((d) => d.categoryId === category.id)
      .map((d) => byId.get(d.id))
      .filter((d): d is MenuDish => d !== undefined);
    if (!items.length) continue;

    sections.push({
      id: `category-${category.id}`,
      kind: 'CATEGORY',
      title: category.name,
      label: railLabel(category.name),
      blurb: category.description,
      items,
    });
  }

  return { outlet, sections };
}

/** The menu for a specific outlet. */
export async function getMenu(
  tx: Tx,
  input: { propertyId: string; outletId: string },
): Promise<OutletMenu | null> {
  const rows = await tx
    .select(OUTLET_COLUMNS)
    .from(outlets)
    .where(and(
      eq(outlets.id, input.outletId),
      eq(outlets.propertyId, input.propertyId),
      isNull(outlets.archivedAt),
    ))
    .limit(1);

  const outlet = rows[0];
  // Not an error: under RLS an outlet belonging to another tenant simply is
  // not there, and that is the same answer as a typo in the id.
  if (!outlet) return null;

  return buildMenu(tx, outlet, { outletId: outlet.id });
}

/**
 * What the guest menu screen calls. One outlet lookup, not two.
 *
 * A property may run several outlets later — a rooftop bar with its own hours.
 * Until the guest can choose, the in-room dining one IS the menu.
 */
export async function getInRoomDiningMenu(
  tx: Tx,
  propertyId: string,
): Promise<OutletMenu | null> {
  const rows = await tx
    .select(OUTLET_COLUMNS)
    .from(outlets)
    .where(and(
      eq(outlets.propertyId, propertyId),
      eq(outlets.kind, 'IN_ROOM_DINING'),
      isNull(outlets.archivedAt),
    ))
    .orderBy(asc(outlets.createdAt))
    .limit(1);

  const outlet = rows[0];
  if (!outlet) return null;

  return buildMenu(tx, outlet, { outletId: outlet.id });
}

/* ── One dish, with everything needed to order it ───────────────────────── */

export interface DishModifierOption {
  id: string;
  name: string;
  /** Signed minor units — a modifier may reduce the price. */
  priceDeltaMinor: number;
  currency: string;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface DishModifierGroup {
  id: string;
  name: string;
  isRequired: boolean;
  minSelections: number;
  maxSelections: number;
  options: DishModifierOption[];
}

export interface DishDetail {
  dish: MenuDish;
  outlet: OutletMenu['outlet'];
  modifierGroups: DishModifierGroup[];
}

/**
 * One dish and its modifier groups.
 *
 * Scoped by outlet as well as id, so a dish id from another property's menu
 * resolves to nothing rather than to a dish the guest cannot order. RLS already
 * confines this to the tenant; the outlet check is what confines it to the menu
 * actually in front of them.
 */
export async function getDish(
  tx: Tx,
  input: { propertyId: string; itemId: string },
): Promise<DishDetail | null> {
  const rows = await tx
    .select({
      id: menuItems.id,
      name: menuItems.name,
      description: menuItems.description,
      priceMinor: menuItems.priceMinor,
      currency: menuItems.currency,
      isAvailable: menuItems.isAvailable,
      dietaryFlags: menuItems.dietaryFlags,
      spiceLevel: menuItems.spiceLevel,
      prepTimeMinutes: menuItems.prepTimeMinutes,
      imageUrl: menuItems.imageUrl,
      blurhash: menuItems.blurhash,
      outlet: OUTLET_COLUMNS,
    })
    .from(menuItems)
    .innerJoin(outlets, eq(outlets.id, menuItems.outletId))
    .where(and(
      eq(menuItems.id, input.itemId),
      eq(menuItems.propertyId, input.propertyId),
      isNull(menuItems.archivedAt),
      isNull(outlets.archivedAt),
    ))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // Groups and options in one query. Two would be a second round trip for a
  // screen the guest opens by tapping a dish, and the join is small.
  const modifierRows = await tx
    .select({
      groupId: modifierGroups.id,
      groupName: modifierGroups.name,
      isRequired: modifierGroups.isRequired,
      minSelections: modifierGroups.minSelections,
      maxSelections: modifierGroups.maxSelections,
      groupSort: menuItemModifierGroups.sortOrder,
      optionId: modifierOptions.id,
      optionName: modifierOptions.name,
      priceDeltaMinor: modifierOptions.priceDeltaMinor,
      optionCurrency: modifierOptions.currency,
      isDefault: modifierOptions.isDefault,
      isOptionAvailable: modifierOptions.isAvailable,
      optionSort: modifierOptions.sortOrder,
    })
    .from(menuItemModifierGroups)
    .innerJoin(modifierGroups, eq(modifierGroups.id, menuItemModifierGroups.modifierGroupId))
    .innerJoin(modifierOptions, eq(modifierOptions.groupId, modifierGroups.id))
    .where(and(
      eq(menuItemModifierGroups.menuItemId, input.itemId),
      isNull(modifierGroups.archivedAt),
      isNull(modifierOptions.archivedAt),
    ))
    .orderBy(
      asc(modifierGroups.sortOrder),
      asc(modifierGroups.name),
      asc(modifierOptions.sortOrder),
    );

  const groups = new Map<string, DishModifierGroup>();
  for (const m of modifierRows) {
    let group = groups.get(m.groupId);
    if (!group) {
      group = {
        id: m.groupId,
        name: m.groupName,
        isRequired: m.isRequired,
        minSelections: m.minSelections,
        maxSelections: m.maxSelections,
        options: [],
      };
      groups.set(m.groupId, group);
    }
    group.options.push({
      id: m.optionId,
      name: m.optionName,
      priceDeltaMinor: m.priceDeltaMinor,
      currency: m.optionCurrency,
      isDefault: m.isDefault,
      isAvailable: m.isOptionAvailable,
    });
  }

  return {
    dish: {
      id: row.id,
      name: row.name,
      description: row.description,
      priceMinor: row.priceMinor,
      currency: row.currency,
      isAvailable: row.isAvailable,
      dietaryFlags: Array.isArray(row.dietaryFlags) ? (row.dietaryFlags as string[]) : [],
      spiceLevel: row.spiceLevel,
      prepTimeMinutes: row.prepTimeMinutes,
      imageUrl: row.imageUrl,
      blurhash: row.blurhash,
    },
    outlet: row.outlet,
    modifierGroups: [...groups.values()],
  };
}
