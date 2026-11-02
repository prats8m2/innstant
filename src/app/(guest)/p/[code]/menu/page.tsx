import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { withTenant } from '@/db';
import { resolveVisitSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import {
  getMenu, getOutletHours, outletOpenState, describeOpenState, hoursForDay,
} from '@/modules/catalog';
import { findProperty } from '@/modules/identity';
import { localTimeAt, formatClock } from '@/lib/clock';
import { getCart, contextForSession } from '@/modules/ordering';
import { formatMoney } from '@/lib/money';
import type { CurrencyCode } from '@/lib/money';
import { GuestMenu } from '../../../r/[qrCode]/menu/guest-menu';
import { DishStepper } from '../../../r/[qrCode]/menu/dish-stepper';
import { quickSteppers, menuWordAt } from '../../../r/[qrCode]/menu/menu-view';
import { adjustDishInOrder } from './actions';

/**
 * The restaurant's menu — what a property link opens onto. D-079.
 *
 * ─── What this shares with the room menu, and what it cannot ───────────────
 *
 * It shares the SCREEN — `GuestMenu`, the stepper and the stylesheet, imported
 * from `/r/[qrCode]/menu` rather than copied. Two copies of a menu is how one
 * of them quietly stops matching the other, and the design is the same design:
 * this is the same restaurant's menu, opened from a table instead of from a
 * bed. Search comes with it.
 *
 * It cannot share the page, because almost every line that reads the session
 * reads something a visit does not have. The room menu's back button goes to a
 * room home; there isn't one here. Its outlet is resolved by kind, because
 * in-room dining IS the menu for a guest with no choice to make; here the
 * outlet was chosen when somebody created the link, and the session carries it.
 *
 * CLAUDE.md #9 — browsing is never gated, and that does not soften because the
 * person is on a pavement. Prices, dishes, the whole menu, with nothing in the
 * way. The one question comes at checkout.
 */
export const dynamic = 'force-dynamic';

export default async function VisitMenu({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const store = await cookies();
  const session = await resolveVisitSession(store.get(GUEST_SESSION_COOKIE)?.value);

  // Cookie missing, stale, or belonging to a room stay rather than a visit.
  // Back through the link, which opens a fresh visit or shows the dead end.
  if (!session) redirect(`/p/${encodeURIComponent(code)}`);

  const base = `/p/${encodeURIComponent(code)}`;

  const { menu, cart, hours, at, propertyName } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      // The property first, because its timezone decides which collections are
      // showing: "After 10pm" is a window, not a name.
      const found = await findProperty(tx, session.propertyId);
      const localNow = localTimeAt(new Date(), found?.timezone ?? 'Asia/Kolkata');

      const loaded = await getMenu(tx, {
        propertyId: session.propertyId,
        outletId: session.outletId,
        at: localNow,
      });
      if (!loaded) {
        return { menu: null, cart: null, hours: [], at: localNow, propertyName: found?.name ?? null };
      }

      return {
        menu: loaded,
        at: localNow,
        hours: await getOutletHours(tx, loaded.outlet.id),
        propertyName: found?.name ?? null,
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

  // A link pointing at an outlet that has since been archived. A configuration
  // state, not an error page with an apology — but nothing to render.
  if (!menu) notFound();

  const { outlet, sections } = menu;

  // Summed across variants, exactly as the room menu does it: a customer who
  // asked for one gentle and one fiery has two, and a card saying 1 would be
  // arguing with them.
  const inCart = new Map<string, number>();
  for (const line of cart?.lines ?? []) {
    inCart.set(line.menuItemId, (inCart.get(line.menuItemId) ?? 0) + line.quantity);
  }

  const openState = outletOpenState(hours, at);
  const status = outlet.isAcceptingOrders
    ? {
      line: describeOpenState(openState, formatClock),
      open: openState.isOpen,
      eta: `${outlet.prepTimeMinutes}–${outlet.prepTimeMinutes + 10}`,
    }
    : { line: 'The kitchen has closed for tonight', open: false, eta: null };

  const today = hoursForDay(hours, at.dayOfWeek);
  const footnote = today
    ? `Kitchen ${formatClock(today.opensAt)} – ${formatClock(today.closesAt)}`
    : null;

  /**
   * What this link is, said once, quietly, in the bar.
   *
   * A diner at a table tent needs to know the order is going to THEIR table and
   * not to the counter — it is the single most likely thing to go wrong in a
   * room full of people holding phones. One line is enough; the cart says it
   * again where it matters, next to the send button.
   */
  const where = session.tableLabel
    ? session.tableLabel
    : session.fulfilment === 'DELIVERY' ? 'Delivery' : 'Takeaway';

  return (
    <GuestMenu
      base={base}
      /* No back button. There is nowhere behind this screen — a property link
         opens onto the menu, which is the whole of what it does. */
      back={null}
      context={`${outlet.name} · ${where}`}
      title={propertyName ?? outlet.name}
      status={status}
      sections={sections}
      steppers={quickSteppers(sections, inCart, (dish, quantity) => (
        <DishStepper
          key={dish.id}
          action={adjustDishInOrder}
          scope={{ name: 'code', value: code }}
          menuItemId={dish.id}
          dishName={dish.name}
          quantity={quantity}
        />
      ))}
      cart={cart && cart.itemCount > 0
        ? { count: cart.itemCount, total: formatMoney(cart.totals.total), href: `${base}/cart` }
        : null}
      footnote={footnote}
      menuWord={menuWordAt(at)}
    />
  );
}
