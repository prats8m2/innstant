import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { recordEvent } from '@/db';
import { carts, cartItems, orders, orderItems, orderItemModifiers } from '@/db/schema/ordering';
import { idempotencyKeys } from '@/db/schema/core';
import { getInRoomDiningOutletConfig, getOutletConfig, claimDailyPortions } from '@/modules/catalog';
import { postFolioLine } from '@/modules/billing';
import { guestProfileForStay } from '@/modules/stay';
import { findProperty } from '@/modules/identity';
import { localTimeAt } from '@/lib/clock';
import { tierAtLeast, type AccessTier } from '@/modules/access';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { getCart } from './cart';
import { contextColumns, type OrderContext } from './context';
import { notifyOrderChanged } from './advance-order';

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
  /** D-079 — a stay (charged to a room) or a visit (paid at the counter). */
  context: OrderContext;
  /**
   * What the kitchen ticket says. Snapshotted onto the order (#6 applied to
   * the destination) so a renamed table tent or a reassigned room cannot move
   * a tray that is already cooking.
   */
  destinationLabel: string;
  /**
   * Which outlet. Null means "the in-room dining one", which is what the room
   * flow has always meant and the only thing it can mean: until a guest can
   * choose between a rooftop bar and room service, that outlet IS the menu.
   * A property link names its outlet, because that was the choice made when
   * somebody created the link.
   */
  outletId?: string | null;
  /**
   * Dine in, takeaway or delivery — for a VISIT. A stay order is always
   * IN_ROOM and this is ignored.
   *
   * Not derived from the context inside this function, because deriving it
   * would mean reading the visit row to find out, and the caller has just read
   * it: the screen that asked "pickup or delivery" is the one calling here.
   * The database holds the two discriminators to each other with
   * `orders_fulfilment_ck`, so a caller that passes the wrong one is a 23514
   * rather than a ticket sent to a table that does not exist.
   */
  fulfilment?: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  /**
   * The signed-in customer, if there was one. D-081.
   *
   * Stamped onto the order as `guest_id`, and ONLY from here — deliberately
   * not from `visits.guest_id`, which checkout sets from a phone number
   * nobody verified. That distinction is the whole of why account history is
   * safe: anonymous checkout takes whatever is typed, and if a stranger's
   * order appeared in somebody's history because a digit was mistyped they
   * would read its `destination_label`, which for a delivery is a home
   * address.
   *
   * Null for the large majority of orders, because most people never make an
   * account and #9 says that has to keep working.
   */
  customerGuestId?: string | null;
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
    //
    // D-079 — a visit session arrives here ALREADY at CHARGE, and the check is
    // left in place rather than branched around. It is cheap, it is the same
    // assertion for both kinds, and the day somebody adds a tier below CHARGE
    // for visits this is the line that catches it.
    throw new ForbiddenError('This order has not been verified for room charges.');
  }

  const replayed = await claimIdempotencyKey(tx, input);
  if (replayed) return { ...replayed, wasAlreadyPlaced: true };

  const outlet = input.outletId
    ? await getOutletConfig(tx, { propertyId: input.propertyId, outletId: input.outletId })
    : await getInRoomDiningOutletConfig(tx, input.propertyId);
  if (!outlet) throw new NotFoundError('There is no kitchen taking orders here.');
  if (!outlet.isAcceptingOrders) {
    throw new ConflictError('The kitchen has stopped taking orders for tonight.');
  }

  const currency = outlet.currency as CurrencyCode;

  // The two discriminators, kept in step. `orders_fulfilment_ck` asserts the
  // same equality in the database; this is where it is made true.
  const fulfilment = input.context.kind === 'STAY'
    ? 'IN_ROOM' as const
    : (input.fulfilment ?? 'TAKEAWAY');

  /**
   * The hotel's own clock, read here rather than taken from the caller.
   *
   * A dish's schedule (`menu_item_availability_windows`) decides whether it can
   * be ordered at all, and this is the path where that becomes a rule instead
   * of a display decision. Computing it inside the function means no caller can
   * forget to pass it — a server action that omitted it would silently accept a
   * breakfast order at dinner.
   */
  const property = await findProperty(tx, input.propertyId);
  const at = localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata');

  const cart = await getCart(tx, {
    propertyId: input.propertyId,
    context: input.context,
    at,
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
      `${gone.name} is not available now. Remove it and send again.`,
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

  /**
   * What the property knows about this guest. One read, two uses.
   *
   * The kitchen must see the allergy that applied ON THE NIGHT, not today's, so
   * the flags are copied onto the order rather than joined later
   * (DATA-MODEL §4).
   *
   * And `charging_blocked` is honoured here. It is the flag a front desk sets
   * when a card has been declined or a guest disputes everything, and it sat in
   * the schema unread until a sweep found it — a charge path that ignores it
   * overrules the desk. Checked before anything is written, and phrased so the
   * guest knows who to talk to rather than being told "no".
   */
  //
  // D-079 — both halves are about a STAY, and neither has a visit equivalent.
  // `charging_blocked` is the front desk's veto on posting to a room, and a
  // visit posts to no room; the dietary flags live on a
  // `guest_property_profiles` row that a walk-in customer does not have. A
  // visit order therefore carries no flags, which is honest rather than
  // convenient: the kitchen has been told nothing about this person, and a
  // ticket that silently printed "no allergies" would be a claim.
  const profile = input.context.kind === 'STAY'
    ? await guestProfileForStay(tx, {
        propertyId: input.propertyId,
        stayId: input.context.stayId,
      })
    : null;

  if (profile?.chargingBlocked) {
    throw new ForbiddenError(
      'Charges to this room are on hold. The front desk can take the order.',
    );
  }

  /**
   * D-086. The day's portions of any limited dish, taken here, after every
   * check that could refuse the order and before anything is written.
   *
   * One statement per limited dish, and it adds only if the total stays
   * within the limit, so two guests ordering the last laal maas at once
   * cannot both get it: one claim waits on the other's row lock, then finds
   * nothing left and throws, and THIS transaction rolls back whole. No
   * order, no folio line, no ticket for a dish the kitchen cannot make.
   * The business date is the hotel's, from the same clock as the schedules.
   */
  await claimDailyPortions(tx, {
    tenantId: input.tenantId,
    businessDate: at.date!,
    lines: cart.lines.map((line) => ({ menuItemId: line.menuItemId, quantity: line.quantity })),
  });

  const dietaryFlags = profile?.dietaryFlags ?? [];

  const [order] = await tx.insert(orders).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    ...contextColumns(input.context),
    // Who placed it, when that was PROVED. See `customerGuestId` above.
    guestId: input.customerGuestId ?? null,
    outletId: outlet.id,
    orderNumber,
    status: 'PLACED',
    fulfilment,
    // #6, applied to the destination. See the column's note in the schema.
    destinationLabel: input.destinationLabel,
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
      // The image as it was sold. Unread by any screen today — nothing has
      // images until R2 is configured — but it is a snapshot column, and a
      // snapshot taken later is not a snapshot (#6).
      imageUrlSnapshot: line.imageUrl,
      unitPriceMinor: line.unitPriceMinor,
      // D-085: the price before the offer, and the offer's name AS IT WAS.
      // A receipt reading ₹920 for a ₹1,150 dish must be able to say why.
      listPriceMinor: line.offer ? line.listPriceMinor : null,
      offerId: line.offer?.id ?? null,
      offerNameSnapshot: line.offer?.name ?? null,
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

  /**
   * "Charged to room 214" is true the instant the guest is told it is — for a
   * guest who HAS a room.
   *
   * D-079 — a visit posts no folio line, and that is the design rather than an
   * omission. A folio is what a stay accumulates and settles at checkout; a
   * restaurant customer pays per order, at the counter or at the door, and
   * there is no later moment at which a balance would be collected. Giving
   * `folios` a nullable stay to accommodate them would create a folio nobody
   * ever settles and a balance nobody ever reads.
   *
   * The order's own `total_minor` is the record of what is owed, which is where
   * online payment attaches when Razorpay is wired up — to the order, not to a
   * folio that should not exist.
   */
  if (input.context.kind === 'STAY') {
    await postFolioLine(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      stayId: input.context.stayId,
      source: 'ORDER',
      sourceRefId: orderId,
      description: `In-room dining · ${orderNumber}`,
      amountMinor: totals.total.amountMinor,
      currency,
    });
  }

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
      // What the ticket says — "Room 214", "Table 4", "Delivery · 12 MG Road".
      destination: input.destinationLabel,
      fulfilment,
      itemCount: cart.itemCount,
      totalMinor: totals.total.amountMinor,
      currency,
    },
  });

  /**
   * Tell the kitchen. Same transaction, same reason as every other transition:
   * a notification Postgres holds until COMMIT cannot announce an order that
   * then rolls back.
   *
   * This was missed at first — `advanceOrder()` notified and placement did not,
   * so every hop after the first appeared live on the KDS and the arrival of
   * the order itself did not. That is exactly backwards: a ticket appearing is
   * the event a kitchen is waiting for.
   */
  await notifyOrderChanged(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: outlet.id,
    orderId,
    orderNumber,
    ...contextColumns(input.context),
    status: 'PLACED',
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
