import type { MenuDish, MenuSection } from './menu';

/**
 * Searching and filtering a menu. Phase 3.
 *
 * ─── Why the server owns this at all ───────────────────────────────────────
 *
 * Ten dishes filter fine in a client. Sixty do not, and sixty is what a real
 * property has — but the scale argument is the smaller half. The larger one is
 * that "does this dish match" is a RULE: how a query is folded, whether a
 * dish with no declared spice level counts as mild, what two dietary chips
 * mean together. Three clients answering it three ways is three menus, and
 * only one of them is the restaurant's.
 *
 * So the rule lives here, once, with a test.
 *
 * ─── Why it is pure, over the menu `getMenu()` already assembled ───────────
 *
 * Rejected: a `WHERE name ILIKE …` in SQL. Accent-insensitivity is the reason.
 * Postgres folds accents with `unaccent`, which is an extension, and creating
 * one is a migration — and this phase is deliberately migration-free. The
 * alternatives inside SQL were a hand-written `translate()` alphabet (wrong
 * the first time somebody orders a dish with a ligature in it) or
 * `normalize(… NFD)` plus a combining-mark regex, which is correct and is also
 * a second implementation of the folding this file already has to do to the
 * QUERY string. Two implementations of one rule is the thing being avoided.
 *
 * What it costs: the outlet's menu is read whole and narrowed in memory. That
 * is the same read the menu screen already makes on every open, over the same
 * tens of dishes, and it is one round trip rather than two. When a property's
 * menu is big enough for that to stop being true, these predicates become a
 * WHERE clause behind the same function signature and the wire contract does
 * not move — at which point `unaccent` and a GIN index on the folded
 * expression are worth the migration they cost.
 */

/* ── Folding ─────────────────────────────────────────────────────────────── */

/**
 * The one normalisation, applied to both sides of every comparison.
 *
 * Case and accents, and nothing else. NFD splits a letter from its diacritic
 * and the Unicode property escape removes the diacritic, so "Rogan Josh"
 * matches "rogan", and "jalapeño" matches "jalapeno" typed by somebody whose
 * keyboard has no ñ. Deliberately not stemming or transliterating: "paneer"
 * and "panir" are a real miss, and the honest fix for that is a synonym list
 * a property maintains, not a guess made here.
 */
export function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * How well a dish answers the query, as a tier rather than a float.
 *
 * 3 — a word of the NAME starts with it. "chai" → "Masala chai".
 * 2 — the name contains it somewhere. "asal" → "Masala chai".
 * 1 — only the description does. Real, and always below a name match.
 * 0 — no.
 *
 * A tier and not a score because the ordering below it is the menu's own, and
 * a score invites tuning weights nobody can test against a spec. Word-prefix
 * beats substring for the reason a diner types three letters and expects the
 * dish they are thinking of, not the one that happens to contain them.
 */
export type MatchTier = 0 | 1 | 2 | 3;

export function matchTier(dish: MenuDish, foldedQuery: string): MatchTier {
  if (!foldedQuery) return 0;

  const name = foldForSearch(dish.name);
  if (name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(foldedQuery))) return 3;
  if (name.includes(foldedQuery)) return 2;

  const description = dish.description ? foldForSearch(dish.description) : '';
  if (description.includes(foldedQuery)) return 1;

  return 0;
}

/* ── Filters ─────────────────────────────────────────────────────────────── */

/**
 * The three filters the data already supports. All optional, all ANDed.
 *
 * `dietaryFlags` is "carries every one of these" and `excludeDietaryFlags` is
 * "carries none of these", which is two params rather than one because the
 * flags are two different kinds of fact. VEGETARIAN and VEGAN are preferences
 * somebody selects FOR; CONTAINS_NUTS is a warning nobody selects for and
 * everybody with an allergy selects AGAINST. One list with one meaning would
 * make "no nuts" unexpressible.
 *
 * The consequence for the app: veg and non-veg are a single-choice toggle, not
 * two checkboxes. Asking for both is asking for a dish declared as each, which
 * is nothing — correctly, because no dish is both.
 */
export interface MenuFilters {
  dietaryFlags?: readonly string[];
  excludeDietaryFlags?: readonly string[];
  /** Inclusive. A dish with no declared level is excluded — see below. */
  minSpice?: number | null;
  maxSpice?: number | null;
  /** Inclusive, integer minor units (#5). */
  minPriceMinor?: number | null;
  maxPriceMinor?: number | null;
}

export function passesFilters(dish: MenuDish, filters: MenuFilters): boolean {
  const flags = new Set(dish.dietaryFlags);

  for (const required of filters.dietaryFlags ?? []) {
    if (!flags.has(required)) return false;
  }
  for (const banned of filters.excludeDietaryFlags ?? []) {
    if (flags.has(banned)) return false;
  }

  /*
   * A null spice level is "nothing has been said", not "mild" — the same
   * declaration rule the veg mark follows in `ApiDish.dietaryFlags`, where a
   * dish carrying neither flag gets no square drawn rather than a guessed one.
   * So any spice filter excludes it. Filtering for mild food and being handed
   * an undeclared laal maas is the failure that matters here; missing a dish
   * nobody classified is not.
   */
  if (filters.minSpice != null || filters.maxSpice != null) {
    if (dish.spiceLevel == null) return false;
    if (filters.minSpice != null && dish.spiceLevel < filters.minSpice) return false;
    if (filters.maxSpice != null && dish.spiceLevel > filters.maxSpice) return false;
  }

  if (filters.minPriceMinor != null && dish.priceMinor < filters.minPriceMinor) return false;
  if (filters.maxPriceMinor != null && dish.priceMinor > filters.maxPriceMinor) return false;

  return true;
}

/* ── The search itself ───────────────────────────────────────────────────── */

export interface MenuSearchHit {
  /**
   * Where this dish sits on the menu, in the short rail form — the eyebrow
   * over the name in a result row. The FIRST section it appears in wins, and
   * because `getMenu()` puts collections before categories that is the
   * editorial one: "Chef Bhairav" rather than "Mains".
   */
  section: string;
  dish: MenuDish;
}

export interface MenuSearchInput {
  /** Raw, as typed. Folded here; empty or blank means filter-only browsing. */
  query?: string;
  filters?: MenuFilters;
  /** A results list, not the menu. Omitted means no cap. */
  limit?: number;
}

/**
 * The results, ordered.
 *
 * Match tier first, then availability, then the menu's own order. Tier above
 * availability is deliberate and is the one ordering choice worth arguing: a
 * guest who types the exact name of a dish that is 86'd tonight has asked a
 * question, and "Laal maas — not available tonight" at the top answers it.
 * Pushing it under five near-misses answers nothing and reads as a bug in the
 * search.
 *
 * With no query every tier is 0, so the list collapses to "available first, in
 * menu order" — which is what a bare filter chip should produce.
 */
export function searchMenu(
  sections: readonly MenuSection[],
  input: MenuSearchInput = {},
): MenuSearchHit[] {
  const folded = foldForSearch(input.query ?? '');
  const filters = input.filters ?? {};

  const hits: Array<MenuSearchHit & { tier: MatchTier; position: number }> = [];
  const seen = new Set<string>();
  let position = 0;

  for (const section of sections) {
    for (const dish of section.items) {
      // A dish belongs to three sections on this menu. The first is its
      // editorial home and the rest are the same dish; a results list showing
      // it three times is a results list nobody trusts.
      if (seen.has(dish.id)) continue;
      seen.add(dish.id);
      position += 1;

      if (!passesFilters(dish, filters)) continue;

      const tier = matchTier(dish, folded);
      if (folded && tier === 0) continue;

      hits.push({ section: section.label, dish, tier, position });
    }
  }

  hits.sort((a, b) => (
    b.tier - a.tier
    || Number(b.dish.isAvailable) - Number(a.dish.isAvailable)
    || a.position - b.position
  ));

  const capped = input.limit != null ? hits.slice(0, input.limit) : hits;
  return capped.map(({ section, dish }) => ({ section, dish }));
}

/* ── What there is to filter BY ──────────────────────────────────────────── */

/**
 * The chips a filter sheet may offer, taken from this menu rather than from a
 * constant.
 *
 * A "Vegan" chip on a menu with no vegan dish is a chip that can only ever
 * return the empty state, and a price slider whose range is not the menu's
 * range spends half its travel on nothing. Both are decided here, off the same
 * payload the results come from, so a chip cannot offer what the search cannot
 * return.
 *
 * Computed over every dish the outlet is showing, including the ones that are
 * unavailable tonight: they are still on the menu and still in the results,
 * greyed. A filter vocabulary that changed as the kitchen 86'd dishes would
 * move the chips under somebody's thumb.
 */
export interface MenuFacets {
  /** Sorted, so the chip row has a stable order between requests. */
  dietaryFlags: string[];
  /** The distinct declared levels, ascending. Empty when none are declared. */
  spiceLevels: number[];
  /** Integer minor units (#5). Null when the outlet is showing no dishes. */
  priceRange: { minMinor: number; maxMinor: number } | null;
}

export function menuFacets(sections: readonly MenuSection[]): MenuFacets {
  const flags = new Set<string>();
  const levels = new Set<number>();
  const seen = new Set<string>();
  let minMinor = Number.POSITIVE_INFINITY;
  let maxMinor = Number.NEGATIVE_INFINITY;

  for (const section of sections) {
    for (const dish of section.items) {
      if (seen.has(dish.id)) continue;
      seen.add(dish.id);

      for (const flag of dish.dietaryFlags) flags.add(flag);
      if (dish.spiceLevel != null) levels.add(dish.spiceLevel);
      minMinor = Math.min(minMinor, dish.priceMinor);
      maxMinor = Math.max(maxMinor, dish.priceMinor);
    }
  }

  return {
    dietaryFlags: [...flags].sort(),
    spiceLevels: [...levels].sort((a, b) => a - b),
    priceRange: seen.size ? { minMinor, maxMinor } : null,
  };
}

/** How many distinct dishes the outlet is showing, before any of the above. */
export function countDishes(sections: readonly MenuSection[]): number {
  const seen = new Set<string>();
  for (const section of sections) for (const dish of section.items) seen.add(dish.id);
  return seen.size;
}
