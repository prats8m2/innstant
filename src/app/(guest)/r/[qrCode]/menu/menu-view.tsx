import {
  outletOpenState, describeOpenState, hoursForDay,
  type OutletMenu, type OutletHoursDay,
} from '@/modules/catalog';
import { formatClock, type LocalTime } from '@/lib/clock';
import { formatMoney, type Money } from '@/lib/money';
import { adjustDishInOrder } from './actions';
import { DishStepper } from './dish-stepper';
import { GuestMenu } from './guest-menu';

/**
 * The room's menu as a guest sees it, given everything it needs.
 *
 * Split out of `page.tsx` so the console's preview (`/admin/menu/preview`)
 * renders THIS, not a copy of it. A preview that imitates the guest screen
 * drifts from it the first time either is edited, and then it is a picture of
 * a menu nobody sees. The page keeps the session and the loading; this keeps
 * every word, and `GuestMenu` keeps every pixel — the same component the
 * property-link menu renders (D-079).
 */
export function MenuView({
  qrCode,
  menu,
  hours,
  at,
  inCart,
  cart,
  roomNumber,
}: {
  qrCode: string;
  menu: OutletMenu;
  hours: OutletHoursDay[];
  /** Property-local, and the moment the menu was read for. */
  at: LocalTime;
  /** How many of each dish are already in the order, for the steppers. */
  inCart: ReadonlyMap<string, number>;
  /** The bar at the foot. Null when there is nothing in the order. */
  cart: { itemCount: number; total: Money } | null;
  /** The room, for the line in the bar. The console's preview has none. */
  roomNumber?: string;
}) {
  const base = `/r/${encodeURIComponent(qrCode)}`;
  const { outlet, sections } = menu;

  /**
   * The kitchen's line, under the title.
   *
   * `isAcceptingOrders` is the manual switch a manager throws mid-service, and
   * it wins: a kitchen that has stopped is stopped whatever the schedule says.
   * Otherwise the schedule speaks, in the PROPERTY's timezone (CLAUDE.md
   * "Dates") — a guest in Udaipur must not read a closing time worked out in
   * another region.
   */
  const openState = outletOpenState(hours, at);
  const status = outlet.isAcceptingOrders
    ? {
      line: describeOpenState(openState, formatClock),
      open: openState.isOpen,
      eta: `${outlet.prepTimeMinutes}–${outlet.prepTimeMinutes + 10}`,
    }
    : { line: 'The kitchen has closed for tonight', open: false, eta: null };

  // Today's window, as a range, under the last section. Complementary to the
  // line above, not a repeat of it.
  const today = hoursForDay(hours, at.dayOfWeek);
  const footnote = today
    ? `Kitchen ${formatClock(today.opensAt)} – ${formatClock(today.closesAt)}`
    : null;

  return (
    <GuestMenu
      base={base}
      back={{ href: `${base}/home`, label: 'Back to room home' }}
      context={roomNumber ? (
        <>Room <span className="tabular">{roomNumber}</span></>
      ) : outlet.name}
      title={outlet.name}
      status={status}
      sections={sections}
      steppers={quickSteppers(sections, inCart, (dish, quantity) => (
        <DishStepper
          key={dish.id}
          action={adjustDishInOrder}
          scope={{ name: 'qrCode', value: qrCode }}
          menuItemId={dish.id}
          dishName={dish.name}
          quantity={quantity}
        />
      ))}
      cart={cart && cart.itemCount > 0
        ? { count: cart.itemCount, total: formatMoney(cart.total), href: `${base}/cart` }
        : null}
      footnote={footnote}
      menuWord={menuWordAt(at)}
    />
  );
}

/**
 * A stepper for every dish that can be added in one tap, keyed by id.
 *
 * Only where there is nothing to ask. A dish whose required choice has no
 * default sends the guest inside instead — `canQuickAdd`, decided in the menu
 * read — and one that is off the menu tonight offers nothing at all. A dish
 * that sits in two sections gets one stepper, rendered in both places.
 */
export function quickSteppers(
  sections: OutletMenu['sections'],
  inCart: ReadonlyMap<string, number>,
  make: (dish: { id: string; name: string }, quantity: number) => React.ReactNode,
): Record<string, React.ReactNode> {
  const out: Record<string, React.ReactNode> = {};
  for (const section of sections) {
    for (const dish of section.items) {
      if (out[dish.id] || !dish.isAvailable || !dish.canQuickAdd) continue;
      out[dish.id] = make(dish, inCart.get(dish.id) ?? 0);
    }
  }
  return out;
}

/** "tonight's menu" after four, "today's menu" before — for the empty search. */
export function menuWordAt(at: LocalTime): string {
  const hour = Math.floor(at.minutes / 60);
  return hour >= 16 || hour < 4 ? 'tonight’s menu' : 'today’s menu';
}
