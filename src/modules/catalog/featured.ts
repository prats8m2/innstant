import type { MenuDish, MenuSection } from './menu';

/**
 * "Three to start with" — the home screen's featured strip.
 *
 * ─── Why this is computed and not a column ─────────────────────────────────
 *
 * D-071 already refused the tempting answer once: "the tempting answer is an
 * `is_featured` column somebody ticks". It stands here for the same reason —
 * a flag is a list somebody has to maintain, and the one person who would
 * maintain it is the one person too close to the menu to pick for a stranger.
 *
 * ─── Why it is not counted demand either, which is what D-071 chose ────────
 *
 * The analogy breaks on what each strip is FOR. Amenities wanted the thing
 * ninety guests a month actually ask for, and a towel is the right answer.
 * `order_items.menu_item_id` would support the identical query here — and
 * ranking a restaurant menu by sold quantity promotes masala chai at ₹180 and
 * kesar lassi at ₹320, because the cheap repeat purchase always wins a count.
 * True, and useless: "three to start with" is the place for the ₹1,150 dish.
 * D-071's own second rule makes the same move in reverse — free before
 * chargeable at equal demand, because a one-tap strip is a place to put a
 * towel and not a place to sell wine.
 *
 * ─── Why collections ───────────────────────────────────────────────────────
 *
 * Unlike amenities, curation already exists here and already carries the
 * editorial voice: a collection has an `editorial_note`, a `sort_order` and an
 * availability window, and `getMenu()` already lets a collection beat an
 * identically-named category because the collection is the curated one.
 *
 * Picking ACROSS collections rather than down one is the whole rule. Taking
 * the first three members of collection zero would tag all three "From the
 * rooftop"; one from each gives the strip three different voices, which is
 * what makes it read as a sample of the menu rather than as the top of it.
 *
 * ─── Pure, over the sections `getMenu()` has already assembled ─────────────
 *
 * No query, no clock, no schema. The window filtering — "After 10pm" is not
 * showing at eight — has already happened against the PROPERTY's clock in
 * `getMenu()`, so this cannot disagree with the menu underneath it and it is
 * testable from a laptop in any timezone.
 */
export interface FeaturedDish {
  /**
   * The section this was taken from — the strip's tag, in its SHORT form.
   *
   * `label`, not `title`: the tag is a rail-sized eyebrow over a dish name,
   * and the same shortening the menu rail wants is the one the strip wants.
   * "Chef Bhairav's table" over "Safed maas" reads as a sentence that got cut
   * off; "Chef Bhairav" reads as a tag, which is what the design draws.
   */
  section: string;
  dish: MenuDish;
}

export function featuredDishes(
  sections: readonly MenuSection[],
  limit = 3,
): FeaturedDish[] {
  const taken = new Set<string>();
  const out: FeaturedDish[] = [];

  const pick = (kind: MenuSection['kind']) => {
    for (const section of sections) {
      if (out.length >= limit) return;
      if (section.kind !== kind) continue;

      // Not merely the first member: a dish already standing in the strip
      // under another section's tag must not stand in it twice. On this menu
      // laal maas belongs to three sections, so without this the strip would
      // be the same dish three times.
      const dish = section.items.find((d) => d.isAvailable && !taken.has(d.id));
      if (!dish) continue;

      taken.add(dish.id);
      out.push({ section: section.label, dish });
    }
  };

  pick('COLLECTION');
  // Fewer collections showing than slots — before 10pm there are two. The
  // categories are the rest of the menu in the order the property sorted it,
  // which is a weaker signal than curation and so goes second, never first.
  pick('CATEGORY');

  return out;
}
