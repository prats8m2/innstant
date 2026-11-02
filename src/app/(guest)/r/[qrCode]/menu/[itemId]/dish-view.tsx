import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { MenuDish } from '@/modules/catalog';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { DishImage } from '../../../../dish-image';
import { OfferPrice } from '../../../../offer-price';
import { FoodMarks, dietaryWords } from '../food-marks';
import styles from './dish.module.css';

/**
 * One dish, as Direction A draws it (GuestDish.dc.html): a 300px photograph
 * running to the edges with the back button on it, the name at 32px, the
 * price, the description, then the choices — and the stepper and the Add
 * button pinned at the foot, where a thumb is.
 *
 * Shared by the room's dish screen and the property link's (D-079). The page
 * reads the session; this draws, and the form it is handed carries the action
 * bound to the right flow.
 */
export function DishView({
  dish,
  backHref,
  foot,
  children,
}: {
  dish: MenuDish;
  backHref: string;
  /** The one line under the choices — how long, or that the kitchen stopped. */
  foot: string;
  /** The orderable part: `DishForm`, bound to its flow's action. */
  children: React.ReactNode;
}) {
  const currency = dish.currency as CurrencyCode;
  const facts = dietaryWords(dish.dietaryFlags);

  return (
    <main className={styles.shell}>
      <div className={styles.hero}>
        <DishImage src={dish.imageUrl} priority />
        <Link href={backHref} className={styles.back} aria-label="Back to the menu">
          <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </div>

      <div className={styles.body}>
        <div className={styles.lede}>
          <FoodMarks flags={dish.dietaryFlags} spiceLevel={dish.spiceLevel} size="md" />
          <h1 className={styles.name}>{dish.name}</h1>
          <p className={styles.price}>
            <span className="tabular">{formatMoney(money(dish.priceMinor, currency))}</span>
            <OfferPrice listPriceMinor={dish.listPriceMinor} offer={dish.offer} currency={dish.currency} />
            {!dish.isAvailable ? (
              <span className={styles.soldOut}>
                {dish.remainingToday === 0 ? 'Sold out today' : 'Not available now'}
              </span>
            ) : dish.remainingToday !== null && dish.remainingToday <= 5 ? (
              <span className={styles.fewLeft}>{dish.remainingToday} left today</span>
            ) : null}
          </p>
          {dish.description ? <p className={styles.description}>{dish.description}</p> : null}
          {facts.length ? <p className={styles.facts}>{facts.join(' · ')}</p> : null}
        </div>

        {children}

        <p className={styles.foot}>{foot}</p>
      </div>
    </main>
  );
}
