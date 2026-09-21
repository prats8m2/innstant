import type { DishModifierGroup } from '@/modules/catalog';

/**
 * Adding and removing a dish from the menu list, without opening it.
 *
 * ─── The problem, and why it is not just a button ──────────────────────────
 *
 * Every dish on the Kesari menu has a REQUIRED modifier group — chilli on the
 * savoury dishes, warm-or-cold on the sweet. A plus button on a menu card
 * therefore cannot simply add the dish: there is a question outstanding, and
 * `addToCart()` rightly refuses a selection that does not satisfy it.
 *
 * What makes the shortcut legitimate is that the groups have DEFAULTS, and
 * the defaults are not a guess — the seed's own note says it best: "the
 * default is what the kitchen actually cooks. A guest who wants it milder
 * says so; nobody is asked to opt in to the chef's own recipe." Quick-adding
 * is accepting the recipe.
 *
 * So a dish is quick-addable when every required group has a default. One
 * without — a property that asks "rare, medium or well done" and takes no
 * view — still opens the dish, because there is no honest answer to guess.
 *
 * ─── Matching the long way round exactly ───────────────────────────────────
 *
 * The selection here must be byte-for-byte what the dish page would send if
 * the guest opened it and pressed add without touching anything, which is
 * every option flagged `isDefault` ACROSS ALL GROUPS — including the "Nothing"
 * that sits under the optional extras. Get that wrong and the same dish,
 * ordered the same way, lands as two separate cart lines: `findIdenticalLine()`
 * compares the option set, and a set that differs by one no-op option is a
 * different line.
 */

/** Every option a guest would have selected by accepting the form as it opens. */
export function defaultOptionIds(groups: readonly DishModifierGroup[]): string[] {
  return groups.flatMap((group) =>
    group.options.filter((option) => option.isDefault && option.isAvailable)
      .map((option) => option.id),
  );
}

/**
 * Can this dish be added without asking anything?
 *
 * Every required group must be satisfiable from its defaults alone — at least
 * `minSelections` available defaults, and no more than `maxSelections`.
 */
export function canQuickAdd(groups: readonly DishModifierGroup[]): boolean {
  return groups.every((group) => {
    if (!group.isRequired) return true;
    const defaults = group.options.filter((o) => o.isDefault && o.isAvailable).length;
    return defaults >= Math.max(1, group.minSelections) && defaults <= group.maxSelections;
  });
}
