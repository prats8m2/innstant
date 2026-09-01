import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import {
  getInRoomDiningMenu, getOutletHours, outletOpenState, describeOpenState, hoursForDay,
} from '@/modules/catalog';
import { findProperty } from '@/modules/identity';
import { localTimeAt, formatClock } from '@/lib/clock';
import { getCart } from '@/modules/ordering';
import { formatMoney, money } from '@/lib/money';
import type { CurrencyCode } from '@/lib/money';
import { CategoryRail } from './category-rail';
import styles from './menu.module.css';

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
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  // Cookie missing or stale — checked out, expired, revoked. Back through the
  // link, which issues a fresh session or 404s (#10).
  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

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
          stayId: session.stayId,
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

  const { outlet, sections } = menu;

  /**
   * What the pill says when the cart is empty.
   *
   * `isAcceptingOrders` is the manual switch a manager throws mid-service, and
   * it wins: a kitchen that has stopped is stopped whatever the schedule says.
   * Otherwise the schedule speaks, in the PROPERTY's timezone (CLAUDE.md
   * "Dates") — a guest in Udaipur must not read a closing time worked out in
   * another region.
   */
  const kitchenLine = outlet.isAcceptingOrders
    ? describeOpenState(outletOpenState(hours, at), formatClock)
    : 'The kitchen has closed for tonight';

  // Today's window, as a range. Complementary to the line above, not a repeat.
  const today = hoursForDay(hours, at.dayOfWeek);
  const todaysHours = today
    ? `Kitchen ${formatClock(today.opensAt)} – ${formatClock(today.closesAt)}`
    : null;

  const prepWindow = `${outlet.prepTimeMinutes}–${outlet.prepTimeMinutes + 10} min`;

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <div className={styles.barTop}>
          <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
            ←
          </Link>
          <h1 className={styles.title}>{outlet.name}</h1>
          <span className={`${styles.eta} tabular`}>
            {outlet.isAcceptingOrders ? prepWindow : 'Closed'}
          </span>
        </div>

        <CategoryRail
          sections={sections.map((s) => ({ id: s.id, label: s.label }))}
        />
      </header>

      <div className={styles.scroll}>
        {sections.map((section) => (
          <section key={section.id} id={section.id} data-section className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>{section.title}</h2>
              <span className={`${styles.sectionCount} tabular`}>
                {section.items.length} {section.items.length === 1 ? 'dish' : 'dishes'}
              </span>
            </div>
            {section.blurb ? <p className={styles.blurb}>{section.blurb}</p> : null}

            <ul className={styles.dishes}>
              {section.items.map((dish) => (
                <li key={`${section.id}-${dish.id}`}>
                  <Link href={`${base}/menu/${dish.id}`} className={styles.dish}>
                    <span className={styles.thumb} aria-hidden="true" />
                    <span className={styles.dishBody}>
                      <span className={styles.dishName}>{dish.name}</span>
                      {dish.description ? (
                        <span className={styles.dishShort}>{dish.description}</span>
                      ) : null}
                      <span className={styles.dishMeta}>
                        <span className={`${styles.price} tabular`}>
                          {formatMoney(money(dish.priceMinor, dish.currency as CurrencyCode))}
                        </span>
                        {/* One flag, two reasons: the kitchen has 86'd it, or it
                            is outside its own hours. "Not available now" is true
                            of both; "off tonight" was not true of a breakfast
                            dish at dinner. */}
                        {dish.isAvailable ? (
                          dish.prepTimeMinutes ? (
                            <span className={styles.tag}>{dish.prepTimeMinutes} min</span>
                          ) : null
                        ) : (
                          <span className={styles.soldOut}>Not available now</span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/*
          The closing time here was the literal "kitchen closes 11:30" — the same
          bug as the pill, on the same screen. It reads the hours now, and it
          reads TODAY'S HOURS rather than the live line: the pill already says
          whether the kitchen is open, and saying it twice is what an e2e
          caught. The chef's name went with the literal — it belonged to one
          hotel, and there is nowhere yet for a property to say who cooks.
        */}
        {todaysHours ? <p className={styles.footer}>{todaysHours}</p> : null}
      </div>

      {/* The pill. Two states, exactly as the reference: a quiet status line
          when there is nothing in the order, and the way into the cart when
          there is. It is a link, not a button — the cart is a real route. */}
      {cart && cart.itemCount > 0 ? (
        <Link href={`${base}/cart`} className={styles.pill}>
          <span className={`${styles.pillCount} tabular`}>{cart.itemCount}</span>
          <span className={styles.pillLabel}>Review order</span>
          <span className={`${styles.pillTotal} tabular`}>
            {formatMoney(cart.totals.total)}
          </span>
          <span className={styles.pillArrow} aria-hidden="true">→</span>
        </Link>
      ) : (
        <p className={styles.pillIdle}>
          <span className={styles.pillDot} aria-hidden="true" />
          {kitchenLine}
        </p>
      )}
    </main>
  );
}
