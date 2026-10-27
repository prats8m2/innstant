import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import styles from './offer-price.module.css';

/**
 * Beside a dish's price when an offer set it (D-085): the price it would
 * have been, struck through, and the offer in the guest's words ("20% off").
 *
 * Nothing at all when no offer applies, which is most of the time. The price
 * itself stays where each screen already prints it, because that number is
 * what the guest pays, offer or not.
 */
export function OfferPrice({
  listPriceMinor,
  offer,
  currency,
}: {
  listPriceMinor: number | null;
  offer: { name: string; label: string } | null;
  currency: string;
}) {
  if (listPriceMinor === null || !offer) return null;
  return (
    <>
      <s className={`${styles.was} tabular`} aria-label={`was ${formatMoney(money(listPriceMinor, currency as CurrencyCode))}`}>
        {formatMoney(money(listPriceMinor, currency as CurrencyCode))}
      </s>
      <span className={styles.offer} title={offer.name}>{offer.label}</span>
    </>
  );
}
