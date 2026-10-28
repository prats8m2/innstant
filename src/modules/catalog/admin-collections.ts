import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { collections, collectionItems, menuItems, outlets } from '@/db/schema/catalog';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { validateDates, validateDays, validateWindow } from './schedule-validate';

/**
 * Editorial collections — the part of the catalog that decides how the menu
 * READS rather than what is on it.
 *
 * The guest menu's sections ARE collections: "From the rooftop", "After 10pm",
 * "Chef Bhairav's table". Categories follow them and only exist so a dish
 * nobody curated is still reachable (menu.ts). So this screen is where a GM
 * writes the voice of the product, and it is the one piece of catalog admin a
 * hotel notices first.
 *
 * Two things are deliberate here.
 *
 * **A dish may be in more than one collection.** Laal maas is in both "From the
 * rooftop" and "Chef Bhairav's table", exactly as the reference draws it. The
 * join table has no unique constraint on the item alone for that reason, and
 * nothing here treats it as a mistake.
 *
 * **The window is real.** `available_from` / `available_until` are honoured by
 * the guest read (`isWithinWindow`), so "After 10pm" is literal rather than a
 * name. It was ignored for months, which is why the validation below is
 * careful about what a window means.
 */

export interface AdminCollectionItem {
  id: string;
  name: string;
  isAvailable: boolean;
}

export interface AdminCollection {
  id: string;
  name: string;
  editorialNote: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  /** D-084. 0 = Sunday; null is every day. */
  daysOfWeek: number[] | null;
  /** Property-local `YYYY-MM-DD`, inclusive; null is an open end. */
  startsOn: string | null;
  endsOn: string | null;
  isActive: boolean;
  sortOrder: number;
  items: AdminCollectionItem[];
}

/**
 * Every collection an editor can work on, curated members first.
 *
 * Includes INACTIVE ones and ones outside their window — those are precisely
 * the ones someone came here to change, and a screen that hides them is a
 * screen that cannot fix them.
 */
export async function listCollections(
  tx: Tx,
  input: { outletId: string },
): Promise<AdminCollection[]> {
  const rows = await tx.select({
    id: collections.id,
    name: collections.name,
    editorialNote: collections.editorialNote,
    availableFrom: collections.availableFrom,
    availableUntil: collections.availableUntil,
    daysOfWeek: collections.daysOfWeek,
    startsOn: collections.startsOn,
    endsOn: collections.endsOn,
    isActive: collections.isActive,
    sortOrder: collections.sortOrder,
  }).from(collections)
    .where(and(
      eq(collections.outletId, input.outletId),
      isNull(collections.archivedAt),
    ))
    .orderBy(asc(collections.sortOrder), asc(collections.name));

  if (!rows.length) return [];

  const members = await tx.select({
    collectionId: collectionItems.collectionId,
    id: menuItems.id,
    name: menuItems.name,
    isAvailable: menuItems.isAvailable,
    sortOrder: collectionItems.sortOrder,
  }).from(collectionItems)
    .innerJoin(menuItems, eq(menuItems.id, collectionItems.menuItemId))
    .where(and(
      inArray(collectionItems.collectionId, rows.map((c) => c.id)),
      // An archived dish keeps its membership row (D-008 — nothing is deleted),
      // and must not show up as a member an editor can see or reorder.
      isNull(menuItems.archivedAt),
    ))
    .orderBy(asc(collectionItems.sortOrder));

  return rows.map((collection) => ({
    ...collection,
    items: members
      .filter((m) => m.collectionId === collection.id)
      .map(({ id, name, isAvailable }) => ({ id, name, isAvailable })),
  }));
}

export interface CollectionWriteInput {
  tenantId: string;
  propertyId: string;
  outletId: string;
  name: string;
  editorialNote?: string | null;
  availableFrom?: string | null;
  availableUntil?: string | null;
  /** D-084. Omitted on an update leaves the stored value alone. */
  daysOfWeek?: readonly number[] | null;
  startsOn?: string | null;
  endsOn?: string | null;
  isActive?: boolean;
  actorStaffId: string;
}

export async function createCollection(
  tx: Tx,
  input: CollectionWriteInput,
): Promise<{ id: string }> {
  const name = requireCollectionName(input.name);
  const window = validateWindow(input.availableFrom, input.availableUntil);
  const days = validateDays(input.daysOfWeek);
  const dates = validateDates(input.startsOn, input.endsOn);

  const outlet = await tx.select({ id: outlets.id }).from(outlets)
    .where(and(eq(outlets.id, input.outletId), isNull(outlets.archivedAt))).limit(1);
  if (!outlet[0]) throw new NotFoundError('No such outlet at this property.');

  const [row] = await tx.insert(collections).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: input.outletId,
    name,
    editorialNote: input.editorialNote?.trim() || null,
    availableFrom: window.from,
    availableUntil: window.until,
    daysOfWeek: days,
    startsOn: dates.startsOn,
    endsOn: dates.endsOn,
    isActive: input.isActive ?? true,
    sortOrder: await nextSortOrder(tx, input.outletId),
  }).returning({ id: collections.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'collection',
    entityId: row!.id,
    eventType: 'collection.created',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name },
  });

  return { id: row!.id };
}

export async function updateCollection(
  tx: Tx,
  input: CollectionWriteInput & { collectionId: string },
): Promise<void> {
  const name = requireCollectionName(input.name);
  const window = validateWindow(input.availableFrom, input.availableUntil);
  const days = input.daysOfWeek !== undefined ? validateDays(input.daysOfWeek) : undefined;
  const dates = input.startsOn !== undefined || input.endsOn !== undefined
    ? validateDates(input.startsOn, input.endsOn)
    : undefined;

  const updated = await tx.update(collections)
    .set({
      name,
      editorialNote: input.editorialNote?.trim() || null,
      availableFrom: window.from,
      availableUntil: window.until,
      ...(days !== undefined ? { daysOfWeek: days } : {}),
      ...(dates ? { startsOn: dates.startsOn, endsOn: dates.endsOn } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(collections.id, input.collectionId),
      eq(collections.outletId, input.outletId),
      isNull(collections.archivedAt),
    ))
    .returning({ id: collections.id });

  if (!updated[0]) throw new NotFoundError('That collection is not on this menu.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'collection',
    entityId: input.collectionId,
    eventType: 'collection.updated',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: {
      name,
      isActive: input.isActive ?? null,
      window: window.from || window.until ? `${window.from ?? ''}-${window.until ?? ''}` : null,
      ...(days !== undefined ? { daysOfWeek: days } : {}),
      ...(dates ? { startsOn: dates.startsOn, endsOn: dates.endsOn } : {}),
    },
  });
}

/**
 * D-008 — archived, never deleted.
 *
 * No guard on membership, unlike a category: a collection is a view over
 * dishes, and archiving one takes nothing off the menu. The dishes keep their
 * categories and stay orderable.
 */
export async function archiveCollection(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    collectionId: string; actorStaffId: string;
  },
): Promise<{ name: string }> {
  const archived = await tx.update(collections)
    .set({ archivedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(and(
      eq(collections.id, input.collectionId),
      eq(collections.outletId, input.outletId),
      isNull(collections.archivedAt),
    ))
    .returning({ id: collections.id, name: collections.name });

  const collection = archived[0];
  if (!collection) throw new NotFoundError('That collection is not on this menu.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'collection',
    entityId: collection.id,
    eventType: 'collection.archived',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name: collection.name },
  });

  return { name: collection.name };
}

/**
 * Which dishes are in a collection, and in what order.
 *
 * Replace, not diff: the form posts the full set of ticked boxes, and the ORDER
 * of that set is the order the guest reads. The reference's collections are
 * curated sequences — "what Bhairav cooks when the family visits" is a running
 * order, not an alphabetised list — so `sortOrder` follows the array.
 */
export async function setCollectionItems(
  tx: Tx,
  input: {
    tenantId: string; outletId: string; collectionId: string;
    menuItemIds: readonly string[];
  },
): Promise<void> {
  const collection = await tx.select({ id: collections.id }).from(collections)
    .where(and(
      eq(collections.id, input.collectionId),
      eq(collections.outletId, input.outletId),
      isNull(collections.archivedAt),
    ))
    .limit(1);
  if (!collection[0]) throw new NotFoundError('That collection is not on this menu.');

  // Deduped, order preserved — the first mention wins, which is what someone
  // ticking a box twice in a reordered list means.
  const menuItemIds = [...new Set(input.menuItemIds)];

  if (menuItemIds.length) {
    const owned = await tx.select({ id: menuItems.id }).from(menuItems)
      .where(and(
        eq(menuItems.outletId, input.outletId),
        isNull(menuItems.archivedAt),
        inArray(menuItems.id, menuItemIds),
      ));

    if (owned.length !== menuItemIds.length) {
      // A dish from another outlet, or one that has been archived. Either way
      // it would appear in a section a guest cannot order from.
      throw new ValidationError('One of those dishes is not on this menu any more.');
    }
  }

  await tx.delete(collectionItems)
    .where(eq(collectionItems.collectionId, input.collectionId));

  if (!menuItemIds.length) return;

  await tx.insert(collectionItems).values(
    menuItemIds.map((menuItemId, i) => ({
      tenantId: input.tenantId,
      collectionId: input.collectionId,
      menuItemId,
      sortOrder: i,
    })),
  );
}

/* ── The board's two shortcuts (D-084) ──────────────────────────────────── */

export const TODAYS_SPECIAL = 'Today’s special';

/**
 * "Today's special", in one tap.
 *
 * A collection named for the day, dated today to today, at the TOP of the
 * guest's menu, with no dishes yet: the manager drags them on from the
 * board, and until one is there a guest sees nothing (an empty collection
 * is skipped, as always).
 *
 * One per outlet. Tapping it again on the same day returns the same one.
 * Tapping it on a later day rolls yesterday's forward to today and EMPTIES
 * it: yesterday's specials are not today's, and carrying them silently is
 * how last Tuesday's fish ends up on this Tuesday's menu. It ends by itself
 * at the end of the day, because its dates say so, with nobody remembering
 * to switch it off.
 */
export async function startTodaysSpecial(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    /** Property-local `YYYY-MM-DD`: the caller has read the property's clock. */
    today: string;
    actorStaffId: string;
  },
): Promise<{ id: string; created: boolean; rolledOver: boolean }> {
  const today = validateDates(input.today, input.today).startsOn!;

  // Two taps at once (two managers, or one double-tap on hotel wifi) must
  // make ONE special. With no special yet there is no row for FOR UPDATE to
  // hold, so the outlet's row is the lock both taps queue on.
  const outlet = await tx.select({ id: outlets.id }).from(outlets)
    .where(and(eq(outlets.id, input.outletId), isNull(outlets.archivedAt)))
    .limit(1)
    .for('update');
  if (!outlet[0]) throw new NotFoundError('No such outlet at this property.');

  const existing = await tx.select({
    id: collections.id, startsOn: collections.startsOn, endsOn: collections.endsOn,
  }).from(collections)
    .where(and(
      eq(collections.outletId, input.outletId),
      eq(collections.name, TODAYS_SPECIAL),
      isNull(collections.archivedAt),
    ))
    .limit(1)
    .for('update');

  // First on the menu: a special is the thing a guest should see first.
  const first = await tx.execute<{ first: number }>(sql`
    SELECT COALESCE(MIN(sort_order), 0) - 1 AS first
    FROM collections
    WHERE outlet_id = ${input.outletId} AND archived_at IS NULL
  `);
  const top = Number(first.rows[0]?.first ?? 0);

  const found = existing[0];
  if (found && found.startsOn === today && found.endsOn === today) {
    await tx.update(collections).set({ isActive: true, updatedAt: new Date() })
      .where(eq(collections.id, found.id));
    return { id: found.id, created: false, rolledOver: false };
  }

  if (found) {
    await tx.update(collections)
      .set({
        startsOn: today, endsOn: today, daysOfWeek: null,
        availableFrom: null, availableUntil: null,
        isActive: true, sortOrder: top, updatedAt: new Date(),
      })
      .where(eq(collections.id, found.id));
    await tx.delete(collectionItems).where(eq(collectionItems.collectionId, found.id));
    await recordEvent(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      entityType: 'collection',
      entityId: found.id,
      eventType: 'collection.updated',
      actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
      payload: { name: TODAYS_SPECIAL, startsOn: today, endsOn: today, emptied: true },
    });
    return { id: found.id, created: false, rolledOver: true };
  }

  const [row] = await tx.insert(collections).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: input.outletId,
    name: TODAYS_SPECIAL,
    editorialNote: 'What the kitchen is proudest of today.',
    startsOn: today,
    endsOn: today,
    isActive: true,
    sortOrder: top,
  }).returning({ id: collections.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'collection',
    entityId: row!.id,
    eventType: 'collection.created',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name: TODAYS_SPECIAL, startsOn: today, endsOn: today },
  });

  return { id: row!.id, created: true, rolledOver: false };
}

/**
 * Put one dish into a collection, at the end: a dish dropped on a card on
 * the board. A dish already in it is not an error; the drop says it was.
 */
export async function addDishToCollection(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    collectionId: string; menuItemId: string; actorStaffId: string;
  },
): Promise<{ collection: string; dish: string; added: boolean }> {
  const collection = (await tx.select({ id: collections.id, name: collections.name })
    .from(collections)
    .where(and(
      eq(collections.id, input.collectionId),
      eq(collections.outletId, input.outletId),
      isNull(collections.archivedAt),
    ))
    .limit(1))[0];
  if (!collection) throw new NotFoundError('That collection is not on this menu.');

  const dish = (await tx.select({ id: menuItems.id, name: menuItems.name }).from(menuItems)
    .where(and(
      eq(menuItems.id, input.menuItemId),
      eq(menuItems.outletId, input.outletId),
      isNull(menuItems.archivedAt),
    ))
    .limit(1))[0];
  if (!dish) throw new ConflictError('That dish is not on this menu any more.');

  const inserted = await tx.insert(collectionItems).values({
    tenantId: input.tenantId,
    collectionId: collection.id,
    menuItemId: dish.id,
    sortOrder: sql`(SELECT COALESCE(MAX(sort_order), -1) + 1 FROM collection_items
                    WHERE collection_id = ${collection.id})`,
  })
    .onConflictDoNothing()
    .returning({ id: collectionItems.id });

  const added = inserted.length > 0;
  if (added) {
    await recordEvent(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      entityType: 'collection',
      entityId: collection.id,
      eventType: 'collection.dish_added',
      actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
      payload: { collection: collection.name, menuItemId: dish.id, dish: dish.name },
    });
  }

  return { collection: collection.name, dish: dish.name, added };
}

/* ── Guards ─────────────────────────────────────────────────────────────── */


function requireCollectionName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new ValidationError('Give the collection a name.');
  if (name.length > 120) throw new ValidationError('That name is too long for a menu.');
  return name;
}

/**
 * A window is both bounds or neither.
 *
 * One-sided windows are legal in `isWithinWindow` — it is a pure function and
 * being strict there would be arbitrary — but they are not something to offer
 * on a screen: "showing from 22:00, forever" reads as a mistake, and the
 * collection it describes ("After 10pm") always has both ends.
 */
/** Next free position, so a new collection lands at the end of the menu. */
async function nextSortOrder(tx: Tx, outletId: string): Promise<number> {
  const rows = await tx.execute<{ next: number }>(sql`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
    FROM collections
    WHERE outlet_id = ${outletId} AND archived_at IS NULL
  `);
  return Number(rows.rows[0]?.next ?? 0);
}
