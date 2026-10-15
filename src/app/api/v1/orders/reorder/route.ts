import { z } from 'zod';
import {
  getCart, lastReorderable, reorderIntoCart,
  listOrdersForContext, listOrdersForCustomer, contextForSession,
} from '@/modules/ordering';
import type { OrderSummary } from '@/modules/ordering';
import type { Tx } from '@/db';
import { requireVisitSession, customerSessionFrom } from '@/lib/api-auth';
import type { CurrencyCode } from '@/lib/money';
import { apiHandler, parseBody, corsPreflight } from '../../_lib/handler';
import { withVisitContext } from '../../_lib/context';
import { apiCart, apiReorder } from '../../_lib/serialise';
import type { ApiReorderSuggestion, ApiReorderResult } from '@/lib/api-contract';

/**
 * `/api/v1/orders/reorder` — "Same as last time". D-080.
 *
 * ─── Why a VISIT session is required for both verbs ────────────────────────
 *
 * Even when the history comes from an account, a reorder has to land in a
 * cart, and a cart belongs to a visit (#10). There is no such thing as
 * reordering into nothing. So the context is what decides WHICH MENU the past
 * order is checked against, and the customer — when there is one — decides
 * only WHOSE HISTORY is read. An order placed at another property in the same
 * tenant simply fails that availability check and is not offered, because its
 * dishes are not on this menu.
 *
 * ─── Which history, and the shape it reuses ────────────────────────────────
 *
 * The same branch `GET /orders` makes, for the same reason (D-081): signed in,
 * the account's orders across visits; signed out, this visit's. It is read
 * here rather than sent by the app so that the thing that AUTHORISES a reorder
 * and the thing that offered it are the same list — see the note on
 * `reorderIntoCart`.
 *
 * ─── Not an idempotency path, and why that is not a miss ───────────────────
 *
 * #8 is about money. This writes to a cart, which is pre-transactional by
 * construction (`cart.ts`) and holds no snapshot and no charge; placement
 * downstream is still keyed, as it has always been. A second tap adds the
 * lines a second time, which is visible and reversible on the very screen this
 * call opens — the app also swallows taps while the request is in flight, the
 * same rule every other cart write in it follows.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Reorder = z.object({ orderId: z.uuid() });

/**
 * Whose orders count as "last time".
 *
 * `customerSessionFrom` is optional throughout: ordering signed out keeps
 * working exactly as it does (#9), and a reorder for an anonymous visit is
 * this visit's own last delivered order.
 */
async function historyFor(
  tx: Tx,
  request: Request,
  session: Awaited<ReturnType<typeof requireVisitSession>>,
): Promise<readonly OrderSummary[]> {
  const customer = await customerSessionFrom(request);
  // The tenant is already pinned by `withTenant` to the VISIT's, so a customer
  // token minted against another tenant reads nothing here rather than
  // reaching across — RLS, not a comparison this handler has to remember.
  if (customer) return listOrdersForCustomer(tx, { guestId: customer.guestId });
  return listOrdersForContext(tx, { context: contextForSession(session) });
}

/**
 * `GET` — the block, or null.
 *
 * Null is the ordinary answer: a first visit, an order that was rejected, or
 * one of its dishes off the menu tonight. The app draws nothing at all for it
 * rather than an explanation, because there is nothing a customer can do with
 * "your last order cannot be repeated" on a storefront.
 */
export const GET = apiHandler(
  '/api/v1/orders/reorder',
  async (request): Promise<ApiReorderSuggestion> => {
    const session = await requireVisitSession(request);

    return withVisitContext(session, async (tx, ctx) => {
      const history = await historyFor(tx, request, session);
      const last = await lastReorderable(tx, {
        history,
        propertyId: ctx.propertyId,
        // Property-local: a dish inside a breakfast window is not offered back
        // at dinner, which is the same rule the menu beneath it obeys.
        at: ctx.at,
      });

      return { reorder: last ? apiReorder(last, ctx.timeZone) : null };
    });
  },
);

/** `POST` — put it in the cart, and hand back the cart. */
export const POST = apiHandler(
  '/api/v1/orders/reorder',
  async (request): Promise<ApiReorderResult> => {
    const session = await requireVisitSession(request);
    const body = await parseBody(request, Reorder, 'We cannot find that order.');

    return withVisitContext(session, async (tx, ctx) => {
      const context = contextForSession(session);
      const history = await historyFor(tx, request, session);

      // Throws if the order is not in that history, or if any line of it can
      // no longer be rebuilt. One transaction, so a refusal half way through
      // leaves the cart exactly as it was.
      await reorderIntoCart(tx, {
        tenantId: ctx.tenantId,
        propertyId: ctx.propertyId,
        context,
        orderId: body.orderId,
        history,
      });

      const currency = ctx.outlet.currency as CurrencyCode;
      const cart = await getCart(tx, {
        propertyId: ctx.propertyId,
        context,
        at: ctx.at,
        outlet: {
          outletId: ctx.outletId,
          currency,
          taxRateBps: ctx.outlet.taxRateBps,
          serviceChargeBps: ctx.outlet.serviceChargeBps,
          deliveryFeeMinor: ctx.outlet.deliveryFeeMinor,
        },
      });

      return { cart: apiCart(cart, ctx.outlet.minimumOrderMinor, currency) };
    });
  },
);

export const OPTIONS = corsPreflight;
