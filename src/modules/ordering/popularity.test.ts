import { describe, it, expect } from 'vitest';
import {
  rankMostOrdered,
  MOST_ORDERED_MIN_ORDERS, MOST_ORDERED_MIN_OUTLET_ORDERS, MOST_ORDERED_TOP_N,
} from './popularity';
import type { MostOrderedCounts } from './popularity';

/**
 * The badge's refusals.
 *
 * Almost everything worth testing here is a reason NOT to print a number —
 * which is the point of the feature: "Most ordered" is the one piece of
 * social proof in this product that is counted rather than published about
 * ourselves, and a count that flatters a quiet Tuesday into a trend would
 * make it the same invention as a self-awarded star rating.
 */
const counts = (
  dishes: Array<[string, number]>,
  outletOrders: number,
): MostOrderedCounts => ({
  dishes: dishes.map(([menuItemId, orders]) => ({ menuItemId, orders })),
  outletOrders,
});

describe('rankMostOrdered', () => {
  it('ranks by orders, best first', () => {
    const ranks = rankMostOrdered(counts([['a', 30], ['b', 12], ['c', 7]], 60));
    expect([...ranks]).toEqual([['a', 1], ['b', 2], ['c', 3]]);
  });

  it('badges nothing at all until the outlet has a history to rank', () => {
    // The demo property's two seeded orders land here, and so does a
    // restaurant's opening week. The top of twelve orders is Tuesday, not
    // the kitchen.
    const thin = rankMostOrdered(counts([['a', 9], ['b', 8]], MOST_ORDERED_MIN_OUTLET_ORDERS - 1));
    expect(thin.size).toBe(0);
  });

  it('drops a dish nobody has ordered often, however busy the outlet', () => {
    const ranks = rankMostOrdered(counts([
      ['a', MOST_ORDERED_MIN_ORDERS],
      ['b', MOST_ORDERED_MIN_ORDERS - 1],
    ], 200));
    expect(ranks.has('a')).toBe(true);
    expect(ranks.has('b')).toBe(false);
  });

  it('gives tied dishes the same rank and skips the one after', () => {
    // 1, 2, 2, 4 — breaking a genuine tie would print "#2 most ordered" on
    // one of two equally ordered dishes, and the difference would be a UUID.
    const ranks = rankMostOrdered(counts([
      ['a', 40], ['b', 20], ['c', 20], ['d', 10],
    ], 200));
    expect([...ranks]).toEqual([['a', 1], ['b', 2], ['c', 2], ['d', 4]]);
  });

  it('keeps every dish of a tie that straddles the cut', () => {
    const six = Array.from({ length: 6 }, (_, i): [string, number] => [`d${i}`, 25]);
    const ranks = rankMostOrdered(counts(six, 500));
    // All six are tied for first, and all six are true.
    expect(ranks.size).toBe(6);
    expect([...new Set(ranks.values())]).toEqual([1]);
  });

  it('stops at the top of the shelf', () => {
    const many = Array.from({ length: 12 }, (_, i): [string, number] => [`d${i}`, 100 - i]);
    expect(rankMostOrdered(counts(many, 1_000)).size).toBe(MOST_ORDERED_TOP_N);
  });

  it('never returns a rank of zero for a dish', () => {
    const ranks = rankMostOrdered(counts([['a', 30]], 100));
    expect([...ranks.values()].every((rank) => rank >= 1)).toBe(true);
  });

  it('answers an empty history with an empty map, not with a leaderboard', () => {
    expect(rankMostOrdered(counts([], 0)).size).toBe(0);
  });

  it('takes thresholds, so a quiet property can be shown the shape of it', () => {
    const ranks = rankMostOrdered(
      counts([['a', 2], ['b', 1]], 3),
      { minOutletOrders: 2, minOrders: 1, topN: 1 },
    );
    expect([...ranks]).toEqual([['a', 1]]);
  });
});
