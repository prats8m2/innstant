import { describe, it, expect } from 'vitest';
import {
  money, formatMoney, addMoney, subtractMoney, sumMoney,
  multiplyMoney, applyRateBps, isZero, isNegative,
  parseMoneyInput, MoneyInputError,
} from './money';

const inr = (m: number) => money(m, 'INR');

describe('formatMoney', () => {
  // The four cases named in P0-TASKS S1.
  it('formats zero', () => {
    expect(formatMoney(inr(0))).toBe('₹0');
  });

  it('formats 100 minor units as ₹1', () => {
    expect(formatMoney(inr(100))).toBe('₹1');
  });

  it('formats 115000 minor units as ₹1,150 — Indian grouping, no decimals', () => {
    expect(formatMoney(inr(115_000))).toBe('₹1,150');
  });

  it('formats a negative with the sign outside the symbol', () => {
    expect(formatMoney(inr(-115_000))).toBe('-₹1,150');
  });

  it('uses Indian grouping (3 then 2s), not western grouping', () => {
    // ₹12,34,567 — a western formatter would give ₹1,234,567.
    expect(formatMoney(inr(123_456_700))).toBe('₹12,34,567');
  });

  it('shows decimals only when the amount is not whole', () => {
    expect(formatMoney(inr(115_050))).toBe('₹1,150.50');
    expect(formatMoney(inr(115_000), { showDecimals: true })).toBe('₹1,150.00');
  });

  it('formats every price from the seeded Kesari menu', () => {
    expect(formatMoney(inr(115_000))).toBe('₹1,150'); // laal maas
    expect(formatMoney(inr(62_000))).toBe('₹620');    // ker sangri
    expect(formatMoney(inr(18_000))).toBe('₹180');    // masala chai
    expect(formatMoney(inr(142_000))).toBe('₹1,420'); // river sole
  });
});

describe('money()', () => {
  it('rejects a fractional minor unit — that means a float leaked in', () => {
    expect(() => inr(115_000.5)).toThrow(TypeError);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts', () => {
    expect(addMoney(inr(115_000), inr(62_000)).amountMinor).toBe(177_000);
    expect(subtractMoney(inr(115_000), inr(62_000)).amountMinor).toBe(53_000);
  });

  it('sums an empty list to zero in the stated currency', () => {
    expect(sumMoney([], 'INR')).toEqual({ amountMinor: 0, currency: 'INR' });
  });

  it('sums a cart', () => {
    const cart = [inr(115_000), inr(62_000), inr(18_000)];
    expect(formatMoney(sumMoney(cart, 'INR'))).toBe('₹1,950');
  });

  it('multiplies by an integer quantity', () => {
    expect(formatMoney(multiplyMoney(inr(115_000), 3))).toBe('₹3,450');
    expect(multiplyMoney(inr(115_000), 0).amountMinor).toBe(0);
  });

  it('rejects a fractional quantity', () => {
    expect(() => multiplyMoney(inr(115_000), 1.5)).toThrow(RangeError);
  });

  it('rejects a negative quantity', () => {
    expect(() => multiplyMoney(inr(115_000), -1)).toThrow(RangeError);
  });
});

describe('applyRateBps', () => {
  it('applies GST at 18%', () => {
    expect(formatMoney(applyRateBps(inr(115_000), 1800))).toBe('₹207');
  });

  it('applies a fractional-percent rate exactly', () => {
    // 18.5% of ₹1,150 = ₹212.75
    expect(formatMoney(applyRateBps(inr(115_000), 1850))).toBe('₹212.75');
  });

  it('rounds half away from zero, in both directions', () => {
    // 1 bps of 5000 minor = 0.5 -> 1
    expect(applyRateBps(inr(5_000), 1).amountMinor).toBe(1);
    expect(applyRateBps(inr(-5_000), 1).amountMinor).toBe(-1);
  });

  it('never returns a fractional minor unit', () => {
    for (const amount of [1, 7, 999, 115_000, 8_940_00]) {
      for (const bps of [1, 250, 1800, 1850, 9999]) {
        const out = applyRateBps(inr(amount), bps);
        expect(Number.isInteger(out.amountMinor)).toBe(true);
      }
    }
  });
});

describe('currency safety', () => {
  it('refuses to add across currencies', () => {
    const usd = { amountMinor: 100, currency: 'USD' } as unknown as ReturnType<typeof inr>;
    expect(() => addMoney(inr(100), usd)).toThrow(TypeError);
  });
});

describe('predicates', () => {
  it('reports zero and negative', () => {
    expect(isZero(inr(0))).toBe(true);
    expect(isZero(inr(1))).toBe(false);
    expect(isNegative(inr(-1))).toBe(true);
    expect(isNegative(inr(0))).toBe(false);
  });
});

describe('parseMoneyInput', () => {
  const inr = (text: string) => parseMoneyInput(text, 'INR');

  it('reads what an F&B manager actually types', () => {
    expect(inr('1150').amountMinor).toBe(115000);
    expect(inr('1,150').amountMinor).toBe(115000);
    expect(inr('₹1,150').amountMinor).toBe(115000);
    expect(inr('  1150  ').amountMinor).toBe(115000);
    expect(inr('0').amountMinor).toBe(0);
  });

  it('treats decimals as digits, not as a multiplication', () => {
    // Number('11.50') * 100 is 1149.9999999999998. This is the whole reason
    // the parser exists rather than a one-line coercion.
    expect(inr('11.50').amountMinor).toBe(1150);
    expect(inr('11.5').amountMinor).toBe(1150);
    expect(inr('11.05').amountMinor).toBe(1105);
    expect(inr('1150.99').amountMinor).toBe(115099);
  });

  it('refuses what it cannot be sure about', () => {
    for (const bad of ['', '  ', 'free', '11.505', '-50', '1e3', '11..5', '₹', '1 150']) {
      expect(() => inr(bad), bad).toThrow(MoneyInputError);
    }
  });

  it('round-trips through formatMoney', () => {
    for (const text of ['1150', '11.50', '0', '99999']) {
      const parsed = inr(text);
      expect(inr(formatMoney(parsed, { showDecimals: true }).replace('₹', '')).amountMinor)
        .toBe(parsed.amountMinor);
    }
  });
});
