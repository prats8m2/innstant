import { applyRateBps, formatMoney, money, type CurrencyCode } from '@/lib/money';
import type { LocalTime } from '@/lib/clock';
import { isCollectionLive, type CollectionSchedule } from './hours';

/**
 * Automatic offers on the menu (D-085). Pure: no database, no clock.
 *
 * Every price a guest is shown or charged passes through `bestOffer()`: the
 * menu read, the dish page, the cart, order placement and the app's API.
 * One function, so the price on the card and the price on the bill cannot
 * disagree about which offer applied.
 *
 * ─── The rules ─────────────────────────────────────────────────────────────
 *
 *  · It comes off the DISH's price, not its modifiers. "20% off the laal maas"
 *    is 20% of ₹1,150; the extra roti is still ₹90.
 *  · A percentage is rounded once, by `applyRateBps` (half away from zero),
 *    the one place this product rounds money (lib/money.ts).
 *  · An amount never takes a dish below zero.
 *  · Never stacked. Of every offer live for a dish, the one that takes the
 *    MOST off applies. On a tie, the more specific one wins (a dish's own
 *    over its section's over the whole menu's) because that is the one a
 *    manager made on purpose for this dish; then the older one, so the
 *    choice is stable from one request to the next.
 */

export type OfferScope = 'DISH' | 'CATEGORY' | 'MENU';
export type OfferKind = 'PERCENT' | 'AMOUNT';

export interface MenuOffer extends CollectionSchedule {
  id: string;
  name: string;
  scope: OfferScope;
  menuItemId: string | null;
  categoryId: string | null;
  kind: OfferKind;
  percentBps: number | null;
  amountMinor: number | null;
  currency: string;
  isActive: boolean;
  /** For the tie-break: older first. ISO string or Date both sort. */
  createdAt: Date | string;
}

/** What a dish needs to say for an offer to find it. */
export interface PricedDish {
  id: string;
  categoryId: string;
  priceMinor: number;
  currency: string;
}

export interface AppliedOffer {
  offerId: string;
  name: string;
  /** "20% off", "₹100 off": what the guest's card says beside the price. */
  label: string;
  /** The price before the offer: what the menu would otherwise say. */
  listPriceMinor: number;
  /** The price the guest pays for the dish. */
  priceMinor: number;
}

const SPECIFICITY: Record<OfferScope, number> = { DISH: 3, CATEGORY: 2, MENU: 1 };

/** Minor units the offer takes off this price. Never more than the price. */
export function discountFor(offer: Pick<MenuOffer, 'kind' | 'percentBps' | 'amountMinor'>, priceMinor: number): number {
  if (priceMinor <= 0) return 0;
  if (offer.kind === 'PERCENT') {
    const bps = Math.min(Math.max(offer.percentBps ?? 0, 0), 10_000);
    // The currency does not change the arithmetic; INR stands in for "minor units".
    return Math.min(applyRateBps(money(priceMinor, 'INR'), bps).amountMinor, priceMinor);
  }
  return Math.min(Math.max(offer.amountMinor ?? 0, 0), priceMinor);
}

/** Whether the offer is aimed at this dish at all, schedule aside. */
export function offerTargets(offer: MenuOffer, dish: PricedDish): boolean {
  switch (offer.scope) {
    case 'DISH': return offer.menuItemId === dish.id;
    case 'CATEGORY': return offer.categoryId === dish.categoryId;
    case 'MENU': return true;
  }
}

/**
 * The offer that applies to this dish at this moment, or null.
 *
 * An offer in another currency than the dish is ignored rather than
 * converted: there is no exchange rate in this product (D-043), and an
 * AMOUNT offer in the wrong currency is a configuration mistake to refuse,
 * not a number to guess at.
 */
export function bestOffer(
  offers: readonly MenuOffer[],
  dish: PricedDish,
  at: LocalTime,
): AppliedOffer | null {
  let best: { offer: MenuOffer; off: number } | null = null;

  for (const offer of offers) {
    if (!offer.isActive || !offerTargets(offer, dish)) continue;
    if (offer.kind === 'AMOUNT' && offer.currency !== dish.currency) continue;
    if (!isCollectionLive(offer, at)) continue;

    const off = discountFor(offer, dish.priceMinor);
    if (off <= 0) continue;

    if (!best || beats({ offer, off }, best)) best = { offer, off };
  }

  if (!best) return null;
  return {
    offerId: best.offer.id,
    name: best.offer.name,
    label: offerLabel(best.offer),
    listPriceMinor: dish.priceMinor,
    priceMinor: dish.priceMinor - best.off,
  };
}

function beats(
  a: { offer: MenuOffer; off: number },
  b: { offer: MenuOffer; off: number },
): boolean {
  if (a.off !== b.off) return a.off > b.off;
  const specific = SPECIFICITY[a.offer.scope] - SPECIFICITY[b.offer.scope];
  if (specific !== 0) return specific > 0;
  return new Date(a.offer.createdAt).getTime() < new Date(b.offer.createdAt).getTime();
}

/** "20% off", "12.5% off", "₹100 off". */
export function offerLabel(offer: Pick<MenuOffer, 'kind' | 'percentBps' | 'amountMinor' | 'currency'>): string {
  if (offer.kind === 'PERCENT') {
    const pct = (offer.percentBps ?? 0) / 100;
    return `${Number.isInteger(pct) ? pct : pct.toFixed(1).replace(/\.0$/, '')}% off`;
  }
  return `${formatMoney(money(offer.amountMinor ?? 0, offer.currency as CurrencyCode))} off`;
}
