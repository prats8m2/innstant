import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/db';
import { orders, orderItems, orderItemModifiers } from '@/db/schema/ordering';
import type { CurrencyCode } from '@/lib/money';

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

export interface PlacedOrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  currency: CurrencyCode;
  subtotalMinor: number;
  taxMinor: number;
  serviceChargeMinor: number;
  deliveryFeeMinor: number;
  tipMinor: number;
  totalMinor: number;
  guestNotes: string | null;
  placedAt: Date | null;
  promisedByAt: Date | null;
  lines: PlacedOrderLine[];
}

/**
 * Scoped by stay, not just by id.
 *
 * RLS confines this to the tenant; the stay check confines it to the guest.
 * An order id from the room next door is a 404 rather than someone else's
 * dinner, and the id travels in a URL.
 */
export async function getOrderForStay(
  tx: Tx,
  input: { stayId: string; orderId: string },
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
    placedAt: orders.placedAt,
    promisedByAt: orders.promisedByAt,
  }).from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.stayId, input.stayId)))
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
    : [];

  return {
    ...order,
    currency: order.currency as CurrencyCode,
    lines: items.map((item) => ({
      ...item,
      modifiers: modifiers
        .filter((m) => m.orderItemId === item.id)
        .map(({ name, priceDeltaMinor }) => ({ name, priceDeltaMinor })),
    })),
  };
}
