import { z } from 'zod';
import {
  setCartItemQuantity, removeCartItem, getCart, contextForSession,
} from '@/modules/ordering';
import { ValidationError } from '@/lib/errors';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler, parseBody } from '../../../_lib/handler';
import { withVisitContext } from '../../../_lib/context';
import { apiCart } from '../../../_lib/serialise';
import type { ApiCart } from '@/lib/api-contract';
import type { CurrencyCode } from '@/lib/money';
import type { VisitGuestSession } from '@/modules/access';
import type { VisitContext } from '../../../_lib/context';
import type { Tx } from '@/db';

/**
 * `PATCH` and `DELETE /api/v1/cart/items/{cartItemId}` — one line. D-080.
 *
 * Neither trusts the line id. `setCartItemQuantity` and `removeCartItem`
 * resolve it against THIS visit's cart (`lineInOwnCart`): RLS confines the row
 * to the tenant, and the context check confines it to the one customer. A line
 * id from the next table is a 404 rather than somebody else's dinner — and the
 * id travels in a URL, which is the whole reason that check exists.
 *
 * Quantity 0 through PATCH removes the line, exactly as the domain function
 * does. DELETE is the same operation named the way a client expects it; both
 * exist because a stepper that bottoms out at 1 and needs a separate control
 * is two ways to do one thing, and an app should be able to use either.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CartItemId = z.uuid();
const Body = z.object({ quantity: z.coerce.number().int().min(0).max(20) });

/** The id out of the path — see the note in `menu/[itemId]/route.ts`. */
function lineIdFrom(request: Request): string {
  const segments = new URL(request.url).pathname.split('/');
  const parsed = CartItemId.safeParse(segments.at(-1));
  if (!parsed.success) throw new ValidationError('That is no longer in your order.');
  return parsed.data;
}

/** The cart as it stands after a write, read in the same transaction. */
async function cartAfter(
  tx: Tx,
  ctx: VisitContext,
  session: VisitGuestSession,
): Promise<ApiCart> {
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
}

export const PATCH = apiHandler(
  '/api/v1/cart/items/[cartItemId]',
  async (request): Promise<ApiCart> => {
    const session = await requireVisitSession(request);
    const cartItemId = lineIdFrom(request);
    const { quantity } = await parseBody(request, Body, 'That change did not come through.');

    return withVisitContext(session, async (tx, ctx) => {
      await setCartItemQuantity(tx, {
        context: contextForSession(session),
        cartItemId,
        quantity,
      });
      return cartAfter(tx, ctx, session);
    });
  },
);

export const DELETE = apiHandler(
  '/api/v1/cart/items/[cartItemId]',
  async (request): Promise<ApiCart> => {
    const session = await requireVisitSession(request);
    const cartItemId = lineIdFrom(request);

    return withVisitContext(session, async (tx, ctx) => {
      await removeCartItem(tx, { context: contextForSession(session), cartItemId });
      return cartAfter(tx, ctx, session);
    });
  },
);
