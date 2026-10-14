import { z } from 'zod';
import {
  placeOrder, listOrdersForContext, listOrdersForCustomer,
  contextForSession, OPEN_TO_A_GUEST,
} from '@/modules/ordering';
import { setVisitDetails, destinationLabelFor, VISIT_FULFILMENTS } from '@/modules/visit';
import { requireVisitSession, customerSessionFrom, requireCustomerSession } from '@/lib/api-auth';
import { apiHandler, parseBody, corsPreflight } from '../_lib/handler';
import { withTenant } from '@/db';
import { withVisitContext } from '../_lib/context';
import { apiMoney, apiOrderSummary } from '../_lib/serialise';
import type { ApiOrderSummary, ApiPlacedOrder } from '@/lib/api-contract';

/**
 * `POST /api/v1/orders` — identify and send, in one transaction. D-080.
 *
 * ─── Why this is one call and not two ──────────────────────────────────────
 *
 * It could be `PATCH /visits/current` then `POST /orders`. That shape was
 * rejected for what it does on a failure, and the reasoning is the web cart
 * action's verbatim: a customer who gives a name and a number and then hits a
 * closed kitchen has handed their details to a screen that can do nothing with
 * them, and a second tap on a slow connection with the save already committed
 * has to be reasoned about separately from the idempotency key protecting the
 * order.
 *
 * As one call both happen in ONE transaction. Either the kitchen has the order
 * and the kitchen has the number, or neither happened and the app still holds
 * what was typed.
 *
 * ─── #8, and why the key comes from the app ────────────────────────────────
 *
 * The app mints `idempotencyKey` once per attempt and re-sends the SAME value
 * on a retry. Two taps, a flaky radio, a backgrounded app that resends — all
 * place one order. A key minted server-side would make every retry a new
 * order, which is the single most common duplicate in this product and no less
 * common on a pavement than in a room.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Place = z.object({
  idempotencyKey: z.uuid(),
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(1).max(32),
  fulfilment: z.enum(VISIT_FULFILMENTS),
  deliveryAddress: z.string().trim().max(400).optional(),
  deliveryNotes: z.string().trim().max(280).optional(),
  guestNotes: z.string().trim().max(280).optional(),
});

export const POST = apiHandler('/api/v1/orders', async (request): Promise<ApiPlacedOrder> => {
  const session = await requireVisitSession(request);
  const body = await parseBody(
    request,
    Place,
    'We need a name and a number to send this — the kitchen calls when it is ready.',
  );

  // The signed-in customer, if there is one. Optional throughout: ordering
  // signed out must keep working exactly as it does (#9).
  const customer = await customerSessionFrom(request);

  return withVisitContext(session, async (tx, ctx) => {
    /**
     * Identify FIRST, in this transaction. The destination label is built from
     * the visit row, so it has to be true before the snapshot is taken.
     *
     * `setVisitDetails` is also where a posted fulfilment is overruled: a table
     * tent is a table, whatever a client sends. The label below is built from
     * what it returned, never from what arrived.
     */
    const visit = await setVisitDetails(tx, {
      tenantId: ctx.tenantId,
      propertyId: ctx.propertyId,
      visitId: session.visitId,
      name: body.name,
      phone: body.phone,
      fulfilment: body.fulfilment,
      deliveryAddress: body.deliveryAddress ?? null,
      deliveryNotes: body.deliveryNotes ?? null,
      guestSessionId: session.id,
    });

    const placed = await placeOrder(tx, {
      tenantId: ctx.tenantId,
      propertyId: ctx.propertyId,
      context: contextForSession(session),
      // The outlet the LINK points at. A restaurant on this product may have
      // no in-room dining outlet at all, so the default would find nothing.
      outletId: ctx.outletId,
      fulfilment: visit.fulfilment,
      destinationLabel: destinationLabelFor(visit),
      idempotencyKey: body.idempotencyKey,
      guestSessionId: session.id,
      accessTier: session.accessTier,
      guestNotes: body.guestNotes ?? null,
      /**
       * Only from the CUSTOMER session, never from the visit.
       *
       * `visits.guest_id` is set at checkout from a phone number nobody
       * verified; this is set from a token that proved one. Stamping the
       * former would put a stranger's order into somebody's history the first
       * time a digit was mistyped — and the order carries a delivery address.
       */
      customerGuestId: customer?.guestId ?? null,
    });

    return {
      orderId: placed.orderId,
      orderNumber: placed.orderNumber,
      total: apiMoney(placed.totalMinor, placed.currency),
      wasAlreadyPlaced: placed.wasAlreadyPlaced,
    };
  });
});

/**
 * `GET /api/v1/orders` — what this visit has ordered.
 *
 * Scoped to the visit, which is what makes "your orders" mean this person's.
 * It is also why the list empties when the visit does: a visit is six hours,
 * not an account, so an app that wants history across sessions has to keep it
 * on the device. That is the honest consequence of the sign-in decision behind
 * D-080 and the thing phone-and-OTP accounts would change.
 */
export const GET = apiHandler('/api/v1/orders', async (request): Promise<ApiOrderSummary[]> => {
  /**
   * Two scopes, and the default is the one the shipped APK already asks for.
   *
   * `?scope=account` is additive: an installed client that knows nothing about
   * it keeps getting this visit's orders, which is the promise `/v1` makes.
   */
  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') === 'account' ? 'account' : 'visit';

  if (scope === 'account') {
    // No context needed. This is the state that proved identity could not live
    // inside `guest_sessions`: signed in, having scanned nothing.
    const customer = await requireCustomerSession(request);
    const orders = await withTenant({ tenantId: customer.tenantId }, (tx) =>
      listOrdersForCustomer(tx, { guestId: customer.guestId }));
    return orders.map((order) =>
      apiOrderSummary(order, OPEN_TO_A_GUEST.includes(order.status)));
  }

  const session = await requireVisitSession(request);
  return withVisitContext(session, async (tx) => {
    const orders = await listOrdersForContext(tx, { context: contextForSession(session) });
    // `isLive` is what decides whether the app polls an order. The same list
    // the web uses to split "happening now" from the history.
    return orders.map((order) => apiOrderSummary(order, OPEN_TO_A_GUEST.includes(order.status)));
  });
});

export const OPTIONS = corsPreflight;
