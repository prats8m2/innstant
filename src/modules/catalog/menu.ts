import { and, asc, eq, isNull, inArray, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import {
  outlets, outletHours, menuCategories, menuItems, collections, collectionItems,
  modifierGroups, modifierOptions, menuItemModifierGroups,
  menuItemAvailabilityWindows,
} from '@/db/schema/catalog';
import {
  isWithinWindow, isItemOnNow, type OutletHoursDay, type ItemAvailabilityWindow,
} from './hours';
import type { LocalTime } from '@/lib/clock';

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
  /**
   * Whether the menu LIST can add this straight to the cart, or has to send
   * the guest into the dish to answer something first.
   *
   * False when a required modifier group cannot be satisfied from its own
   * defaults — a property that asks "rare, medium or well done" and takes no
   * view. True for everything the kitchen has an opinion about, which on this
   * menu is all of it: see `quickAddDish()` in modules/ordering for why
   * accepting the chef's default is a legitimate shortcut and not a guess.
   */
  canQuickAdd: boolean;
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
 * A dish's own schedule, for the items given.
 *
 * `menu_item_availability_windows` was written by nothing and read by nothing
 * until the sweep. It is what makes "breakfast until 10:30" a property of the
 * dish rather than something a kitchen has to remember to switch off — and it is
 * distinct from `is_available`, which is tonight's 86 list.
 *
 * One query for every item on the screen, keyed by item. Most dishes have no
 * windows at all, so this is usually a handful of rows.
 */
async function windowsByItem(
  tx: Tx,
  itemIds: readonly string[],
): Promise<Map<string, ItemAvailabilityWindow[]>> {
  const byItem = new Map<string, ItemAvailabilityWindow[]>();
  if (!itemIds.length) return byItem;

  const rows = await tx.select({
    menuItemId: menuItemAvailabilityWindows.menuItemId,
    dayOfWeek: menuItemAvailabilityWindows.dayOfWeek,
    startsAt: menuItemAvailabilityWindows.startsAt,
    endsAt: menuItemAvailabilityWindows.endsAt,
  }).from(menuItemAvailabilityWindows)
    .where(inArray(menuItemAvailabilityWindows.menuItemId, [...itemIds]));

  for (const row of rows) {
    const list = byItem.get(row.menuItemId) ?? [];
    list.push({ dayOfWeek: row.dayOfWeek, startsAt: row.startsAt, endsAt: row.endsAt });
    byItem.set(row.menuItemId, list);
  }
  return byItem;
}

/**
 * The outlet's opening hours, property-local.
 *
 * Its own read rather than a field on `getInRoomDiningOutletConfig()`: that
 * function is called inside `placeOrder()`, in the transaction that takes a
 * guest's money, and it does not need a second query to do its job. The screens
 * that show a closing time call this one.
 *
 * One row per day the outlet opens. A day with no row is a day it does not —
 * see the note in hours.ts.
 */
export async function getOutletHours(
  tx: Tx,
  outletId: string,
): Promise<OutletHoursDay[]> {
  const rows = await tx.select({
    dayOfWeek: outletHours.dayOfWeek,
    opensAt: outletHours.opensAt,
    closesAt: outletHours.closesAt,
    crossesMidnight: outletHours.crossesMidnight,
  }).from(outletHours)
    .where(eq(outletHours.outletId, outletId))
    .orderBy(asc(outletHours.dayOfWeek));

  return rows;
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
  input: { outletId: string; at: LocalTime },
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

  /**
   * The schedule folded into `isAvailable`.
   *
   * One flag out of two facts on purpose: every screen downstream — the dish
   * card, the cart, `placeOrder()`'s "came off the menu" check — already asks
   * "can this be ordered", and answering it in two places is how one of them
   * ends up forgetting the schedule.
   */
  const schedules = await windowsByItem(tx, dishes.map((d) => d.id));

  /**
   * Which dishes the list can add without opening them.
   *
   * One query for the whole menu rather than the alternative — loading every
   * dish's modifier groups on a screen that does not otherwise need them.
   * It asks the narrow question directly: has any REQUIRED group got fewer
   * available defaults than it demands, or more than it allows? A dish with
   * no required groups at all never appears here and stays quick-addable.
   */
  const needsAChoice = await dishesNeedingAChoice(tx, dishes.map((d) => d.id));

  const byId = new Map<string, MenuDish>(
    dishes.map((d) => [d.id, {
      id: d.id,
      name: d.name,
      description: d.description,
      priceMinor: d.priceMinor,
      currency: d.currency,
      isAvailable: d.isAvailable && isItemOnNow(schedules.get(d.id) ?? [], input.at),
      // jsonb comes back as unknown; the column defaults to '[]' and is only
      // ever written as an array of flag strings.
      dietaryFlags: Array.isArray(d.dietaryFlags) ? (d.dietaryFlags as string[]) : [],
      spiceLevel: d.spiceLevel,
      prepTimeMinutes: d.prepTimeMinutes,
      imageUrl: d.imageUrl,
      blurhash: d.blurhash,
      canQuickAdd: !needsAChoice.has(d.id),
    }]),
  );

  const sections: MenuSection[] = [];

  // ── Collections ────────────────────────────────────────────────────────
  const activeCollections = (await tx
    .select({
      id: collections.id,
      name: collections.name,
      editorialNote: collections.editorialNote,
      availableFrom: collections.availableFrom,
      availableUntil: collections.availableUntil,
    })
    .from(collections)
    .where(and(
      eq(collections.outletId, input.outletId),
      eq(collections.isActive, true),
      isNull(collections.archivedAt),
    ))
    .orderBy(asc(collections.sortOrder), asc(collections.name)))
    /**
     * The window, applied. "After 10pm" is seeded 22:00–01:00 and was showing
     * at breakfast, because these two columns were written by the seeder and
     * ignored here — the same bug `outlet_hours` had.
     *
     * Filtered in memory rather than in SQL: the comparison crosses midnight,
     * which is three clauses and a `crosses_midnight`-shaped argument in SQL and
     * one tested function here (`isWithinWindow`). There are at most a handful
     * of collections per outlet.
     */
    .filter((c) => isWithinWindow(c.availableFrom, c.availableUntil, input.at));

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
  input: { propertyId: string; outletId: string; at: LocalTime },
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

  return buildMenu(tx, outlet, { outletId: outlet.id, at: input.at });
}

/**
 * The in-room dining outlet's money configuration, without its menu.
 *
 * The cart screen needs the tax and service rates and nothing else; loading
 * every dish to get at them would be several queries for four integers.
 */
export async function getInRoomDiningOutletConfig(
  tx: Tx,
  propertyId: string,
): Promise<OutletMenu['outlet'] | null> {
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

  return rows[0] ?? null;
}

/**
 * Every outlet a property runs, for a screen that has to CHOOSE one.
 *
 * D-079 — the first thing in this product that genuinely needs the list. Until
 * property links existed, the guest's outlet was resolved by kind (there was
 * one choice and it was not theirs to make) and the admin edited that same one.
 * A property link points at an outlet, and somebody creating one has to say
 * which: a hotel with a rooftop bar and room service prints two different
 * links, and they open two different menus.
 *
 * Archived outlets are excluded, like everything else that reads this table
 * (D-008): a link may not be created against a menu that no longer exists.
 */
export async function listOutlets(
  tx: Tx,
  propertyId: string,
): Promise<Array<{ id: string; name: string; kind: string }>> {
  return tx
    .select({ id: outlets.id, name: outlets.name, kind: outlets.kind })
    .from(outlets)
    .where(and(eq(outlets.propertyId, propertyId), isNull(outlets.archivedAt)))
    .orderBy(asc(outlets.createdAt));
}

/**
 * The same four integers, for an outlet named by id rather than by kind.
 *
 * D-079 — a property link points at ONE outlet, chosen when the link was made,
 * and `placeOrder()` has to price against that one. The in-room variant above
 * stays because the room flow genuinely has no choice to make: until a guest
 * can pick between a rooftop bar and room service, the in-room outlet IS the
 * menu, and resolving it by kind is how that is said.
 */
export async function getOutletConfig(
  tx: Tx,
  input: { propertyId: string; outletId: string },
): Promise<OutletMenu['outlet'] | null> {
  const rows = await tx
    .select(OUTLET_COLUMNS)
    .from(outlets)
    .where(and(
      eq(outlets.id, input.outletId),
      // Scoped to the property as well as the id: the id travels in a session,
      // and RLS confines it to the tenant, which is one hotel wider than this.
      eq(outlets.propertyId, input.propertyId),
      isNull(outlets.archivedAt),
    ))
    .limit(1);

  return rows[0] ?? null;
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
  /**
   * Property-local time, for the collection windows.
   *
   * Required rather than defaulted to "now": the server's clock is not the
   * hotel's (CLAUDE.md "Dates"), and a default would have hidden exactly the
   * bug this parameter exists to fix. The caller knows the timezone; it has
   * just read the property.
   */
  at: LocalTime,
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

  return buildMenu(tx, outlet, { outletId: outlet.id, at });
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
  input: {
    propertyId: string;
    itemId: string;
    /**
     * Property-local time, for the dish's own schedule. Optional here and
     * nowhere else: this function is also used by the ops console, where "is it
     * on right now" is not the question being asked. Omitting it means the
     * schedule is not applied, and the guest screens always pass it.
     */
    at?: LocalTime;
  },
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

  // The dish's schedule, folded into the same flag the screen already reads.
  const onNow = input.at
    ? isItemOnNow((await windowsByItem(tx, [row.id])).get(row.id) ?? [], input.at)
    : true;

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
      isAvailable: row.isAvailable && onNow,
      dietaryFlags: Array.isArray(row.dietaryFlags) ? (row.dietaryFlags as string[]) : [],
      spiceLevel: row.spiceLevel,
      prepTimeMinutes: row.prepTimeMinutes,
      imageUrl: row.imageUrl,
      blurhash: row.blurhash,
      /* Reaching the dish page means the choosing already happened here, so
         the shortcut flag has nothing left to say. `canQuickAdd()` in
         modules/ordering answers it properly from the groups below when the
         quick path needs to re-check. */
      canQuickAdd: true,
    },
    outlet: row.outlet,
    modifierGroups: [...groups.values()],
  };
}

/**
 * Prices for a set of items and modifier options, in two round trips.
 *
 * Exists so `ordering` can price a whole cart without importing catalog's
 * tables (D-001) and without a `getDish()` per line — a cart of six dishes
 * would otherwise be twelve queries.
 */
export interface CartPricing {
  items: Map<string, {
    name: string;
    priceMinor: number;
    currency: string;
    isAvailable: boolean;
    /** For `order_items.image_url_snapshot` — a receipt shows the dish as it
     *  looked when it was sold, not as it looks after a photoshoot (#6). */
    imageUrl: string | null;
  }>;
  options: Map<string, {
    name: string;
    priceDeltaMinor: number;
    isAvailable: boolean;
    /**
     * The "no extra" choice in an optional group — "Nothing" under Add.
     *
     * A real recorded choice, so it is stored, but printing it on a cart line
     * or a kitchen ticket is noise: "Laal maas · As the chef makes it ·
     * Nothing" tells the kitchen nothing it did not already know. Derived
     * rather than name-matched — an option costs nothing AND its group can be
     * left empty.
     */
    isNoOp: boolean;
  }>;
}

export async function getCartPricing(
  tx: Tx,
  input: {
    propertyId: string;
    itemIds: readonly string[];
    optionIds: readonly string[];
    /**
     * Property-local time. Without it a dish outside its window still prices,
     * and `placeOrder()` would accept a breakfast order at dinner — this is the
     * path where the schedule stops being a display decision and becomes a rule.
     */
    at?: LocalTime;
  },
): Promise<CartPricing> {
  const items: CartPricing['items'] = new Map();
  const options: CartPricing['options'] = new Map();

  if (input.itemIds.length) {
    const rows = await tx
      .select({
        id: menuItems.id,
        name: menuItems.name,
        priceMinor: menuItems.priceMinor,
        currency: menuItems.currency,
        isAvailable: menuItems.isAvailable,
        imageUrl: menuItems.imageUrl,
      })
      .from(menuItems)
      .where(and(
        eq(menuItems.propertyId, input.propertyId),
        inArray(menuItems.id, [...input.itemIds]),
        isNull(menuItems.archivedAt),
      ));
    const schedules = input.at
      ? await windowsByItem(tx, rows.map((r) => r.id))
      : new Map<string, ItemAvailabilityWindow[]>();

    for (const r of rows) {
      items.set(r.id, {
        name: r.name,
        priceMinor: r.priceMinor,
        currency: r.currency,
        isAvailable: r.isAvailable
          && (!input.at || isItemOnNow(schedules.get(r.id) ?? [], input.at)),
        imageUrl: r.imageUrl,
      });
    }
  }

  if (input.optionIds.length) {
    const rows = await tx
      .select({
        id: modifierOptions.id,
        name: modifierOptions.name,
        priceDeltaMinor: modifierOptions.priceDeltaMinor,
        isAvailable: modifierOptions.isAvailable,
        minSelections: modifierGroups.minSelections,
      })
      .from(modifierOptions)
      .innerJoin(modifierGroups, eq(modifierGroups.id, modifierOptions.groupId))
      .where(and(
        inArray(modifierOptions.id, [...input.optionIds]),
        isNull(modifierOptions.archivedAt),
      ));
    for (const r of rows) {
      options.set(r.id, {
        name: r.name,
        priceDeltaMinor: r.priceDeltaMinor,
        isAvailable: r.isAvailable,
        isNoOp: r.priceDeltaMinor === 0 && r.minSelections === 0,
      });
    }
  }

  return { items, options };
}

/**
 * Dish ids whose required modifier groups cannot be answered from defaults.
 *
 * Grouped in SQL rather than pulled into memory: a menu has as many
 * modifier-group rows as dishes times groups, and the list screen needs one
 * boolean per dish out of all of it.
 *
 * "Cannot be answered" means the count of AVAILABLE default options in a
 * required group is outside what the group demands — fewer than
 * `min_selections` (nothing to pick) or more than `max_selections` (the
 * defaults contradict each other). Either way there is no honest selection to
 * make on the guest's behalf, so the card sends them into the dish.
 *
 * Written with the query builder rather than as raw SQL, deliberately. The
 * first version hand-wrote the join and used `mo.modifier_group_id`, which
 * does not exist — the column is `group_id` — and nothing caught it until the
 * menu returned 500 in a browser. The builder knows the column names.
 */
async function dishesNeedingAChoice(
  tx: Tx,
  itemIds: readonly string[],
): Promise<Set<string>> {
  if (!itemIds.length) return new Set();

  const defaultsAvailable = sql<number>`
    count(${modifierOptions.id}) FILTER (
      WHERE ${modifierOptions.isDefault} AND ${modifierOptions.isAvailable}
    )`;

  const rows = await tx
    .select({ menuItemId: menuItemModifierGroups.menuItemId })
    .from(menuItemModifierGroups)
    .innerJoin(
      modifierGroups,
      eq(modifierGroups.id, menuItemModifierGroups.modifierGroupId),
    )
    .leftJoin(modifierOptions, eq(modifierOptions.groupId, modifierGroups.id))
    .where(and(
      inArray(menuItemModifierGroups.menuItemId, [...itemIds]),
      eq(modifierGroups.isRequired, true),
    ))
    .groupBy(
      menuItemModifierGroups.menuItemId,
      modifierGroups.id,
      modifierGroups.minSelections,
      modifierGroups.maxSelections,
    )
    .having(sql`${defaultsAvailable} < greatest(1, ${modifierGroups.minSelections})
             OR ${defaultsAvailable} > ${modifierGroups.maxSelections}`);

  return new Set(rows.map((r) => r.menuItemId));
}
