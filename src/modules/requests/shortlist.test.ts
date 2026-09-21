import { describe, it, expect } from 'vitest';
import { shortlistForChips } from './shortlist';
import type { RequestTypeCard } from './catalog';

const card = (
  id: string,
  category: RequestTypeCard['category'],
  over: Partial<RequestTypeCard> = {},
): RequestTypeCard => ({
  id,
  key: id,
  name: id,
  description: null,
  category,
  iconKey: null,
  priceMinor: 0,
  currency: 'INR',
  isChargeable: false,
  slaMinutes: 15,
  allowsQuantity: true,
  maxQuantity: 5,
  allowsNote: false,
  allowsPhoto: false,
  ...over,
});

/** Catalogue order IS the property's `sort_order` — `getRequestCatalog` sorts. */
const CATALOG: RequestTypeCard[] = [
  card('towels', 'AMENITY'),
  card('pillow', 'AMENITY'),
  card('laundry', 'SERVICE', { isChargeable: true, priceMinor: 45_000 }),
  card('clean', 'HOUSEKEEPING'),
  card('aircon', 'MAINTENANCE'),
  card('plumbing', 'MAINTENANCE'),
  card('minibar', 'SERVICE', { isChargeable: true, priceMinor: 120_000 }),
  card('water', 'AMENITY'),
];

describe('shortlistForChips', () => {
  it('leads with what guests have actually asked for', () => {
    const demand = new Map([['water', 90], ['clean', 40], ['towels', 12]]);
    expect(shortlistForChips(CATALOG, demand, 3).map((c) => c.id))
      .toEqual(['water', 'clean', 'towels']);
  });

  /**
   * A hotel that opened yesterday has no history at all, and must still get a
   * sensible strip rather than an empty one — this is the case the fallback
   * exists for, and the one most likely to be seen by a new customer.
   */
  it('falls back to the property’s own order when nobody has asked for anything', () => {
    expect(shortlistForChips(CATALOG, new Map(), 4).map((c) => c.id))
      .toEqual(['towels', 'pillow', 'clean', 'water']);
  });

  /**
   * A strip of one-tap buttons is a place to put a towel, not a place to sell
   * a bottle of wine. Chargeable things are still one scroll away on a row
   * that says what they cost; making the fastest control on the screen the one
   * that spends money is the opposite of what #9 is protecting.
   */
  it('puts free things ahead of chargeable ones at equal demand', () => {
    const ids = shortlistForChips(CATALOG, new Map(), 6).map((c) => c.id);
    const firstPaid = ids.findIndex((id) => id === 'laundry' || id === 'minibar');
    const lastFree = Math.max(
      ids.indexOf('towels'), ids.indexOf('pillow'), ids.indexOf('clean'), ids.indexOf('water'),
    );
    expect(firstPaid === -1 || firstPaid > lastFree).toBe(true);
  });

  /** ...but demand still wins. Ninety guests beat a policy about tone. */
  it('lets demand override the free-first preference', () => {
    const demand = new Map([['laundry', 200]]);
    expect(shortlistForChips(CATALOG, demand, 2).map((c) => c.id)[0]).toBe('laundry');
  });

  /**
   * "The air conditioning is broken" is not a frequent action, it is an
   * emergency — and one tap is the wrong affordance for something a guest
   * should be able to describe. Excluded however often it is reported.
   */
  it('never chips maintenance, however much of it there is', () => {
    const demand = new Map([['aircon', 500], ['plumbing', 400]]);
    const ids = shortlistForChips(CATALOG, demand, 6).map((c) => c.id);
    expect(ids).not.toContain('aircon');
    expect(ids).not.toContain('plumbing');
  });

  it('never returns more than the limit, or more than exists', () => {
    expect(shortlistForChips(CATALOG, new Map(), 3)).toHaveLength(3);
    expect(shortlistForChips([card('one', 'AMENITY')], new Map(), 6)).toHaveLength(1);
    expect(shortlistForChips([], new Map(), 6)).toEqual([]);
  });

  /** A count for a type that is no longer in the catalogue must not crash or
   *  conjure a chip out of nothing. */
  it('ignores demand for something that is no longer offered', () => {
    const demand = new Map([['a-deleted-type', 900], ['water', 5]]);
    expect(shortlistForChips(CATALOG, demand, 1).map((c) => c.id)).toEqual(['water']);
  });
});
