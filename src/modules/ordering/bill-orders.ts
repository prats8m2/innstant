import { and, inArray, eq, asc } from 'drizzle-orm';
import type { Tx } from '@/db';
import { orders, orderItems } from '@/db/schema/ordering';

export interface OrderOnBill {
  orderNumber: string;
  /** "Laal maas, 2× Butter roti" — the snapshot names (#6), never today's. */
  items: string;
  subtotalMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  deliveryFeeMinor: number;
  tipMinor: number;
  totalMinor: number;
}

/**
 * What each order on a bill was made of (D-095).
 *
 * An order lands on the folio as one line, its total. The checkout screen and
 * the printed invoice show what that total is — the dishes, and the service
 * charge and GST inside it — from the order's own snapshot columns, so a
 * renamed dish or a changed tax rate never rewrites a past bill.
 */
export async function ordersOnBill(
  tx: Tx,
  input: { propertyId: string; orderIds: readonly string[] },
): Promise<Map<string, OrderOnBill>> {
  if (!input.orderIds.length) return new Map();

  const rows = await tx.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    subtotalMinor: orders.subtotalMinor,
    serviceChargeMinor: orders.serviceChargeMinor,
    taxMinor: orders.taxMinor,
    deliveryFeeMinor: orders.deliveryFeeMinor,
    tipMinor: orders.tipMinor,
    totalMinor: orders.totalMinor,
  }).from(orders)
    .where(and(eq(orders.propertyId, input.propertyId), inArray(orders.id, [...input.orderIds])));

  const items = await tx.select({
    orderId: orderItems.orderId,
    name: orderItems.nameSnapshot,
    quantity: orderItems.quantity,
  }).from(orderItems)
    .where(inArray(orderItems.orderId, rows.map((r) => r.id)))
    .orderBy(asc(orderItems.createdAt));

  return new Map(rows.map((row) => [row.id, {
    orderNumber: row.orderNumber,
    items: items
      .filter((i) => i.orderId === row.id)
      .map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name))
      .join(', '),
    subtotalMinor: row.subtotalMinor,
    serviceChargeMinor: row.serviceChargeMinor,
    taxMinor: row.taxMinor,
    deliveryFeeMinor: row.deliveryFeeMinor,
    tipMinor: row.tipMinor,
    totalMinor: row.totalMinor,
  }]));
}
