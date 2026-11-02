import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getDish } from '@/modules/catalog';
import { getCart, contextForSession } from '@/modules/ordering';
import { findProperty } from '@/modules/identity';
import { localTimeAt } from '@/lib/clock';
import { formatMoney, type CurrencyCode } from '@/lib/money';
import { DishForm } from './dish-form';
import { DishView } from './dish-view';
import { addToOrder } from './actions';

/**
 * One dish. The screen a guest actually decides on.
 *
 * Rebuilt from `design/reference/direction-a/GuestDish.dc.html` as real
 * components — see `dish-view.tsx`, which the property-link dish screen
 * renders too.
 *
 * CLAUDE.md #9 still holds here: reading a dish and choosing modifiers needs no
 * verification. The one prompt comes at the first charge to the room, which is
 * placement — not this screen.
 */
export const dynamic = 'force-dynamic';

export default async function DishScreen({
  params,
}: {
  params: Promise<{ qrCode: string; itemId: string }>;
}) {
  const { qrCode, itemId } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const { detail, cart } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      // The property's clock decides whether this dish is on right now — a
      // breakfast dish opened at dinner reads as unavailable rather than
      // taking an order the kitchen will refuse.
      const property = await findProperty(tx, session.propertyId);
      const at = localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata');
      const found = await getDish(tx, { propertyId: session.propertyId, itemId, at });

      /**
       * The cart, in the SAME transaction as the dish.
       *
       * This screen used to load the dish and nothing else, which is why a
       * guest who added something here had no way to look at what they had
       * built without going back to the menu first. The review row in the
       * pinned bar is part of this screen now, so its numbers are read with
       * the dish rather than after it — two queries, one transaction, and no
       * chance of the bar disagreeing with the price above it.
       *
       * Priced `at` the same local time for the same reason the menu does it:
       * a dish outside its schedule must total as unavailable in both places.
       */
      return {
        detail: found,
        cart: found ? await getCart(tx, {
          propertyId: session.propertyId,
          context: contextForSession(session),
          at,
          outlet: {
            outletId: found.outlet.id,
            currency: found.outlet.currency as CurrencyCode,
            taxRateBps: found.outlet.taxRateBps,
            serviceChargeBps: found.outlet.serviceChargeBps,
            deliveryFeeMinor: found.outlet.deliveryFeeMinor,
          },
        }) : null,
      };
    },
  );

  // A dish id that is not on this property's menu — a stale link, a guessed id,
  // another hotel's dish. All the same 404.
  if (!detail) notFound();

  const { dish, outlet, modifierGroups } = detail;
  const currency = dish.currency as CurrencyCode;
  const isOrderable = dish.isAvailable && outlet.isAcceptingOrders;
  const base = `/r/${encodeURIComponent(qrCode)}`;

  const foot = !outlet.isAcceptingOrders
    ? 'The kitchen has stopped taking orders for tonight.'
    : `Cooked to order. About ${dish.prepTimeMinutes ?? outlet.prepTimeMinutes} minutes, and it travels up covered.`;

  return (
    <DishView dish={dish} backHref={`${base}/menu`} foot={foot}>
      <DishForm
        action={addToOrder}
        scope={{ name: 'qrCode', value: qrCode }}
        cartHref={`${base}/cart`}
        dish={{ id: dish.id, priceMinor: dish.priceMinor }}
        groups={modifierGroups}
        currency={currency}
        isOrderable={isOrderable}
        /* Formatted here: a client component importing from a `modules/*`
           index drags `pg` into the browser bundle, and money formatting
           belongs in one place (#5). */
        cart={cart && cart.itemCount > 0
          ? { itemCount: cart.itemCount, total: formatMoney(cart.totals.total) }
          : null}
      />
    </DishView>
  );
}
