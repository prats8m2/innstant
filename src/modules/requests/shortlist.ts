import type { RequestTypeCard } from './catalog';

/**
 * The handful of things that go at the top of the amenities screen.
 *
 * ─── The problem this solves ───────────────────────────────────────────────
 *
 * Twenty-two request types render as twenty-two identical rows: three and a
 * half phone screens, every row the same shape, nothing more important than
 * anything else. A guest who wants a towel — which is most of them, most of
 * the time — has to read a catalogue to find one.
 *
 * So the screen leads with a strip of one-tap chips, and this decides what
 * goes in it.
 *
 * ─── How the ranking works ─────────────────────────────────────────────────
 *
 * Demand first, from `countRequestsByType()`: what this property's guests
 * have actually asked for. Then the catalogue's own `sortOrder`, which is the
 * property's stated preference and the only signal a hotel that opened
 * yesterday has.
 *
 * Free before chargeable, at equal demand. A strip of one-tap buttons is a
 * place to put a towel, not a place to sell a bottle of wine — the chargeable
 * things are still one scroll away, on a row that says what they cost. Leading
 * with them would make the fastest control on the screen the one that spends
 * money, which is the opposite of CLAUDE.md #9's instinct.
 *
 * Maintenance is excluded outright. "The air conditioning is broken" is not a
 * frequent action, it is an emergency, and one tap is the wrong affordance for
 * something a guest should be able to describe.
 */

/** Six fits two rows of chips on a 390px screen without becoming a list again. */
const MAX_CHIPS = 6;

const NEVER_A_CHIP: ReadonlySet<RequestTypeCard['category']> = new Set(['MAINTENANCE']);

export function shortlistForChips(
  catalog: readonly RequestTypeCard[],
  demand: ReadonlyMap<string, number>,
  limit: number = MAX_CHIPS,
): RequestTypeCard[] {
  const eligible = catalog.filter((card) => !NEVER_A_CHIP.has(card.category));

  return [...eligible]
    .sort((a, b) => {
      const byDemand = (demand.get(b.id) ?? 0) - (demand.get(a.id) ?? 0);
      if (byDemand !== 0) return byDemand;

      // Free things first when nobody has asked for either yet.
      if (a.isChargeable !== b.isChargeable) return a.isChargeable ? 1 : -1;

      // Then the property's own order, which is what `sortOrder` is for.
      return catalog.indexOf(a) - catalog.indexOf(b);
    })
    .slice(0, limit);
}
