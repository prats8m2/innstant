import { z } from 'zod';
import {
  quickAddDish, quickRemoveDish, getCart, contextForSession,
} from '@/modules/ordering';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler, parseBody } from '../../_lib/handler';
import { withVisitContext } from '../../_lib/context';
import { apiCart } from '../../_lib/serialise';
import type { ApiCart } from '@/lib/api-contract';
import type { CurrencyCode } from '@/lib/money';

/**
 * `POST /api/v1/cart/quick-add` — the plus and minus on a menu card. D-080.
 *
 * ─── Why this is not `POST /cart/items` with the modifiers left out ────────
 *
 * Because they mean different things, and the difference is the whole reason
 * the web has two server actions rather than one (see the note at the top of
 * `/r/[qrCode]/menu/actions.ts`).
 *
 * `POST /cart/items` carries a selection somebody MADE: they opened the dish,
 * read the groups, and chose. Leaving the modifiers out of that call is not
 * "use the defaults" — it is an empty selection, and a required group refuses
 * it. Correctly: a client that posts no chilli on a dish that insists on one
 * has a bug, and silently inventing an answer would put a dish on a ticket
 * that nobody asked for.
 *
 * This endpoint is the other case: somebody tapped + on a card without opening
 * it, and `quickAddDish()` fills in the kitchen's OWN defaults — which is a
 * legitimate shortcut rather than a guess, because a default is the chef
 * saying how they would make it. `canQuickAdd` on the dish is what decides
 * whether the app draws a stepper at all; a dish whose required group has no
 * default sends somebody inside instead.
 *
 * The minus is here too, and is not "quantity − 1" on an arbitrary line:
 * `quickRemoveDish()` knows which variant to take from when the cart holds one
 * gentle and one fiery of the same dish.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  menuItemId: z.uuid(),
  direction: z.enum(['add', 'remove']),
});

export const POST = apiHandler('/api/v1/cart/quick-add', async (request): Promise<ApiCart> => {
  const session = await requireVisitSession(request);
  const body = await parseBody(request, Body, 'That did not come through. Try again.');

  return withVisitContext(session, async (tx, ctx) => {
    const context = contextForSession(session);
    const currency = ctx.outlet.currency as CurrencyCode;

    const input = {
      tenantId: ctx.tenantId,
      propertyId: ctx.propertyId,
      context,
      outletId: ctx.outletId,
      menuItemId: body.menuItemId,
    };

    if (body.direction === 'add') await quickAddDish(tx, input);
    else await quickRemoveDish(tx, input);

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

    return apiCart(cart, ctx.outlet.minimumOrderMinor, currency);
  });
});
