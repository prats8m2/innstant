import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { collections, collectionItems, menuItems, outlets } from '@/db/schema/catalog';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { parseClock } from '@/lib/clock';

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
  isActive?: boolean;
  actorStaffId: string;
}

export async function createCollection(
  tx: Tx,
  input: CollectionWriteInput,
): Promise<{ id: string }> {
  const name = requireCollectionName(input.name);
  const window = validateWindow(input.availableFrom, input.availableUntil);

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

  const updated = await tx.update(collections)
    .set({
      name,
      editorialNote: input.editorialNote?.trim() || null,
      availableFrom: window.from,
      availableUntil: window.until,
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
function validateWindow(
  from: string | null | undefined,
  until: string | null | undefined,
): { from: string | null; until: string | null } {
  const start = from?.trim() || null;
  const end = until?.trim() || null;

  if (!start && !end) return { from: null, until: null };
  if (!start || !end) {
    throw new ValidationError('A window needs both a start and an end — or neither.');
  }

  let startMinutes: number;
  let endMinutes: number;
  try {
    startMinutes = parseClock(start);
    endMinutes = parseClock(end);
  } catch {
    throw new ValidationError('Times are 24-hour, like 22:00 and 01:00.');
  }

  if (startMinutes === endMinutes) {
    throw new ValidationError('A window that starts and ends at the same minute shows nothing.');
  }

  return { from: start, until: end };
}

/** Next free position, so a new collection lands at the end of the menu. */
async function nextSortOrder(tx: Tx, outletId: string): Promise<number> {
  const rows = await tx.execute<{ next: number }>(sql`
    SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
    FROM collections
    WHERE outlet_id = ${outletId} AND archived_at IS NULL
  `);
  return Number(rows.rows[0]?.next ?? 0);
}
