import {
  type CurrencyCode, type Money,
  addMoney, applyRateBps, money, multiplyMoney, sumMoney,
} from '@/lib/money';

/**
 * What an order costs. Pure — no database, no clock, no request.
 *
 * Kept separate from the cart service on purpose: this is the one calculation
 * a guest checks against their folio, and it has to be testable without a
 * transaction. Every branch here has a unit test (CLAUDE.md "Tests").
 *
 * ─── The order of operations, and why ──────────────────────────────────────
 *
 * Modifiers price into the LINE, before quantity: two dishes with extra ghee
 * is two lots of ghee, not one. Rates then apply to the SUBTOTAL, once —
 * applying tax per line and summing would round N times and drift by a few
 * paise against the folio, which is exactly the kind of discrepancy a guest
 * notices and a hotel cannot explain.
 *
 * The delivery fee is charged once per order, not per line, and is deliberately
 * NOT in the base the rates apply to unless the property says so — that is a
 * tax question with a real answer per jurisdiction, so it is a flag rather than
 * an assumption baked into arithmetic.
 */
export interface TotalsLine {
  unitPriceMinor: number;
  /** Signed minor units, already summed for this line's chosen modifiers. */
  modifiersMinor: number;
  quantity: number;
}

export interface TotalsConfig {
  currency: CurrencyCode;
  taxRateBps: number;
  serviceChargeBps: number;
  deliveryFeeMinor: number;
  /** Tips are the guest's, added last, and never taxed. */
  tipMinor?: number;
  /** Whether the delivery fee is part of the base tax and service apply to. */
  ratesIncludeDeliveryFee?: boolean;
}

export interface OrderTotals {
  subtotal: Money;
  tax: Money;
  serviceCharge: Money;
  deliveryFee: Money;
  tip: Money;
  total: Money;
}

export function lineTotal(line: TotalsLine, currency: CurrencyCode): Money {
  const unit = addMoney(
    money(line.unitPriceMinor, currency),
    money(line.modifiersMinor, currency),
  );
  return multiplyMoney(unit, line.quantity);
}

export function calculateTotals(
  lines: readonly TotalsLine[],
  config: TotalsConfig,
): OrderTotals {
  const { currency } = config;

  const subtotal = sumMoney(lines.map((l) => lineTotal(l, currency)), currency);
  const deliveryFee = money(config.deliveryFeeMinor, currency);
  const tip = money(config.tipMinor ?? 0, currency);

  // An empty cart costs nothing at all — not a delivery fee, not tax on
  // nothing. The screen should never show a total for zero dishes.
  if (subtotal.amountMinor === 0) {
    const zero = money(0, currency);
    return { subtotal: zero, tax: zero, serviceCharge: zero, deliveryFee: zero, tip, total: tip };
  }

  const rateBase = config.ratesIncludeDeliveryFee
    ? addMoney(subtotal, deliveryFee)
    : subtotal;

  const serviceCharge = applyRateBps(rateBase, config.serviceChargeBps);
  // Service charge is taxable in India, so tax applies to the base plus the
  // service charge — not to the subtotal alone.
  const tax = applyRateBps(addMoney(rateBase, serviceCharge), config.taxRateBps);

  const total = [deliveryFee, serviceCharge, tax, tip].reduce(addMoney, subtotal);

  return { subtotal, tax, serviceCharge, deliveryFee, tip, total };
}
