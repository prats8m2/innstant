import { and, countDistinct, eq, gte, isNotNull, notInArray } from 'drizzle-orm';
import type { Tx } from '@/db';
import { orders, orderItems } from '@/db/schema/ordering';
import type { OrderStatus } from './transitions';

/**
 * "Most ordered" — the one badge on this menu that is earned. Phase 3.
 *
 * ─── Why this badge and not the other ones ─────────────────────────────────
 *
 * The redesign plan asked for Swiggy's shelf of social proof and got one item
 * of it. `4.2 ★ (2.3k)` needs a ratings table nobody has written and, on a
 * single hotel restaurant, a rating the hotel publishes about itself — which
 * a guest who notices stops trusting the rest of the app over. This one is
 * already true in the database: it counts orders that were actually placed.
 *
 * ─── Why this does not contradict `featured.ts` ────────────────────────────
 *
 * featured.ts refuses demand-counting in so many words — "ranking a restaurant
 * menu by sold quantity promotes masala chai at ₹180 ... the cheap repeat
 * purchase always wins a count". That holds, and it is an argument about what
 * a THREE-DISH STRIP is for, not about whether the count is true. A strip is
 * an invitation and should lead with the laal maas. A badge is a fact printed
 * beside a dish the guest is already looking at, and masala chai genuinely
 * being the thing this kitchen sells most is worth knowing.
 *
 * The one thing taken from that argument: this counts ORDERS, not quantity or
 * money. Six chais on one tray is one table wanting chai, and a count that
 * said six would be flattering a single decision into a trend.
 *
 * ─── Why it can decline to answer ──────────────────────────────────────────
 *
 * The rule, below, is that a thin history produces no badges at all rather
 * than a leaderboard of two. "Most ordered" over three orders is not a fact
 * about the kitchen, it is a fact about Tuesday — and a badge that appears on
 * a dish the day the restaurant opens is the invented social proof this was
 * supposed to be the alternative to.
 */

/** A month. Long enough to be a habit, short enough to be this menu's. */
export const MOST_ORDERED_WINDOW_DAYS = 30;

/**
 * Before any dish is badged, the OUTLET has to have sold this much inside the
 * window. Below it there is no ranking to publish — the top of twelve orders
 * is noise wearing a number.
 */
export const MOST_ORDERED_MIN_OUTLET_ORDERS = 20;

/** And the dish itself has to have been ordered this often. One order is not
 *  a favourite, however quiet the week. */
export const MOST_ORDERED_MIN_ORDERS = 5;

/** How many dishes may carry a rank. A shelf, not a chart. */
export const MOST_ORDERED_TOP_N = 5;

/**
 * Which orders count as demand.
 *
 * Excluded: DRAFT (never left the cart), REJECTED and CANCELLED (the dish was
 * chosen, then the sale did not happen). Everything from PLACED onward counts
 * — including an order still in the pan — because the customer choosing the
 * dish is the event being measured, and waiting for DELIVERED would make the
 * badge lag the kitchen by a service.
 */
const NOT_DEMAND: readonly OrderStatus[] = ['DRAFT', 'REJECTED', 'CANCELLED'];

export interface DishOrderCount {
  menuItemId: string;
  /** Distinct orders containing the dish, not units sold. */
  orders: number;
}

/**
 * Raw counts for one outlet's trailing window, plus what the outlet sold in
 * total over the same window — which is the denominator the threshold above
 * needs and cannot be derived from the counts (one order holds several
 * dishes, so they do not sum to it).
 */
export interface MostOrderedCounts {
  dishes: DishOrderCount[];
  outletOrders: number;
}

export async function mostOrderedCounts(
  tx: Tx,
  input: { outletId: string; now?: Date },
): Promise<MostOrderedCounts> {
  const since = new Date(
    (input.now ?? new Date()).getTime() - MOST_ORDERED_WINDOW_DAYS * 86_400_000,
  );

  const inWindow = and(
    eq(orders.outletId, input.outletId),
    gte(orders.placedAt, since),
    notInArray(orders.status, [...NOT_DEMAND]),
  );

  /*
   * Two queries rather than one with a scalar subquery. The subquery version
   * is one round trip and has to be written as raw SQL, with the table alias
   * and the column names typed by hand — which is how `mo.modifier_group_id`
   * got into `dishesNeedingAChoice()` and was not caught until the menu
   * returned 500 in a browser. Both of these ride `orders_kds_idx`
   * (outlet_id, status, placed_at), so the second one is a cheap index scan.
   */
  const dishes = await tx
    .select({
      menuItemId: orderItems.menuItemId,
      orders: countDistinct(orders.id),
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    // Null where the dish has since been deleted: the FK is ON DELETE SET
    // NULL and the snapshot is the receipt (#6). There is nothing left to
    // badge, so it is not a row.
    .where(and(inWindow, isNotNull(orderItems.menuItemId)))
    .groupBy(orderItems.menuItemId);

  const totals = await tx
    .select({ orders: countDistinct(orders.id) })
    .from(orders)
    .where(inWindow);

  return {
    dishes: dishes
      .filter((row): row is { menuItemId: string; orders: number } => row.menuItemId !== null)
      .map((row) => ({ menuItemId: row.menuItemId, orders: Number(row.orders) })),
    outletOrders: Number(totals[0]?.orders ?? 0),
  };
}

export interface MostOrderedThresholds {
  minOutletOrders?: number;
  minOrders?: number;
  topN?: number;
}

/**
 * Counts → ranks, with every reason to publish nothing applied first.
 *
 * Pure, so the thresholds are tested rather than trusted.
 *
 * Ties share a rank and the next rank skips — 1, 2, 2, 4 — which is the one
 * honest way to cut a leaderboard at five. Breaking a genuine tie by id would
 * print "#2 most ordered" on one of two equally-ordered dishes and nothing on
 * the other, and the difference would be a UUID.
 */
export function rankMostOrdered(
  counts: MostOrderedCounts,
  thresholds: MostOrderedThresholds = {},
): Map<string, number> {
  const minOutletOrders = thresholds.minOutletOrders ?? MOST_ORDERED_MIN_OUTLET_ORDERS;
  const minOrders = thresholds.minOrders ?? MOST_ORDERED_MIN_ORDERS;
  const topN = thresholds.topN ?? MOST_ORDERED_TOP_N;

  const ranks = new Map<string, number>();
  if (counts.outletOrders < minOutletOrders) return ranks;

  const eligible = counts.dishes
    .filter((dish) => dish.orders >= minOrders)
    .sort((a, b) => b.orders - a.orders);

  let rank = 0;
  let previous: number | null = null;

  for (const [index, dish] of eligible.entries()) {
    if (dish.orders !== previous) {
      rank = index + 1;
      previous = dish.orders;
    }
    if (rank > topN) break;
    ranks.set(dish.menuItemId, rank);
  }

  return ranks;
}

/**
 * What a menu read calls: the ranks for one outlet, ready to hang on a dish.
 *
 * An empty map is the normal answer for a new property and for a quiet month,
 * and every caller treats a missing entry as "no badge" rather than as rank
 * zero. There is no shape here that can say "most ordered" about a dish
 * nobody ordered.
 */
export async function mostOrderedDishes(
  tx: Tx,
  input: { outletId: string; now?: Date; thresholds?: MostOrderedThresholds },
): Promise<Map<string, number>> {
  return rankMostOrdered(await mostOrderedCounts(tx, input), input.thresholds);
}
