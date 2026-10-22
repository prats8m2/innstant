import { dietMarkFor } from './format';

/**
 * What "veg, under ₹600, not too hot" means. Phase 3 of the redesign.
 *
 * ─── Why this file imports nothing from React Native ───────────────────────
 *
 * The same reason `format.ts` does not: the app has no test runner of its own
 * and the unit suite that covers these helpers runs under the WEB app's
 * `pnpm test`, reaching across into this directory. One `react-native` import
 * makes that file unloadable under vitest. `dietMarkFor` is safe to pull in
 * because it keeps the same promise.
 *
 * ─── One model, two consumers, and they must agree ─────────────────────────
 *
 * The SEARCH tab sends these to the server as query parameters; the MENU
 * applies them in the client to the payload it is already holding. That is
 * not an inconsistency — the menu has every dish in memory and filtering a
 * list you already have is not the thing an endpoint exists for, while search
 * over a sixty-dish menu is. What matters is that `matchesFilters` and
 * `filterParams` describe the SAME rule, so a chip does not mean one thing on
 * one screen and something else on the next.
 *
 * Where the server's interpretation differs from `matchesFilters`, the server
 * is right and this is the file to fix — see the two notes below, which are
 * the two places the contract is a guess rather than something read.
 */

export type DietChoice = 'VEG' | 'NON_VEG';

export interface DishFilters {
  /**
   * Multi-select, and empty means "no opinion" rather than "both". The
   * distinction is load-bearing: with both chips on, a dish that declares
   * NEITHER is excluded, because it has not said it is one of the two.
   */
  readonly diet: readonly DietChoice[];
  /** A CEILING on heat, in `spiceLevel` units. Null is no opinion. */
  readonly spiceMax: number | null;
  /** A ceiling on price, in integer minor units (#5). Null is no opinion. */
  readonly priceMaxMinor: number | null;
}

export const NO_FILTERS: DishFilters = { diet: [], spiceMax: null, priceMaxMinor: null };

/**
 * One chip in the rail.
 *
 * `kind` carries the group semantics, and the two groups behave differently
 * on purpose. Diet is genuinely multi-select — "veg or non-veg" is a sentence
 * somebody means. Spice and price are CAPS, and two caps at once is not: a
 * person tapping "Under ₹600" after "Under ₹300" has changed their mind
 * rather than asked for both, so the second replaces the first.
 */
export type FilterChip =
  | { readonly kind: 'diet'; readonly id: string; readonly label: string; readonly value: DietChoice }
  | { readonly kind: 'spice'; readonly id: string; readonly label: string; readonly value: number }
  | { readonly kind: 'price'; readonly id: string; readonly label: string; readonly value: number };

/**
 * The rail, in reading order: what it is, how hot, how much.
 *
 * ─── The spice words are the menu's own ───────────────────────────────────
 *
 * `spiceWordFor` names 1 Mild, 2 Gentle, 3 Medium, 4 Hot, 5 Very hot, and
 * these two chips are caps expressed in those words rather than a new
 * vocabulary — "Medium or milder" is the same scale a dish row prints, so a
 * chip and a row never disagree about what medium is.
 *
 * There is no "Spicy" chip, and it is not an oversight: the endpoint takes a
 * `spiceMax` and nothing else, so a FLOOR has no parameter to travel in. A
 * chip that could only be honoured in the client on one of the two screens is
 * worse than a chip that is not there.
 *
 * ─── The price caps are round rupees, not quantiles ───────────────────────
 *
 * Three fixed ceilings rather than buckets derived from the menu. Derived
 * ones would be better on a menu whose prices this does not suit — but search
 * does not hold the menu to derive them from, and a chip rail that read
 * differently on the two screens for the same restaurant is a worse problem
 * than a cap that is round. The Kesari's live card runs ₹180 to ₹1,420, and
 * these three split it into thirds.
 *
 * Grouped Indian-style in the label because every other figure in the app is
 * (#5). These are the app's own words rather than a server-formatted
 * `ApiMoney` — a threshold is a question, not an amount anybody is charged.
 */
export const FILTER_CHIPS: readonly FilterChip[] = [
  { kind: 'diet', id: 'veg', label: 'Veg', value: 'VEG' },
  { kind: 'diet', id: 'non-veg', label: 'Non-veg', value: 'NON_VEG' },
  { kind: 'spice', id: 'spice-2', label: 'Gentle or milder', value: 2 },
  { kind: 'spice', id: 'spice-3', label: 'Medium or milder', value: 3 },
  { kind: 'price', id: 'price-300', label: 'Under ₹300', value: 30_000 },
  { kind: 'price', id: 'price-600', label: 'Under ₹600', value: 60_000 },
  { kind: 'price', id: 'price-1000', label: 'Under ₹1,000', value: 100_000 },
];

export function isChipOn(filters: DishFilters, chip: FilterChip): boolean {
  switch (chip.kind) {
    case 'diet': return filters.diet.includes(chip.value);
    case 'spice': return filters.spiceMax === chip.value;
    case 'price': return filters.priceMaxMinor === chip.value;
  }
}

/** Tap. Within diet that adds or removes; within a cap it sets or clears. */
export function toggleChip(filters: DishFilters, chip: FilterChip): DishFilters {
  const on = isChipOn(filters, chip);

  switch (chip.kind) {
    case 'diet':
      return {
        ...filters,
        diet: on
          ? filters.diet.filter((choice) => choice !== chip.value)
          : [...filters.diet, chip.value],
      };
    case 'spice':
      return { ...filters, spiceMax: on ? null : chip.value };
    case 'price':
      return { ...filters, priceMaxMinor: on ? null : chip.value };
  }
}

/**
 * How many chips are lit — which is what the count beside "Clear" says.
 *
 * Chips rather than groups: somebody who has tapped Veg, Non-veg and Under
 * ₹600 has three chips lit, and a count of 2 under them would be the app
 * disagreeing with what is on the screen.
 */
export function activeFilterCount(filters: DishFilters): number {
  return filters.diet.length
    + (filters.spiceMax === null ? 0 : 1)
    + (filters.priceMaxMinor === null ? 0 : 1);
}

export function hasFilters(filters: DishFilters): boolean {
  return activeFilterCount(filters) > 0;
}

/** Just enough of `ApiDish` to decide. Structural, for the no-imports rule. */
interface FilterableDish {
  readonly dietaryFlags: readonly string[];
  readonly spiceLevel: number | null;
  readonly price: { readonly minor: number };
}

/**
 * Does this dish pass? The client half of the rule.
 *
 * ─── A dish with no heat declared passes every spice cap ──────────────────
 *
 * The opposite of how `dietMarkFor` treats a missing diet flag, and the
 * asymmetry is deliberate. A missing veg mark is a statement nobody made
 * about something that has two possible answers, and guessing puts meat on a
 * vegetarian's plate. A missing `spiceLevel` is a dish with no heat worth
 * naming — chai, a lassi, a mawa kachori — and filtering those out of "medium
 * or milder" would hide the three mildest things on the card.
 *
 * This is the first of the two places the server has to agree. If
 * `GET /menu/search?spiceMax=` excludes nulls, the two screens will show
 * different dishes for the same chip and THIS comment is the one that was
 * wrong.
 */
export function matchesFilters(dish: FilterableDish, filters: DishFilters): boolean {
  if (filters.diet.length > 0) {
    const mark = dietMarkFor(dish.dietaryFlags);
    if (!mark || !filters.diet.includes(mark)) return false;
  }
  if (filters.spiceMax !== null && dish.spiceLevel !== null && dish.spiceLevel > filters.spiceMax) {
    return false;
  }
  if (filters.priceMaxMinor !== null && dish.price.minor > filters.priceMaxMinor) return false;
  return true;
}

/**
 * The same rule, as query parameters for `GET /api/v1/menu/search`.
 *
 * `flags` is a comma-separated OR, and VEG expands to both of the flags that
 * `dietMarkFor` reads as vegetarian — a kitchen that ticked VEGAN has plainly
 * said the looser thing too, and a search that dropped its vegan dishes from
 * the Veg chip would be a bug nobody would think to look for.
 *
 * The second place the server has to agree: flags are ORed across the list,
 * not ANDed. A dish is VEGETARIAN or it is NON_VEGETARIAN and never both, so
 * an AND reading of `flags=VEGETARIAN,NON_VEGETARIAN` returns nothing at all
 * for two chips that plainly mean "either".
 */
export function filterParams(filters: DishFilters): Record<string, string> {
  const params: Record<string, string> = {};

  /*
   * The names here are the SERVER's, and they were not when this was first
   * written: it emitted `flags`, `spiceMax` and `priceMax` against an
   * endpoint that reads `diet`, `maxSpice` and `maxPrice`. Unknown query
   * params are ignored rather than refused, so every chip lit up, the
   * request succeeded, and the results came back unfiltered. Nothing failed.
   *
   * ─── Why a single diet value and not a list ───────────────────────────────
   *
   * `diet` is AND on the server — "carries every one of these" — which is the
   * right rule for the question it answers (vegan AND nut-free). It is the
   * wrong shape for a veg chip: sending VEGETARIAN,VEGAN asks for dishes that
   * are both, and on this menu that is one dish out of the seven a diner
   * means by "veg".
   *
   * So one flag per choice. And when BOTH chips are lit the filter is dropped
   * entirely, because veg and non-veg together is every dish — ANDing them
   * would ask for food that is both and return an empty menu to somebody who
   * had just asked for all of it.
   */
  const wantsVeg = filters.diet.includes('VEG');
  const wantsNonVeg = filters.diet.includes('NON_VEG');
  if (wantsVeg !== wantsNonVeg) params.diet = wantsVeg ? 'VEGETARIAN' : 'NON_VEGETARIAN';

  if (filters.spiceMax !== null) params.maxSpice = String(filters.spiceMax);
  // Minor units, like every other amount that crosses this boundary (#5).
  if (filters.priceMaxMinor !== null) params.maxPrice = String(filters.priceMaxMinor);

  return params;
}
