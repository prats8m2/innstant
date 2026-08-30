import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { recordEvent } from '@/db';
import { carts, cartItems, orders, orderItems, orderItemModifiers } from '@/db/schema/ordering';
import { idempotencyKeys } from '@/db/schema/core';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { postFolioLine } from '@/modules/billing';
import { dietaryFlagsForStay } from '@/modules/stay';
import { tierAtLeast, type AccessTier } from '@/modules/access';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { getCart } from './cart';

/**
 * Placing the order. The one function in P1 that touches money, and the reason
 * four of the non-negotiables exist.
 *
 * Everything below happens in ONE transaction — the caller's, because the
 * function takes `tx`. That is not a style preference:
 *
 *   #6 every line is SNAPSHOTTED at this moment. Up to here the cart held live
 *      foreign keys and followed a reprice; from here the receipt is frozen and
 *      renaming a dish cannot alter it.
 *   #7 `event_log` gets `order.placed` in the same transaction as the status
 *      change, not in a hook that might fail on its own.
 *   #8 the whole thing is idempotent. A guest double-tapping "Send to the
 *      kitchen" on hotel wifi is the most common duplicate in this product.
 *   #5 every amount is integer minor units with the currency on the row.
 *
 * And the folio line goes in here too, so "Charged to room 214" is true the
 * instant the guest is told it is.
 */

const IDEMPOTENCY_SCOPE = 'order.place';
const IDEMPOTENCY_TTL_HOURS = 24;

export interface PlaceOrderInput {
  tenantId: string;
  propertyId: string;
  stayId: string;
  roomNumber: string;
  /** Stable per attempt, minted by the screen. Two taps send the same key. */
  idempotencyKey: string;

  /**
   * The tier the caller has established. CLAUDE.md #9 / D-012 — placing an
   * order posts money to the room, so it needs CHARGE.
   *
   * Required rather than defaulted, and asserted here rather than only at the
   * screen: the escalation flow is a UI affordance, and a UI affordance is not
   * a control. A future caller — a staff member ordering on a guest's behalf,
   * the PMS — has to state what it established.
   */
  accessTier: AccessTier;
  guestSessionId?: string;
  tipMinor?: number;
  guestNotes?: string | null;
}

export interface PlacedOrder {
  orderId: string;
  orderNumber: string;
  totalMinor: number;
  currency: CurrencyCode;
  itemCount: number;
  /** True when this call found an order the same key had already placed. */
  wasAlreadyPlaced: boolean;
}

export async function placeOrder(tx: Tx, input: PlaceOrderInput): Promise<PlacedOrder> {
  if (!input.idempotencyKey.trim()) {
    throw new ValidationError('That order could not be identified. Try again.');
  }

  if (!tierAtLeast(input.accessTier, 'CHARGE')) {
    // Deliberately not the guest-facing path: by the time anything reaches
    // here the screen should already have asked its one question. This is the
    // backstop that makes the rule true rather than customary.
    throw new ForbiddenError('This order has not been verified for room charges.');
  }

  const replayed = await claimIdempotencyKey(tx, input);
  if (replayed) return { ...replayed, wasAlreadyPlaced: true };

  const outlet = await getInRoomDiningOutletConfig(tx, input.propertyId);
  if (!outlet) throw new NotFoundError('There is no kitchen taking orders here.');
  if (!outlet.isAcceptingOrders) {
    throw new ConflictError('The kitchen has stopped taking orders for tonight.');
  }

  const currency = outlet.currency as CurrencyCode;
  const cart = await getCart(tx, {
    propertyId: input.propertyId,
    stayId: input.stayId,
    outlet: {
      outletId: outlet.id,
      currency,
      taxRateBps: outlet.taxRateBps,
      serviceChargeBps: outlet.serviceChargeBps,
      deliveryFeeMinor: outlet.deliveryFeeMinor,
    },
  });

  if (!cart || cart.lines.length === 0) {
    throw new ConflictError('There is nothing in the order yet.');
  }

  /**
   * A dish that went off the menu while the guest was choosing STOPS the send,
   * naming itself.
   *
   * The alternative — quietly dropping it and sending the rest — is defensible
   * (the cart total already excluded it) and it was rejected: a guest who
   * pressed send on a screen listing four dishes and receives three has been
   * surprised by their own order. One sentence and a tap is cheaper than that.
   */
  const gone = cart.lines.find((line) => !line.isAvailable);
  if (gone) {
    throw new ConflictError(
      `${gone.name} came off the menu while you were choosing. Remove it and send again.`,
    );
  }

  if (cart.totals.subtotal.amountMinor < outlet.minimumOrderMinor) {
    throw new ConflictError(
      `Orders start at ${formatMoney(money(outlet.minimumOrderMinor, currency))}.`,
    );
  }

  const totals = input.tipMinor
    ? { ...cart.totals, total: money(cart.totals.total.amountMinor + input.tipMinor, currency) }
    : cart.totals;

  const orderNumber = await nextOrderNumber(tx, input.propertyId);

  // The kitchen must see the allergy that applied ON THE NIGHT, not today's —
  // so this is copied onto the order, not read through a join later
  // (DATA-MODEL §4).
  const dietaryFlags = await dietaryFlagsForStay(tx, {
    propertyId: input.propertyId,
    stayId: input.stayId,
  });

  const [order] = await tx.insert(orders).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    stayId: input.stayId,
    outletId: outlet.id,
    orderNumber,
    status: 'PLACED',
    subtotalMinor: totals.subtotal.amountMinor,
    taxMinor: totals.tax.amountMinor,
    serviceChargeMinor: totals.serviceCharge.amountMinor,
    deliveryFeeMinor: totals.deliveryFee.amountMinor,
    tipMinor: input.tipMinor ?? 0,
    totalMinor: totals.total.amountMinor,
    currency,
    dietaryFlags,
    guestNotes: input.guestNotes?.trim() || null,
    placedAt: new Date(),
    promisedByAt: new Date(Date.now() + outlet.prepTimeMinutes * 60_000),
  }).returning({ id: orders.id });

  const orderId = order!.id;

  // ── #6, the whole point ────────────────────────────────────────────────
  // name_snapshot and unit_price_minor are what render on a receipt forever.
  // The FK back to the catalog is ON DELETE SET NULL and is for analytics.
  for (const line of cart.lines) {
    const modifiersMinor = line.modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);

    const [item] = await tx.insert(orderItems).values({
      tenantId: input.tenantId,
      orderId,
      menuItemId: line.menuItemId,
      nameSnapshot: line.name,
      unitPriceMinor: line.unitPriceMinor,
      currency,
      quantity: line.quantity,
      lineTotalMinor: (line.unitPriceMinor + modifiersMinor) * line.quantity,
      notes: line.notes,
    }).returning({ id: orderItems.id });

    /**
     * No-op modifiers are not snapshotted.
     *
     * "Nothing" under an optional group costs nothing and means nothing that
     * absence does not already say — and it would otherwise be printed on every
     * kitchen ticket and every receipt, forever, as "Ker sangri · Nothing".
     * The cart filters it from display; the receipt simply does not carry it.
     */
    const printable = line.modifiers.filter((m) => !m.isNoOp);

    if (printable.length) {
      await tx.insert(orderItemModifiers).values(
        printable.map((modifier) => ({
          tenantId: input.tenantId,
          orderItemId: item!.id,
          modifierOptionId: modifier.optionId,
          nameSnapshot: modifier.name,
          priceDeltaMinor: modifier.priceDeltaMinor,
          currency,
        })),
      );
    }
  }

  await postFolioLine(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    stayId: input.stayId,
    source: 'ORDER',
    sourceRefId: orderId,
    description: `In-room dining · ${orderNumber}`,
    amountMinor: totals.total.amountMinor,
    currency,
  });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'order',
    entityId: orderId,
    eventType: 'order.placed',
    fromStatus: 'DRAFT',
    toStatus: 'PLACED',
    actor: input.guestSessionId
      ? { kind: 'GUEST', guestSessionId: input.guestSessionId }
      : { kind: 'SYSTEM' },
    payload: {
      orderNumber,
      roomNumber: input.roomNumber,
      itemCount: cart.itemCount,
      totalMinor: totals.total.amountMinor,
      currency,
    },
  });

  // The cart is emptied in the same transaction. Leaving it would let a reload
  // of the menu show a pill for an order that is already with the kitchen.
  await tx.delete(cartItems).where(eq(cartItems.cartId, cart.id));
  await tx.delete(carts).where(eq(carts.id, cart.id));

  const result: Omit<PlacedOrder, 'wasAlreadyPlaced'> = {
    orderId,
    orderNumber,
    totalMinor: totals.total.amountMinor,
    currency,
    itemCount: cart.itemCount,
  };

  await tx.update(idempotencyKeys)
    .set({ status: 'COMPLETED', responseBody: result, responseStatus: 201 })
    .where(and(
      eq(idempotencyKeys.tenantId, input.tenantId),
      eq(idempotencyKeys.scope, IDEMPOTENCY_SCOPE),
      eq(idempotencyKeys.key, input.idempotencyKey),
    ));

  return { ...result, wasAlreadyPlaced: false };
}

/**
 * #8. Claims the key, or returns what the previous attempt produced.
 *
 * `ON CONFLICT DO NOTHING` and then a read, rather than check-then-insert: two
 * taps arrive milliseconds apart and the unique index is the only thing that
 * actually settles which one is first.
 *
 * A row still IN_PROGRESS means the first attempt is mid-flight or died. Both
 * are refused rather than retried — a second order is far worse than an error
 * the guest can act on, and the first attempt either completes or leaves an
 * expired key behind.
 */
async function claimIdempotencyKey(
  tx: Tx,
  input: PlaceOrderInput,
): Promise<Omit<PlacedOrder, 'wasAlreadyPlaced'> | null> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);

  await tx.insert(idempotencyKeys).values({
    tenantId: input.tenantId,
    scope: IDEMPOTENCY_SCOPE,
    key: input.idempotencyKey,
    status: 'IN_PROGRESS',
    expiresAt,
  }).onConflictDoNothing();

  const rows = await tx.select({
    status: idempotencyKeys.status,
    responseBody: idempotencyKeys.responseBody,
    createdAt: idempotencyKeys.createdAt,
  }).from(idempotencyKeys)
    .where(and(
      eq(idempotencyKeys.tenantId, input.tenantId),
      eq(idempotencyKeys.scope, IDEMPOTENCY_SCOPE),
      eq(idempotencyKeys.key, input.idempotencyKey),
    ))
    .limit(1);

  const claim = rows[0];
  if (!claim) throw new ConflictError('That order could not be sent. Try again.');

  if (claim.status === 'COMPLETED') {
    return claim.responseBody as Omit<PlacedOrder, 'wasAlreadyPlaced'>;
  }

  // Ours: the insert above created it in this transaction.
  const isOurs = Date.now() - new Date(claim.createdAt).getTime() < 1_000;
  if (isOurs) return null;

  throw new ConflictError('That order is already on its way to the kitchen.');
}

/**
 * `KE-1184`. Unique per property, quoted by the guest and printed on the ticket.
 *
 * A transaction-scoped advisory lock keyed on the property serialises number
 * allocation for that property and nothing else. The alternatives were worse:
 * `max(...) + 1` alone races two orders onto the same number, and the unique
 * index turning that into a 23505 aborts the whole transaction — including the
 * folio line and the event — so a retry loop cannot live inside it.
 *
 * The lock is released at commit, and it cannot deadlock: exactly one is taken,
 * always in the same place.
 */
async function nextOrderNumber(tx: Tx, propertyId: string): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${propertyId}))`);

  const rows = await tx.execute<{ next: number }>(sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(${orders.orderNumber}, '\\D', '', 'g'), '')::int), 1183) + 1 AS next
    FROM ${orders}
    WHERE ${orders.propertyId} = ${propertyId}
  `);

  const next = Number(rows.rows[0]?.next ?? 1184);
  return `KE-${next}`;
}
