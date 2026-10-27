import { applyRateBps, money } from '@/lib/money';

/**
 * A bulk price change: "everything in Sweets up 5%, to the nearest ₹10".
 *
 * Pure, so the arithmetic a manager is about to apply to a whole section is
 * tested apart from the database. The percentage goes through `applyRateBps`
 * (the one place this product rounds money), then the result is rounded to
 * the step a menu prints: ₹1,207.50 is not a price anyone writes on a card.
 *
 *  · `percentBps` is signed: +500 is 5% up, -1000 is 10% down.
 *  · `stepMinor` is the rounding step: 1000 = to the nearest ₹10, 100 = ₹1,
 *    1 = leave the paise alone. Halves round up, which is the direction a
 *    price list is rounded in.
 *  · A price never goes below one step (₹0 is not a price), and a dish that
 *    was free stays free.
 */
export function adjustPrice(priceMinor: number, percentBps: number, stepMinor: number): number {
  if (!Number.isInteger(priceMinor) || priceMinor < 0) {
    throw new RangeError(`Not a price: ${priceMinor}`);
  }
  if (!Number.isInteger(percentBps) || percentBps < -9_000 || percentBps > 10_000) {
    throw new RangeError('A bulk change is between 90% down and 100% up.');
  }
  if (!Number.isInteger(stepMinor) || stepMinor < 1) {
    throw new RangeError(`Not a rounding step: ${stepMinor}`);
  }
  if (priceMinor === 0) return 0;

  const change = applyRateBps(money(priceMinor, 'INR'), percentBps).amountMinor;
  const raw = priceMinor + change;
  const rounded = Math.round(raw / stepMinor) * stepMinor;
  return Math.max(rounded, stepMinor);
}
