import { describe, expect, it } from 'vitest';
import { formatMoney } from '@/lib/money';
import { calculateTotals, lineTotal, type TotalsConfig } from './totals';

/**
 * Money calculations get unit tests, every branch (CLAUDE.md "Tests"). These
 * are the numbers a guest checks against their folio.
 */
const KESARI: TotalsConfig = {
  currency: 'INR',
  taxRateBps: 500,          // 5% GST on restaurant service
  serviceChargeBps: 1_000,  // 10%
  deliveryFeeMinor: 0,
};

describe('lineTotal', () => {
  it('prices modifiers into the line before quantity', () => {
    // Two laal maas with an extra bajra roti each: (1150 + 90) x 2.
    const total = lineTotal(
      { unitPriceMinor: 115_000, modifiersMinor: 9_000, quantity: 2 },
      'INR',
    );
    expect(total.amountMinor).toBe(248_000);
    expect(formatMoney(total)).toBe('₹2,480');
  });

  it('accepts a negative modifier — a modifier may reduce the price', () => {
    const total = lineTotal({ unitPriceMinor: 10_000, modifiersMinor: -2_000, quantity: 1 }, 'INR');
    expect(total.amountMinor).toBe(8_000);
  });

  it('refuses a fractional quantity', () => {
    expect(() => lineTotal({ unitPriceMinor: 100, modifiersMinor: 0, quantity: 1.5 }, 'INR'))
      .toThrow(RangeError);
  });
});

describe('calculateTotals', () => {
  it('applies rates to the subtotal once, not per line', () => {
    // Three lines that would each round differently if taxed separately.
    const lines = [
      { unitPriceMinor: 33_300, modifiersMinor: 0, quantity: 1 },
      { unitPriceMinor: 33_300, modifiersMinor: 0, quantity: 1 },
      { unitPriceMinor: 33_300, modifiersMinor: 0, quantity: 1 },
    ];
    const t = calculateTotals(lines, KESARI);

    expect(t.subtotal.amountMinor).toBe(99_900);
    expect(t.serviceCharge.amountMinor).toBe(9_990);           // 10% of 99,900
    expect(t.tax.amountMinor).toBe(5_495);                     // 5% of 109,890
    expect(t.total.amountMinor).toBe(99_900 + 9_990 + 5_495);
  });

  it('taxes the service charge, because India does', () => {
    const t = calculateTotals([{ unitPriceMinor: 100_000, modifiersMinor: 0, quantity: 1 }], KESARI);
    expect(t.serviceCharge.amountMinor).toBe(10_000);
    // 5% of (100,000 + 10,000), not 5% of 100,000.
    expect(t.tax.amountMinor).toBe(5_500);
  });

  it('charges the delivery fee once per order, not per line', () => {
    const config = { ...KESARI, deliveryFeeMinor: 5_000 };
    const one = calculateTotals([{ unitPriceMinor: 50_000, modifiersMinor: 0, quantity: 1 }], config);
    const four = calculateTotals(
      [{ unitPriceMinor: 50_000, modifiersMinor: 0, quantity: 4 }],
      config,
    );
    expect(one.deliveryFee.amountMinor).toBe(5_000);
    expect(four.deliveryFee.amountMinor).toBe(5_000);
  });

  it('keeps the delivery fee out of the rate base unless told otherwise', () => {
    const lines = [{ unitPriceMinor: 100_000, modifiersMinor: 0, quantity: 1 }];
    const excluded = calculateTotals(lines, { ...KESARI, deliveryFeeMinor: 10_000 });
    const included = calculateTotals(lines, {
      ...KESARI, deliveryFeeMinor: 10_000, ratesIncludeDeliveryFee: true,
    });

    expect(excluded.serviceCharge.amountMinor).toBe(10_000);   // 10% of 100,000
    expect(included.serviceCharge.amountMinor).toBe(11_000);   // 10% of 110,000
  });

  it('never taxes the tip', () => {
    const lines = [{ unitPriceMinor: 100_000, modifiersMinor: 0, quantity: 1 }];
    const without = calculateTotals(lines, KESARI);
    const with20 = calculateTotals(lines, { ...KESARI, tipMinor: 20_000 });

    expect(with20.tax.amountMinor).toBe(without.tax.amountMinor);
    expect(with20.serviceCharge.amountMinor).toBe(without.serviceCharge.amountMinor);
    expect(with20.total.amountMinor).toBe(without.total.amountMinor + 20_000);
  });

  it('costs nothing at all when the cart is empty', () => {
    // Not "a delivery fee and tax on nothing" — which is what falls out if the
    // zero case is left to the arithmetic.
    const t = calculateTotals([], { ...KESARI, deliveryFeeMinor: 9_900 });
    expect(t.subtotal.amountMinor).toBe(0);
    expect(t.deliveryFee.amountMinor).toBe(0);
    expect(t.total.amountMinor).toBe(0);
  });

  it('rounds half away from zero, in one place', () => {
    // 1 paisa at 5% is 0.05 → 0; 10 paise at 5% is 0.5 → 1.
    expect(calculateTotals(
      [{ unitPriceMinor: 10, modifiersMinor: 0, quantity: 1 }],
      { currency: 'INR', taxRateBps: 500, serviceChargeBps: 0, deliveryFeeMinor: 0 },
    ).tax.amountMinor).toBe(1);
  });

  it('formats with Indian grouping and no stray decimals', () => {
    const t = calculateTotals(
      [{ unitPriceMinor: 115_000, modifiersMinor: 0, quantity: 2 }],
      KESARI,
    );
    expect(formatMoney(t.subtotal)).toBe('₹2,300');
    expect(formatMoney(t.total)).toBe('₹2,656.50');
  });
});
