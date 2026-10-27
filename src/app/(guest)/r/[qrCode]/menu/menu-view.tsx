import Link from 'next/link';
import {
  outletOpenState, describeOpenState, hoursForDay,
  type OutletMenu, type OutletHoursDay,
} from '@/modules/catalog';
import { formatClock, type LocalTime } from '@/lib/clock';
import { formatMoney, money, type Money } from '@/lib/money';
import type { CurrencyCode } from '@/lib/money';
import { CategoryRail } from './category-rail';
import { DishStepper } from './dish-stepper';
import styles from './menu.module.css';
import { DishImage } from '../../../dish-image';
import { OfferPrice } from '../../../offer-price';

/**
 * The menu screen as a guest sees it, given everything it needs.
 *
 * Split out of `page.tsx` so the console's preview (`/admin/menu/preview`)
 * renders THIS, not a copy of it. A preview that imitates the guest screen
 * drifts from it the first time either is edited, and then it is a picture of
 * a menu nobody sees. The page keeps the session and the loading; this keeps
 * every pixel.
 */
export function MenuView({
  qrCode,
  menu,
  hours,
  at,
  inCart,
  cart,
}: {
  qrCode: string;
  menu: OutletMenu;
  hours: OutletHoursDay[];
  /** Property-local, and the moment the menu was read for. */
  at: LocalTime;
  /** How many of each dish are already in the order, for the steppers. */
  inCart: ReadonlyMap<string, number>;
  /** The pill. Null shows the kitchen's line instead. */
  cart: { itemCount: number; total: Money } | null;
}) {
  const base = `/r/${encodeURIComponent(qrCode)}`;
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
                /*
                  The CARD is the <li>, not the link.

                  A stepper cannot live inside an <a> — nesting a button in an
                  anchor is invalid, and browsers resolve it by making the
                  whole thing unclickable in one way or another. So the link
                  covers the card's content and the stepper sits beside it,
                  lifted above it. Everything except the two small buttons
                  still opens the dish.
                */
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

                  {/*
                    Only where there is nothing to ask. A dish whose required
                    choice has no default sends the guest inside instead —
                    `canQuickAdd` on the dish, decided in the menu read — and
                    one that is off the menu tonight offers nothing at all.
                  */}
                  {dish.isAvailable && dish.canQuickAdd ? (
                    <DishStepper
                      qrCode={qrCode}
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
            {formatMoney(cart.total)}
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
