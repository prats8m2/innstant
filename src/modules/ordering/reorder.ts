import { asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/db';
import { orderItems, orderItemModifiers } from '@/db/schema/ordering';
import { getCartPricing } from '@/modules/catalog';
import { NotFoundError } from '@/lib/errors';
import type { CurrencyCode } from '@/lib/money';
import type { LocalTime } from '@/lib/clock';
import { addToCart } from './cart';
import type { OrderContext } from './context';
import type { OrderSummary } from './read-order';

/**
 * "Same as last time" — the home screen's reorder block. D-080.
 *
 * ─── The one place in this module that reads PAST the snapshot ─────────────
 *
 * Everything in `read-order.ts` comes off the snapshot columns, because a
 * receipt must be the same receipt tomorrow (#6). This is the exception, and
 * it is an exception for exactly the opposite reason: a reorder is not a
 * record of what was sold, it is an instruction to sell it AGAIN. So it reads
 * `order_items.menu_item_id` and `order_item_modifiers.modifier_option_id` —
 * the live FKs the schema calls "analytics only" — and it never reads a
 * snapshotted name or price for anything.
 *
 * The consequence is deliberate: a dish repriced since that order is reordered
 * at TODAY's price, because the lines go into a cart and a cart is priced live
 * (see the note at the top of `cart.ts`). Nothing here touches money at all.
 *
 * ─── Hidden rather than attempted ──────────────────────────────────────────
 *
 * The designer's note: "Last delivered order, one line. Puts the same lines
 * and modifiers in the cart and opens it. Hidden if any line is now
 * unavailable." That last sentence is the whole design of this file. An order
 * is offered only when every one of its lines can be replayed in full today:
 *
 *   · the dish still exists (the FK is ON DELETE SET NULL, so a deleted dish
 *     leaves a null behind and the line can never be rebuilt),
 *   · the dish is available right now, against the PROPERTY's clock,
 *   · every modifier option on it still exists and is available.
 *
 * A partial reorder is not a smaller version of the feature. "Same as last
 * time" that quietly drops the chutney is the app lying about the one thing it
 * said it would do, and a button that fails on tap is worse than no button.
 */

/** A line as it goes BACK into a cart: live ids, never snapshots. */
export interface ReorderLine {
  menuItemId: string;
  quantity: number;
  notes: string | null;
  modifierOptionIds: string[];
}

/** A past order that can be put in the cart again, whole. */
export interface ReorderableOrder {
  orderId: string;
  orderNumber: string;
  placedAt: Date | null;
  totalMinor: number;
  currency: CurrencyCode;
  /** "2× Laal maas · Masala chai" — the summary the list already composed. */
  summary: string;
  lines: ReorderLine[];
}

/**
 * The statuses that mean the food actually arrived.
 *
 * DELIVERED is the guest's end of it; CLOSED is the property's, after billing.
 * A REJECTED or CANCELLED order is not "last time" — it is a thing that did
 * not happen, and offering it back is the app misremembering.
 */
const DELIVERED_STATUSES = ['DELIVERED', 'CLOSED'] as const;

/**
 * The newest order in a history that can be replayed today, or null.
 *
 * The HISTORY is passed in rather than read here, because which orders are
 * "yours" is a scoping decision with two answers — this visit's, or the signed
 * in customer's across visits (D-081) — and both already live in
 * `read-order.ts`. A second copy of that rule here is how the two start
 * disagreeing about whose dinner this was.
 *
 * Only the newest delivered order is considered. There is no walking back
 * through the history looking for one that still works: "same as last time"
 * means the last time, and the fourth-last order is not it.
 */
export async function lastReorderable(
  tx: Tx,
  input: {
    history: readonly OrderSummary[];
    propertyId: string;
    /** Property-local, so a breakfast dish is not offered back at dinner. */
    at?: LocalTime;
  },
): Promise<ReorderableOrder | null> {
  const last = input.history.find((order) => isDelivered(order.status));
  if (!last) return null;

  const lines = await reorderLines(tx, last.id);
  if (!lines) return null;
  if (!(await canReplay(tx, { lines, propertyId: input.propertyId, at: input.at }))) return null;

  return {
    orderId: last.id,
    orderNumber: last.orderNumber,
    placedAt: last.placedAt,
    totalMinor: last.totalMinor,
    currency: last.currency,
    summary: last.summary,
    lines,
  };
}

/**
 * Puts a past order's lines into the current cart and returns how many landed.
 *
 * ─── The history is the authorisation ──────────────────────────────────────
 *
 * The order id arrives from a client, so it proves nothing. What proves
 * something is the SAME scoped history `lastReorderable` was offered — this
 * visit's orders, or the signed-in customer's — and an id that is not in it is
 * a 404 rather than somebody else's dinner. Taking the history as an argument
 * keeps that one scoping rule in `read-order.ts` and out of this file, and it
 * means ownership and "was it ever delivered" are checked by the same lookup.
 *
 * Every add then goes through `addToCart`, which re-validates the dish, its
 * availability, the kitchen's own switch and the modifier selection against
 * TODAY's menu. A line that cannot be added throws, and because the caller
 * holds one transaction open the whole reorder rolls back — a half-applied
 * "same as last time" is not a thing anybody can reason about in a cart.
 */
export async function reorderIntoCart(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    context: OrderContext;
    orderId: string;
    /** The same scoped list that decided what to offer. See above. */
    history: readonly OrderSummary[];
  },
): Promise<{ lineCount: number }> {
  const owned = input.history.find(
    (order) => order.id === input.orderId && isDelivered(order.status),
  );
  if (!owned) throw new NotFoundError('We cannot find that order.');

  const lines = await reorderLines(tx, input.orderId);
  if (!lines || !lines.length) {
    throw new NotFoundError('That order cannot be sent again — some of it is no longer on the menu.');
  }

  for (const line of lines) {
    await addToCart(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      context: input.context,
      menuItemId: line.menuItemId,
      quantity: line.quantity,
      notes: line.notes,
      modifierOptionIds: line.modifierOptionIds,
    });
  }

  return { lineCount: lines.length };
}

function isDelivered(status: string): boolean {
  return (DELIVERED_STATUSES as readonly string[]).includes(status);
}

/**
 * An order's lines as cart input — or null if even one of them cannot be
 * rebuilt from live ids.
 *
 * Null rather than a shorter list, for the reason at the top of this file. The
 * two ways a line stops being rebuildable are both the same FK going null: the
 * dish was deleted, or a modifier option was.
 */
async function reorderLines(tx: Tx, orderId: string): Promise<ReorderLine[] | null> {
  const items = await tx.select({
    id: orderItems.id,
    menuItemId: orderItems.menuItemId,
    quantity: orderItems.quantity,
    notes: orderItems.notes,
  }).from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    // The order the guest built it in, which is the order it reads back in.
    .orderBy(asc(orderItems.createdAt));

  if (!items.length) return null;

  const modifiers = await tx.select({
    orderItemId: orderItemModifiers.orderItemId,
    modifierOptionId: orderItemModifiers.modifierOptionId,
  }).from(orderItemModifiers)
    .where(inArray(orderItemModifiers.orderItemId, items.map((item) => item.id)));

  if (modifiers.some((modifier) => modifier.modifierOptionId === null)) return null;

  const out: ReorderLine[] = [];
  for (const item of items) {
    if (!item.menuItemId) return null;
    out.push({
      menuItemId: item.menuItemId,
      quantity: item.quantity,
      notes: item.notes,
      modifierOptionIds: modifiers
        .filter((modifier) => modifier.orderItemId === item.id)
        .map((modifier) => modifier.modifierOptionId!),
    });
  }
  return out;
}

/**
 * Whether every dish and every option on these lines is on the menu right now.
 *
 * One call to `getCartPricing` for the whole order rather than a `getDish()`
 * per line — the same reason that function exists at all, and it is the same
 * availability oracle the cart read and `placeOrder()` use, so this cannot
 * disagree with what the cart screen would say a moment later.
 *
 * A dish ARCHIVED since the order is simply absent from the map, which is why
 * presence is checked as well as the flag.
 */
async function canReplay(
  tx: Tx,
  input: { lines: readonly ReorderLine[]; propertyId: string; at?: LocalTime },
): Promise<boolean> {
  const itemIds = [...new Set(input.lines.map((line) => line.menuItemId))];
  const optionIds = [...new Set(input.lines.flatMap((line) => line.modifierOptionIds))];

  const pricing = await getCartPricing(tx, {
    propertyId: input.propertyId,
    itemIds,
    optionIds,
    at: input.at,
  });

  return itemIds.every((id) => pricing.items.get(id)?.isAvailable === true)
    && optionIds.every((id) => pricing.options.get(id)?.isAvailable === true);
}
