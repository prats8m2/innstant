/**
 * Money. CLAUDE.md #5 — integer minor units, explicit currency, never a float.
 *
 * Every amount in the system is an integer count of the currency's minor unit
 * (paise for INR) carried alongside an explicit currency code. There is no
 * representation of money in this codebase that is a `number` of rupees, a
 * decimal string, or a value whose currency is implied by context.
 */

export type CurrencyCode = 'INR';

export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

interface CurrencyMeta {
  readonly symbol: string;
  readonly minorUnits: number;
  /** Indian grouping is 3 then 2s (12,34,567) — not the western 3s. */
  readonly locale: string;
}

const CURRENCIES: Record<CurrencyCode, CurrencyMeta> = {
  INR: { symbol: '₹', minorUnits: 2, locale: 'en-IN' },
};

export function money(amountMinor: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new TypeError(
      `Money must be integer minor units, received ${amountMinor}. ` +
        'A fractional minor unit means a float leaked into a money path.',
    );
  }
  return { amountMinor, currency };
}

function metaFor(currency: CurrencyCode): CurrencyMeta {
  const meta = CURRENCIES[currency];
  if (!meta) throw new RangeError(`Unsupported currency: ${currency}`);
  return meta;
}

/**
 * Format for display. `₹1,150` — Indian digit grouping, symbol attached, and
 * no decimals when the amount is whole. Never `₹1150`, never `₹1.15k`.
 *
 * Render with `font-variant-numeric: tabular-nums` (the `tabular` utility) so
 * columns of figures align. A folio that jitters as digits change reads as
 * untrustworthy, and this is money.
 */
export function formatMoney(
  value: Money,
  opts: { showDecimals?: boolean } = {},
): string {
  const meta = metaFor(value.currency);
  const major = value.amountMinor / 10 ** meta.minorUnits;
  const isWhole = value.amountMinor % 10 ** meta.minorUnits === 0;
  const showDecimals = opts.showDecimals ?? !isWhole;
  const digits = showDecimals ? meta.minorUnits : 0;

  const formatted = new Intl.NumberFormat(meta.locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(major));

  // Sign goes outside the symbol: -₹500, not ₹-500.
  return `${major < 0 ? '-' : ''}${meta.symbol}${formatted}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(
      `Cannot combine ${a.currency} with ${b.currency}. ` +
        'Cross-currency arithmetic must go through an explicit conversion.',
    );
  }
}

/**
 * The other direction: what a human typed, into minor units.
 *
 * This is the only place a price enters the system from a keyboard, and it is
 * where #5 is most easily broken — `Number('11.50') * 100` is 1149.9999999999998,
 * and rounding it quietly is how a menu ends up a paisa out for a year. So the
 * decimals are parsed as INTEGER digits and never multiplied.
 *
 * Accepts what an F&B manager actually types: `1150`, `1,150`, `₹1,150`,
 * `1150.50`, ` 1150 `. Rejects everything else rather than guessing, including
 * more decimal places than the currency has and a negative price — a menu item
 * that pays the guest is a typo, not a promotion.
 */
export class MoneyInputError extends Error {}

export function parseMoneyInput(input: string, currency: CurrencyCode): Money {
  const meta = metaFor(currency);
  const cleaned = input.trim().replace(meta.symbol, '').replace(/,/g, '').trim();

  if (!cleaned) throw new MoneyInputError('Enter a price.');

  const match = /^(\d+)(?:\.(\d+))?$/.exec(cleaned);
  if (!match) {
    throw new MoneyInputError('A price is digits, with up to two decimals — like 1150 or 1150.50.');
  }

  const [, whole, decimals = ''] = match;
  if (decimals.length > meta.minorUnits) {
    throw new MoneyInputError(`${currency} has ${meta.minorUnits} decimal places, no more.`);
  }

  // Pad rather than multiply: '5' means 50 paise, not 5.
  const minor = decimals.padEnd(meta.minorUnits, '0');
  const amountMinor = Number(whole) * 10 ** meta.minorUnits + Number(minor || 0);

  if (!Number.isSafeInteger(amountMinor)) {
    throw new MoneyInputError('That price is too large.');
  }

  return money(amountMinor, currency);
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}

export function sumMoney(values: readonly Money[], currency: CurrencyCode): Money {
  return values.reduce((acc, v) => addMoney(acc, v), money(0, currency));
}

/**
 * Multiply by a quantity. Quantity must be a non-negative integer — three
 * dishes, not 3.5 dishes. Kept separate from percentage maths on purpose:
 * this operation cannot produce a rounding decision.
 */
export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError(`Quantity must be a non-negative integer, got ${quantity}`);
  }
  return money(value.amountMinor * quantity, value.currency);
}

/**
 * Apply a rate (tax, service charge, tip percentage) expressed in basis points.
 * 1850 bps = 18.5%. Basis points keep the rate itself an integer, so the only
 * rounding in the system happens here, in one place, explicitly.
 *
 * Rounds half away from zero — the conventional choice for tax lines, and it
 * does not drift toward the house the way half-even does on small amounts.
 */
export function applyRateBps(value: Money, rateBps: number): Money {
  if (!Number.isInteger(rateBps)) {
    throw new TypeError(`Rate must be integer basis points, got ${rateBps}`);
  }
  const raw = (value.amountMinor * rateBps) / 10_000;
  const rounded = Math.sign(raw) * Math.round(Math.abs(raw));
  return money(rounded, value.currency);
}

export function isZero(value: Money): boolean {
  return value.amountMinor === 0;
}

export function isNegative(value: Money): boolean {
  return value.amountMinor < 0;
}
