import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveVisitSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import {
  getMenu, getOutletHours, outletOpenState, describeOpenState, hoursForDay,
} from '@/modules/catalog';
import { findProperty } from '@/modules/identity';
import { localTimeAt, formatClock } from '@/lib/clock';
import { getCart, contextForSession } from '@/modules/ordering';
import { formatMoney, money } from '@/lib/money';
import type { CurrencyCode } from '@/lib/money';
import { CategoryRail } from '../../../r/[qrCode]/menu/category-rail';
import { DishStepper } from './dish-stepper';
import styles from '../../../r/[qrCode]/menu/menu.module.css';
import { DishImage } from '../../../dish-image';
import { OfferPrice } from '../../../offer-price';

/**
 * The restaurant's menu — what a property link opens onto. D-079.
 *
 * ─── What this shares with the room menu, and what it cannot ───────────────
 *
 * It shares the STYLESHEET and the rail, imported from `/r/[qrCode]/menu`
 * rather than copied. Two copies of `menu.module.css` is how one of them
 * quietly stops matching the other, and the design is the same design: this is
 * the same restaurant's menu, opened from a table instead of from a bed.
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

  const kitchenLine = outlet.isAcceptingOrders
    ? describeOpenState(outletOpenState(hours, at), formatClock)
    : 'The kitchen has closed for tonight';

  const today = hoursForDay(hours, at.dayOfWeek);
  const todaysHours = today
    ? `Kitchen ${formatClock(today.opensAt)} – ${formatClock(today.closesAt)}`
    : null;

  const prepWindow = `${outlet.prepTimeMinutes}–${outlet.prepTimeMinutes + 10} min`;

  /**
   * What this link is, said once, quietly.
   *
   * A diner at a table tent needs to know the order is going to THEIR table and
   * not to the counter — it is the single most likely thing to go wrong in a
   * room full of people holding phones. One line under the title is enough; the
   * cart says it again where it matters, next to the send button.
   */
  const where = session.tableLabel
    ? session.tableLabel
    : session.fulfilment === 'DELIVERY' ? 'Delivery' : 'Takeaway';

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <div className={styles.barTop}>
          {/* No back button. There is nowhere behind this screen — a property
              link opens onto the menu, which is the whole of what it does. The
              slot is kept so the title stays centred. */}
          <span className={styles.back} aria-hidden="true" />
          <h1 className={styles.title}>{propertyName ?? outlet.name}</h1>
          <span className={`${styles.eta} tabular`}>
            {outlet.isAcceptingOrders ? prepWindow : 'Closed'}
          </span>
        </div>

        <p className={styles.footer} style={{ margin: '0 0 var(--space-2)' }}>
          {outlet.name} · {where}
        </p>

        <CategoryRail sections={sections.map((s) => ({ id: s.id, label: s.label }))} />
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
                <li
                  key={`${section.id}-${dish.id}`}
                  className={styles.dishCard}
                  data-available={dish.isAvailable}
                >
                  <Link href={`${base}/menu/${dish.id}`} className={styles.dish}>
                    <span className={styles.thumb} aria-hidden="true">
                      <DishImage src={dish.imageUrl} />
                    </span>
                    <span className={styles.dishBody}>
                      <span className={styles.dishName}>{dish.name}</span>
                      {dish.description ? (
                        <span className={styles.dishShort}>{dish.description}</span>
                      ) : null}
                      <span className={styles.dishMeta}>
                        <span className={`${styles.price} tabular`}>
                          {formatMoney(money(dish.priceMinor, dish.currency as CurrencyCode))}
                        </span>
                        <OfferPrice
                          listPriceMinor={dish.listPriceMinor}
                          offer={dish.offer}
                          currency={dish.currency}
                        />
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

                  {dish.isAvailable && dish.canQuickAdd ? (
                    <DishStepper
                      code={code}
                      menuItemId={dish.id}
                      dishName={dish.name}
                      quantity={inCart.get(dish.id) ?? 0}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}

        {todaysHours ? <p className={styles.footer}>{todaysHours}</p> : null}
      </div>

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
