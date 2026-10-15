/**
 * The home screen's small conversions. D-080.
 *
 * ─── Why this file imports nothing at all ──────────────────────────────────
 *
 * Not one React Native import, not even a type from `@contract`. The app has
 * no test runner of its own — `tests/unit/mobile-format.test.ts` runs under
 * the WEB app's `pnpm test` and reaches across into this directory — and a
 * single `react-native` import would make that file unloadable under vitest.
 * The one shape it needs from the contract is written structurally below
 * instead, which costs a four-line interface and buys the tests.
 *
 * ─── What does NOT belong here ─────────────────────────────────────────────
 *
 * Money, and any sentence the server already wrote. `ApiMoney.text` arrives
 * formatted once, Indian-grouped, by the one implementation that is allowed to
 * do it (#5); `openLine`, `statusLabel` and `headline` arrive composed. A
 * helper here that reformatted either would be the second implementation that
 * starts disagreeing with the first.
 */

/** Just enough of `ApiMenuSection` to count over. Structural on purpose. */
interface CountableSection {
  items: Array<{ id: string }>;
}

/**
 * `1` → `I`. The contents list numbers its sections the way a printed card
 * does, and a restaurant has seven sections rather than seventy — but the
 * table covers the thousands anyway, because a subtraction-pair converter is
 * four lines and a seven-entry lookup that silently returns `''` for an eighth
 * section is a bug that waits for the menu to grow.
 */
export function toRoman(value: number): string {
  if (!Number.isInteger(value) || value < 1) return '';

  const pairs: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];

  let left = value;
  let out = '';
  for (const [size, numeral] of pairs) {
    while (left >= size) { out += numeral; left -= size; }
  }
  return out;
}

/**
 * `2` → `02`.
 *
 * The section counts are drawn in a column down the right of the contents
 * list, so they are zero-padded and set in tabular figures: `2` over `11`
 * wobbles, `02` over `11` does not. The HEADER total ("17 dishes") is NOT
 * padded — it is a sentence, not a column.
 */
export function padCount(value: number): string {
  return String(value).padStart(2, '0');
}

/** The spice meter's word, beside its five bars. Null stays null — a dish
 *  with no spice level draws no meter rather than a meter reading zero. */
export function spiceWordFor(level: number | null): string | null {
  if (level === null) return null;
  const words = ['Mild', 'Gentle', 'Medium', 'Hot', 'Very hot'];
  return words[level - 1] ?? null;
}

/**
 * A dietary flag, as the chip that renders it — or null.
 *
 * `tone` rather than a colour, so this file keeps its no-imports promise and
 * the component does the palette lookup. An unknown flag renders NOTHING: the
 * server's list is open-ended and a chip reading `CONTAINS_SHELLFISH` in
 * screaming snake case is worse than no chip, which the dish screen shows in
 * full anyway.
 */
export function flagChipFor(
  flag: string,
): { label: string; tone: 'positive' | 'secondary' } | null {
  switch (flag) {
    case 'VEGETARIAN': return { label: 'Veg', tone: 'positive' };
    case 'VEGAN': return { label: 'Vegan', tone: 'positive' };
    case 'CONTAINS_NUTS': return { label: 'Nuts', tone: 'secondary' };
    default: return null;
  }
}

/**
 * How many DISHES a menu holds — not how many rows it draws.
 *
 * A dish that is on the rooftop collection, the chef's table and its own
 * category appears three times in `sections` and is one thing to eat. The
 * Kesari's live menu is ten dishes across seventeen section appearances, and
 * "17 dishes" under the contents header would be the app counting its own
 * layout back to somebody.
 */
export function distinctDishCount(sections: CountableSection[]): number {
  const seen = new Set<string>();
  for (const section of sections) {
    for (const dish of section.items) seen.add(dish.id);
  }
  return seen.size;
}

/**
 * "Good evening" — in the PROPERTY's timezone, never the device's.
 *
 * CLAUDE.md's rule, and it is not academic here: the greeting sits beside a
 * kitchen's opening hours and an ETA, both of which are already property-local.
 * A customer on a phone still set to London would be told good afternoon under
 * a line saying the kitchen closes at 1am.
 */
export function greetingFor(now: Date, timezone: string): string {
  const hour = hourIn(now, timezone);
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The hour of the day, there.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`, which renders midnight as
 * `24` under some ICU builds and would make the first hour of the day the only
 * one with no greeting.
 */
function hourIn(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now);
    const hour = Number(parts.replace(/\D/g, ''));
    return Number.isFinite(hour) ? hour % 24 : now.getHours();
  } catch {
    // An unknown IANA zone throws rather than falling back. A wrong greeting
    // is not worth a crashed screen.
    return now.getHours();
  }
}

/**
 * The letter in the account corner, once somebody is signed in.
 *
 * `Array.from` rather than `name[0]`: an emoji or a Devanagari cluster is more
 * than one UTF-16 unit, and indexing one gives half a character — a tofu box
 * where an initial should be. Returns an empty string for an empty name, and
 * the corner falls back to the outline icon rather than drawing a blank disc.
 */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '';
}
