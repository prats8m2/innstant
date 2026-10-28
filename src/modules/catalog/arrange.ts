import { and, asc, eq, isNull } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { menuCategories, menuItems } from '@/db/schema/catalog';
import { NotFoundError } from '@/lib/errors';
import { planArrangement, type ArrangedSection } from './arrange-plan';

export type { ArrangedSection } from './arrange-plan';

/**
 * Arranging the menu — the order of its sections, and of the dishes in each.
 *
 * `sort_order` has been on both tables since migration 0000, and until the
 * menu studio nothing but the seeder and `nextSortOrder()` ever wrote it: a
 * manager could not move "Sweets" above "Drinks" short of editing the
 * database. The studio's board is drag-and-drop, and a drop posts the WHOLE
 * arrangement rather than "move X above Y".
 *
 * ─── Why the whole arrangement ─────────────────────────────────────────────
 *
 * A relative move ("after dish Y") is ambiguous the moment Y has moved too,
 * and two such moves from two screens can interleave into an order neither
 * person made. The full list is idempotent: posting it twice is the same
 * menu. The board already holds the full list; it is a few dozen ids.
 *
 * ─── Why a stale arrangement is refused, not merged ────────────────────────
 *
 * The list must name exactly the sections and dishes on the menu NOW. If
 * somebody added a dish on another screen after this board loaded, the
 * posted list lacks it, and writing it anyway would leave that dish's
 * sort_order colliding with a neighbour's — it would be "somewhere". The
 * honest answer is to say the menu changed and let the board reload, which
 * costs one drag.
 *
 * Archived sections and dishes are outside all of this: they are not on the
 * board and not on the menu, and their sort_order is never read.
 */

/**
 * Write an arrangement. One transaction; refuses a stale one (see above).
 *
 * Event rows: a dish that changed section gets its own `menu_item.moved`,
 * because "why is the sole under Small plates" is a question with an answer.
 * A reorder within a section is presentation, so the whole drop is one
 * `menu.arranged` row on the outlet, which says who did it and when.
 */
export async function arrangeMenu(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    outletId: string;
    sections: readonly ArrangedSection[];
    actorStaffId: string;
  },
): Promise<{ changed: number }> {
  const categories = await tx.select({
    id: menuCategories.id,
    name: menuCategories.name,
    sortOrder: menuCategories.sortOrder,
  })
    .from(menuCategories)
    .where(and(eq(menuCategories.outletId, input.outletId), isNull(menuCategories.archivedAt)))
    .orderBy(asc(menuCategories.sortOrder))
    // Two managers dropping at once serialise here, so each plans against
    // the other's result rather than both against the same stale order.
    .for('update');

  if (categories.length === 0) throw new NotFoundError('That menu has no sections.');

  const items = await tx.select({
    id: menuItems.id,
    categoryId: menuItems.categoryId,
    sortOrder: menuItems.sortOrder,
  }).from(menuItems)
    .where(and(eq(menuItems.outletId, input.outletId), isNull(menuItems.archivedAt)))
    .for('update');

  // A dish whose section was archived under it is not on the board; leave it
  // out of the comparison so it cannot block every drop.
  const live = new Set(categories.map((c) => c.id));
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const plan = planArrangement(
    { categories, items: items.filter((i) => live.has(i.categoryId)) },
    input.sections,
  );

  const now = new Date();
  for (const category of plan.categories) {
    await tx.update(menuCategories)
      .set({ sortOrder: category.sortOrder, updatedAt: now })
      .where(eq(menuCategories.id, category.id));
  }
  for (const item of plan.items) {
    await tx.update(menuItems)
      .set({ categoryId: item.categoryId, sortOrder: item.sortOrder, updatedAt: now })
      .where(eq(menuItems.id, item.id));

    if (item.fromCategoryId) {
      await recordEvent(tx, {
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        entityType: 'menu_item',
        entityId: item.id,
        eventType: 'menu_item.moved',
        actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
        // Names as well as ids: the history reads "Moved from Drinks to
        // Sweets", and a section renamed later must not rewrite that line.
        payload: {
          fromCategoryId: item.fromCategoryId,
          toCategoryId: item.categoryId,
          from: nameOf.get(item.fromCategoryId) ?? null,
          to: nameOf.get(item.categoryId) ?? null,
        },
      });
    }
  }

  const changed = plan.categories.length + plan.items.length;
  if (changed > 0) {
    await recordEvent(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      entityType: 'outlet',
      entityId: input.outletId,
      eventType: 'menu.arranged',
      actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
      // Rows rewritten, not dishes moved: the first drop on a seeded menu
      // renumbers a whole section to 0, 1, 2… even for a single swap.
      payload: { sectionsWritten: plan.categories.length, dishesWritten: plan.items.length },
    });
  }

  return { changed };
}
