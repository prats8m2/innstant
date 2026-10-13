import { z } from 'zod';
import { addToCart, getCart, contextForSession } from '@/modules/ordering';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler, parseBody, corsPreflight } from '../../_lib/handler';
import { withVisitContext } from '../../_lib/context';
import { apiCart } from '../../_lib/serialise';
import type { ApiCart } from '@/lib/api-contract';
import type { CurrencyCode } from '@/lib/money';

/**
 * `POST /api/v1/cart/items` — add a dish. D-080.
 *
 * ─── What is NOT trusted from the body ─────────────────────────────────────
 *
 * The price, the dish's availability, and the modifier selection. All three
 * come back out of the database inside `addToCart()`, which validates the
 * chosen options against the dish's own groups and refuses an option that
 * belongs to another dish, has run out, or breaks a group's min/max. A request
 * body is a suggestion.
 *
 * ─── Why it returns the whole cart ─────────────────────────────────────────
 *
 * The app needs the new total and the new count on the pill immediately, and a
 * response of `{ ok: true }` would mean a second round trip on every tap — on
 * a phone, on restaurant wifi, between a tap and the number changing. The cart
 * is small and the read is already in this transaction.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  menuItemId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(20),
  notes: z.string().max(280).optional(),
  modifierOptionIds: z.array(z.uuid()).max(40).optional(),
});

export const POST = apiHandler('/api/v1/cart/items', async (request): Promise<ApiCart> => {
  const session = await requireVisitSession(request);
  const body = await parseBody(request, Body, 'Something in that order did not come through.');

  return withVisitContext(session, async (tx, ctx) => {
    const context = contextForSession(session);
    const currency = ctx.outlet.currency as CurrencyCode;

    await addToCart(tx, {
      tenantId: ctx.tenantId,
      propertyId: ctx.propertyId,
      context,
      menuItemId: body.menuItemId,
      quantity: body.quantity,
      notes: body.notes,
      modifierOptionIds: body.modifierOptionIds,
    });

    // Same transaction as the write, so the total that comes back is the total
    // that was just committed — not one a concurrent tap has already moved.
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

/** Preflight. See the note on `corsPreflight`. */
export const OPTIONS = corsPreflight;
