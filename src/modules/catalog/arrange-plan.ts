import { ConflictError, ValidationError } from '@/lib/errors';

/**
 * The rules of an arrangement, apart from the database, so they can be
 * tested without one. `arrange.ts` explains why a drop posts the whole
 * menu and why a stale one is refused.
 */

export interface ArrangedSection {
  categoryId: string;
  /** Every dish in the section, top to bottom. */
  itemIds: readonly string[];
}

interface CurrentItem {
  id: string;
  categoryId: string;
  sortOrder: number;
}

interface CurrentCategory {
  id: string;
  sortOrder: number;
}

export interface ArrangementPlan {
  categories: { id: string; sortOrder: number }[];
  items: {
    id: string;
    categoryId: string;
    sortOrder: number;
    /** Set only when the dish changed section. */
    fromCategoryId?: string;
  }[];
}

/**
 * What has to change to make the menu read as `requested`.
 *
 * Pure, so the rules can be tested without a database. Only rows whose
 * position or section actually differs are returned: a drop that moved one
 * dish writes that dish and its new neighbours, not the whole menu.
 */
export function planArrangement(
  current: { categories: readonly CurrentCategory[]; items: readonly CurrentItem[] },
  requested: readonly ArrangedSection[],
): ArrangementPlan {
  const requestedCategoryIds = requested.map((s) => s.categoryId);
  const requestedItemIds = requested.flatMap((s) => s.itemIds);

  if (new Set(requestedCategoryIds).size !== requestedCategoryIds.length) {
    throw new ValidationError('A section appears twice in that arrangement.');
  }
  if (new Set(requestedItemIds).size !== requestedItemIds.length) {
    throw new ValidationError('A dish appears twice in that arrangement.');
  }

  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));

  if (
    !sameSet(requestedCategoryIds, current.categories.map((c) => c.id))
    || !sameSet(requestedItemIds, current.items.map((i) => i.id))
  ) {
    throw new ConflictError(
      'The menu changed while you were arranging it. Reload to see the latest, then move it again.',
    );
  }

  const categoryById = new Map(current.categories.map((c) => [c.id, c]));
  const itemById = new Map(current.items.map((i) => [i.id, i]));

  const categories = requested.flatMap((section, index) =>
    categoryById.get(section.categoryId)!.sortOrder === index
      ? []
      : [{ id: section.categoryId, sortOrder: index }],
  );

  const items = requested.flatMap((section) =>
    section.itemIds.flatMap((id, index) => {
      const before = itemById.get(id)!;
      const moved = before.categoryId !== section.categoryId;
      if (!moved && before.sortOrder === index) return [];
      return [{
        id,
        categoryId: section.categoryId,
        sortOrder: index,
        ...(moved ? { fromCategoryId: before.categoryId } : {}),
      }];
    }),
  );

  return { categories, items };
}
