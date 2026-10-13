import { getCart, contextForSession } from '@/modules/ordering';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler } from '../_lib/handler';
import { withVisitContext } from '../_lib/context';
import { apiCart } from '../_lib/serialise';
import type { ApiCart } from '@/lib/api-contract';
import type { CurrencyCode } from '@/lib/money';

/**
 * `GET /api/v1/cart` — the cart, priced. D-080.
 *
 * Priced `at` the property's local time, which is what makes a dish outside its
 * own schedule total as unavailable here and on the menu alike. The web screen
 * does the same thing for the same reason: a pill total that disagreed with the
 * menu above it would be a bug the customer finds at the send.
 *
 * Returns the empty shape rather than a 404 when there is no cart. No cart and
 * an emptied cart are different states in the domain — `getCart` returns null
 * for one and lines-of-zero for the other — and the app has one empty screen
 * for both, so flattening them here is cheaper than two code paths that render
 * the same thing.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiHandler('/api/v1/cart', async (request): Promise<ApiCart> => {
  const session = await requireVisitSession(request);

  return withVisitContext(session, async (tx, ctx) => {
    const currency = ctx.outlet.currency as CurrencyCode;
    const cart = await getCart(tx, {
      propertyId: ctx.propertyId,
      context: contextForSession(session),
      at: ctx.at,
      outlet: {
        outletId: ctx.outletId,
        currency,
        taxRateBps: ctx.outlet.taxRateBps,
        serviceChargeBps: ctx.outlet.serviceChargeBps,
        deliveryFeeMinor: ctx.outlet.deliveryFeeMinor,
      },
    });

    return apiCart(cart, ctx.outlet.minimumOrderMinor, currency);
  });
});
