import Link from 'next/link';
import type { MenuDish } from '@/modules/catalog';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { DishImage } from '../../../dish-image';
import { OfferPrice } from '../../../offer-price';
import { DietMark, FoodMarks, HeatMark, dietOf, heatOf } from './food-marks';
import styles from './menu.module.css';

/**
 * One dish on the menu, in one of the three shapes Direction A draws it.
 *
 *   feature — the big card: a 200px photograph, the name at 24px with the
 *             price beside it, and the whole description. A collection's lead.
 *   grid    — a half-width card: a 104px photograph, the name at 18px, price
 *             and the plus at its foot. The rest of a collection.
 *   row     — a 72px thumbnail beside the name, a line of description, and
 *             the price; the plus on the right. A plain category.
 *
 * Which one a dish gets is decided by the section, in `guest-menu.tsx` — never
 * by the dish, so the same dish reads the same way twice on one screen.
 *
 * ─── The link is the name, stretched over the card ─────────────────────────
 *
 * A stepper cannot live inside an <a> — nesting a button in an anchor is
 * invalid, and browsers resolve it by making one of them unclickable. So the
 * anchor wraps only the dish's name, and a pseudo-element stretches its hit
 * area over the whole card; the stepper sits above it. Everything except the
 * stepper still opens the dish, and the link's accessible name is the dish's
 * name rather than a paragraph.
 *
 * No hooks, no 'use client': this renders on the server for the menu and in
 * the browser for search results, from the same function.
 */
export type DishCardVariant = 'feature' | 'grid' | 'row';

export function DishCard({
  dish,
  href,
  variant,
  control,
  eyebrow,
}: {
  dish: MenuDish;
  href: string;
  variant: DishCardVariant;
  /** The stepper, when this dish can be added in one tap. */
  control?: React.ReactNode;
  /** A search result names the section it came from. */
  eyebrow?: string;
}) {
  const currency = dish.currency as CurrencyCode;
  const price = formatMoney(money(dish.priceMinor, currency));
  const soldOut = !dish.isAvailable;

  /**
   * "Sold out today" only when it is the day's portions that ran out (D-086);
   * otherwise the kitchen has 86'd it or it is outside its own hours, and
   * "Not available now" is true of both. "Off tonight" was not true of a
   * breakfast dish at dinner.
   */
  const unavailable = soldOut
    ? (dish.remainingToday === 0 ? 'Sold out today' : 'Not available now')
    : null;

  // D-086: a few portions left is worth saying; forty is not.
  const fewLeft = !soldOut && dish.remainingToday !== null && dish.remainingToday <= 5
    ? `${dish.remainingToday} left today`
    : null;

  const name = (
    <h3 className={styles.dishName}>
      {variant === 'row' && dietOf(dish.dietaryFlags) ? (
        <DietMark diet={dietOf(dish.dietaryFlags)!} />
      ) : null}
      <Link href={href} className={styles.dishLink}>{dish.name}</Link>
    </h3>
  );

  const priceLine = (
    <span className={styles.priceLine}>
      <span className={`${styles.price} tabular`} data-struck={soldOut || undefined}>
        {price}
      </span>
      <OfferPrice listPriceMinor={dish.listPriceMinor} offer={dish.offer} currency={dish.currency} />
    </span>
  );

  const action = soldOut
    ? <span className={styles.soldOutTag}>{unavailable}</span>
    : control ?? null;

  return (
    <li className={styles.dishCard} data-variant={variant} data-available={dish.isAvailable}>
      <span className={styles.photo} aria-hidden="true">
        <DishImage src={dish.imageUrl} />
      </span>

      <div className={styles.dishBody}>
        {eyebrow ? <span className={styles.dishEyebrow}>{eyebrow}</span> : null}

        {variant === 'row' ? (
          <>
            {name}
            {dish.description ? <p className={styles.dishShort}>{dish.description}</p> : null}
            <span className={styles.rowMeta}>
              {priceLine}
              {heatOf(dish.spiceLevel) ? <HeatMark heat={heatOf(dish.spiceLevel)!} /> : null}
            </span>
            {fewLeft ? <span className={styles.fewLeft}>{fewLeft}</span> : null}
          </>
        ) : (
          <>
            <FoodMarks
              flags={dish.dietaryFlags}
              spiceLevel={dish.spiceLevel}
              size={variant === 'feature' ? 'md' : 'sm'}
            />
            {variant === 'feature' ? (
              <div className={styles.featureHead}>
                {name}
                {priceLine}
              </div>
            ) : name}
            {variant === 'feature' && dish.description ? (
              <p className={styles.dishShort}>{dish.description}</p>
            ) : null}
            {fewLeft ? <span className={styles.fewLeft}>{fewLeft}</span> : null}
            {variant === 'grid' || action ? (
              <div className={styles.cardFoot}>
                {variant === 'grid' ? priceLine : null}
                {action}
              </div>
            ) : null}
          </>
        )}
      </div>

      {variant === 'row' && action ? <div className={styles.rowAction}>{action}</div> : null}
    </li>
  );
}
