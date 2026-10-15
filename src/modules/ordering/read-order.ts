import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { orders, orderItems, orderItemModifiers } from '@/db/schema/ordering';
import type { CurrencyCode } from '@/lib/money';
import type { OrderStatus } from './transitions';
import type { OrderStamps } from './track';
import { ordersIn, type OrderContext } from './context';

/**
 * Reading a placed order back — the confirmation, and later the tracking
 * screen and the receipt.
 *
 * Everything here comes from the SNAPSHOT columns, never from a join back to
 * the catalog (#6). That is what makes this the same order tomorrow, after the
 * chef has renamed the dish and changed its price.
 */
export interface PlacedOrderModifier {
  name: string;
  priceDeltaMinor: number;
}

export interface PlacedOrderLine {
  id: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
  notes: string | null;
  modifiers: PlacedOrderModifier[];
}

export interface PlacedOrderDetail extends OrderStamps {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currency: CurrencyCode;
  subtotalMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  deliveryFeeMinor: number;
  tipMinor: number;
  totalMinor: number;
  guestNotes: string | null;
  promisedByAt: Date | null;
  /** Whichever of the two the status calls for — the tracking screen shows it
   *  verbatim, so the words a kitchen types reach the guest unedited. */
  haltReason: string | null;
  lines: PlacedOrderLine[];
}

/**
 * Scoped by CONTEXT, not just by id.
 *
 * RLS confines this to the tenant; the context check confines it to the one
 * guest. An order id from the room next door — or, since D-079, from the next
 * table — is a 404 rather than someone else's dinner, and the id travels in a
 * URL.
 */
export async function getOrderForContext(
  tx: Tx,
  input: { context: OrderContext; orderId: string },
): Promise<PlacedOrderDetail | null> {
  const rows = await tx.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    status: orders.status,
    currency: orders.currency,
    subtotalMinor: orders.subtotalMinor,
    taxMinor: orders.taxMinor,
    serviceChargeMinor: orders.serviceChargeMinor,
    deliveryFeeMinor: orders.deliveryFeeMinor,
    tipMinor: orders.tipMinor,
    totalMinor: orders.totalMinor,
    guestNotes: orders.guestNotes,
    promisedByAt: orders.promisedByAt,
    // The status timestamps, for the tracking timeline. Redundant with
    // `event_log` on purpose (DATA-MODEL §6) — written in the same transaction,
    // so a screen reading these cannot disagree with the audit trail.
    placedAt: orders.placedAt,
    acceptedAt: orders.acceptedAt,
    preparingAt: orders.preparingAt,
    readyAt: orders.readyAt,
    outForDeliveryAt: orders.outForDeliveryAt,
    deliveredAt: orders.deliveredAt,
    closedAt: orders.closedAt,
    rejectionReason: orders.rejectionReason,
    cancellationReason: orders.cancellationReason,
  }).from(orders)
    .where(and(eq(orders.id, input.orderId), ordersIn(input.context)))
    .limit(1);

  const order = rows[0];
  if (!order) return null;

  const items = await tx.select({
    id: orderItems.id,
    name: orderItems.nameSnapshot,
    quantity: orderItems.quantity,
    unitPriceMinor: orderItems.unitPriceMinor,
    lineTotalMinor: orderItems.lineTotalMinor,
    notes: orderItems.notes,
  }).from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.createdAt));

  // Scoped to THIS order's items. An earlier version filtered on
  // `orderItemModifiers.tenantId = orders.tenantId`, which compares a column to
  // a column from a table that is not in the FROM clause — it typechecks and
  // returns every modifier the tenant has.
  const modifiers = items.length
    ? await tx.select({
        orderItemId: orderItemModifiers.orderItemId,
        name: orderItemModifiers.nameSnapshot,
        priceDeltaMinor: orderItemModifiers.priceDeltaMinor,
      }).from(orderItemModifiers)
        .where(inArray(orderItemModifiers.orderItemId, items.map((i) => i.id)))
        // Deterministic, because a receipt that lists the same two modifiers in
        // a different order on a second read looks unreliable. `created_at` is
        // not the key: they are inserted in one transaction and share a
        // timestamp to the microsecond.
        .orderBy(asc(orderItemModifiers.nameSnapshot))
    : [];

  const { rejectionReason, cancellationReason, ...rest } = order;

  return {
    ...rest,
    status: order.status as OrderStatus,
    currency: order.currency as CurrencyCode,
    haltReason: rejectionReason ?? cancellationReason ?? null,
    lines: items.map((item) => ({
      ...item,
      modifiers: modifiers
        .filter((m) => m.orderItemId === item.id)
        .map(({ name, priceDeltaMinor }) => ({ name, priceDeltaMinor })),
    })),
  };
}

/**
 * A guest's own orders, newest first — the summary a list needs and no more.
 *
 * ─── Why this is not `getOrderForStay` in a loop ───────────────────────────
 *
 * That one assembles a receipt: every line, every modifier, three queries per
 * order. A list wants one line of prose per order ("2× Laal maas, Masala chai")
 * and its total, so this reads the items in a single pass across all of them
 * and never touches `order_item_modifiers` at all. A stay with fifteen orders
 * is two queries instead of forty-five.
 *
 * Still from the SNAPSHOT columns (#6): what the guest sees here is what they
 * were charged, not what the dish is called today.
 *
 * ─── Why DRAFT is excluded ─────────────────────────────────────────────────
 *
 * A DRAFT is the cart — it exists only inside `placeOrder()` and is not
 * something the guest has asked for. Listing it would put a half-built order in
 * somebody's history.
 */
export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currency: CurrencyCode;
  totalMinor: number;
  placedAt: Date | null;
  promisedByAt: Date | null;
  deliveredAt: Date | null;
  /** Whichever of the two the status calls for — shown verbatim, so the words
   *  a kitchen typed reach the guest unedited. */
  haltReason: string | null;
  /** "2× Laal maas with bajra roti · Masala chai" — the order, at a glance. */
  summary: string;
  itemCount: number;
}

/**
 * "2× Laal maas · Masala chai" — one line of prose for an order.
 *
 * The quantity is only worth saying when there is more than one: "1× Masala
 * chai" is how a receipt talks, not how a person does.
 *
 * It is a function because the rule had TWO copies and they disagreed.
 * `listOrdersForContext` elided the one; `listOrdersForCustomer` — the
 * account-scoped list, which is exactly what a signed-in home screen reads —
 * always wrote `${quantity}× ${name}`, so the same order read differently
 * depending on which list a screen happened to ask for.
 */
function summaryLine(items: ReadonlyArray<{ name: string; quantity: number }>): string {
  return items
    .map((item) => (item.quantity > 1 ? `${item.quantity}× ${item.name}` : item.name))
    .join(' · ');
}

export async function listOrdersForContext(
  tx: Tx,
  input: { context: OrderContext },
): Promise<OrderSummary[]> {
  const rows = await tx.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    status: orders.status,
    currency: orders.currency,
    totalMinor: orders.totalMinor,
    placedAt: orders.placedAt,
    promisedByAt: orders.promisedByAt,
    deliveredAt: orders.deliveredAt,
    rejectionReason: orders.rejectionReason,
    cancellationReason: orders.cancellationReason,
  }).from(orders)
    .where(and(
      ordersIn(input.context),
      ne(orders.status, 'DRAFT'),
    ))
    // Newest first. `placed_at` is null only for a row that never left DRAFT,
    // which the filter above already excludes — `created_at` is the tiebreaker
    // for two orders placed in the same millisecond.
    .orderBy(desc(orders.placedAt), desc(orders.createdAt));

  if (!rows.length) return [];

  const items = await tx.select({
    orderId: orderItems.orderId,
    name: orderItems.nameSnapshot,
    quantity: orderItems.quantity,
  }).from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
    .orderBy(asc(orderItems.createdAt));

  return rows.map(({ rejectionReason, cancellationReason, ...order }) => {
    const mine = items.filter((item) => item.orderId === order.id);
    return {
      ...order,
      status: order.status as OrderStatus,
      currency: order.currency as CurrencyCode,
      haltReason: rejectionReason ?? cancellationReason ?? null,
      itemCount: mine.reduce((n, item) => n + item.quantity, 0),
      summary: summaryLine(mine),
    };
  });
}


/**
 * A customer's own order history, across every visit. D-081.
 *
 * ─── Two predicates, and both are the decision ─────────────────────────────
 *
 * `guest_id = ?` is "placed by this verified account" — the column is stamped
 * only where a customer session was attached, never from the unverified phone
 * on a visit.
 *
 * `link_kind = 'ONLINE'` is "through a direct link". A table order belongs to
 * the table and the moment — who ordered and who pays are routinely different
 * people — and room service belongs to the hotel relationship, which the room
 * sticker governs. `orders.fulfilment` cannot express this on its own:
 * TAKEAWAY is produced by both a COUNTER link and an ONLINE one, and only the
 * second counts.
 *
 * Served by `orders (guest_id, placed_at DESC) WHERE guest_id IS NOT NULL`.
 */
export async function listOrdersForCustomer(
  tx: Tx,
  input: { guestId: string; limit?: number },
): Promise<OrderSummary[]> {
  const rows = await tx.execute<{
    id: string; order_number: string; status: string; currency: string;
    total_minor: number; placed_at: Date | null; promised_by_at: Date | null;
    delivered_at: Date | null;
    rejection_reason: string | null; cancellation_reason: string | null;
  }>(sql`
    SELECT o.id, o.order_number, o.status, o.currency, o.total_minor, o.placed_at,
           o.promised_by_at, o.delivered_at, o.rejection_reason, o.cancellation_reason
    FROM orders o
    JOIN visits v ON v.id = o.visit_id
    WHERE o.guest_id = ${input.guestId}
      AND v.link_kind = 'ONLINE'
      AND o.status <> 'DRAFT'
    ORDER BY o.placed_at DESC NULLS LAST
    LIMIT ${input.limit ?? 50}
  `);

  if (!rows.rows.length) return [];

  const ids = rows.rows.map((r) => r.id);
  const items = await tx.select({
    orderId: orderItems.orderId,
    name: orderItems.nameSnapshot,
    quantity: orderItems.quantity,
  }).from(orderItems)
    .where(inArray(orderItems.orderId, ids))
    .orderBy(asc(orderItems.createdAt));

  return rows.rows.map((order) => {
    const mine = items.filter((item) => item.orderId === order.id);
    return {
      id: order.id,
      orderNumber: order.order_number,
      status: order.status as OrderStatus,
      currency: order.currency as CurrencyCode,
      totalMinor: order.total_minor,
      placedAt: order.placed_at ? new Date(order.placed_at) : null,
      promisedByAt: order.promised_by_at ? new Date(order.promised_by_at) : null,
      deliveredAt: order.delivered_at ? new Date(order.delivered_at) : null,
      // The kitchen's own words when it stopped, shown verbatim — the same
      // rule `listOrdersForContext` follows.
      haltReason: order.rejection_reason ?? order.cancellation_reason ?? null,
      summary: summaryLine(mine),
      itemCount: mine.reduce((n, i) => n + i.quantity, 0),
    };
  });
}
