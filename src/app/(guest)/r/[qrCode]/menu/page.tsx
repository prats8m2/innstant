import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getInRoomDiningMenu, getOutletHours } from '@/modules/catalog';
import { findProperty } from '@/modules/identity';
import { localTimeAt } from '@/lib/clock';
import { getCart, contextForSession } from '@/modules/ordering';
import type { CurrencyCode } from '@/lib/money';
import { MenuView } from './menu-view';

/**
 * In-room dining — the menu.
 *
 * Rebuilt from `design/reference/` as real components; the export is a picture
 * to match, not markup to copy. Every value comes from `theme.css`.
 *
 * CLAUDE.md #9 — browsing is never gated. This renders for an anonymous
 * REQUEST-tier session: prices, dishes and the whole menu, with no
 * verification. The one prompt comes later, at the first charge to the room.
 */
export const dynamic = 'force-dynamic';

export default async function MenuScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  // Cookie missing or stale — checked out, expired, revoked. Back through the
  // link, which issues a fresh session or 404s (#10).
  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);


  // Menu and cart in one transaction — the pill is part of this screen, not a
  // second render, and a guest who has already chosen must not see it appear
  // late.
  const { menu, cart, hours, at } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      // The property FIRST, because its timezone decides which collections are
      // showing: "After 10pm" is a window, not a name (isWithinWindow).
      const found = await findProperty(tx, session.propertyId);
      const localNow = localTimeAt(new Date(), found?.timezone ?? 'Asia/Kolkata');

      const loaded = await getInRoomDiningMenu(tx, session.propertyId, localNow);
      if (!loaded) {
        return { menu: null, cart: null, hours: [], property: found, at: localNow };
      }
      return {
        menu: loaded,
        at: localNow,
        // The real hours, from `outlet_hours`. This line used to be the literal
        // string "Kitchen open until 11:30pm" while the seeded rows said
        // 07:00–01:00 — two sources of truth with the wrong one on screen.
        hours: await getOutletHours(tx, loaded.outlet.id),
        property: found,
        cart: await getCart(tx, {
          propertyId: session.propertyId,
          context: contextForSession(session),
          // A dish outside its schedule must price as unavailable here too, or
          // the pill's total and the send would disagree with the menu above it.
          at: localNow,
          outlet: {
            outletId: loaded.outlet.id,
            currency: loaded.outlet.currency as CurrencyCode,
            taxRateBps: loaded.outlet.taxRateBps,
            serviceChargeBps: loaded.outlet.serviceChargeBps,
            deliveryFeeMinor: loaded.outlet.deliveryFeeMinor,
          },
        }),
      };
    },
  );

  // A property with no in-room dining outlet is a configuration state, not an
  // error page with an apology — but there is nothing to render here.
  if (!menu) notFound();

  /**
   * How many of each dish are already in the order, for the steppers.
   *
   * Summed ACROSS variants: a guest who asked for one gentle and one fiery
   * has two of that dish, and a card saying 1 would be arguing with them. The
   * minus knows which line to take from — see `quickRemoveDish()` — and the
   * cart screen is where the variants are spelled out.
   *
   * No extra query: the cart is already loaded on this screen for the pill.
   */
  const inCart = new Map<string, number>();
  for (const line of cart?.lines ?? []) {
    inCart.set(line.menuItemId, (inCart.get(line.menuItemId) ?? 0) + line.quantity);
  }

  return (
    <MenuView
      qrCode={qrCode}
      menu={menu}
      hours={hours}
      at={at}
      inCart={inCart}
      cart={cart && cart.itemCount > 0 ? { itemCount: cart.itemCount, total: cart.totals.total } : null}
    />
  );
}
