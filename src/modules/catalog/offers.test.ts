import { describe, expect, it } from 'vitest';
import { bestOffer, discountFor, offerLabel, type MenuOffer } from './offers';

// Wednesday 28 October 2026, 20:00.
const AT = { dayOfWeek: 3, minutes: 20 * 60, date: '2026-10-28' };
const laal = { id: 'laal', categoryId: 'mains', priceMinor: 115_000, currency: 'INR' };

let n = 0;
const offer = (patch: Partial<MenuOffer>): MenuOffer => ({
  id: `o${++n}`,
  name: 'An offer',
  scope: 'MENU',
  menuItemId: null,
  categoryId: null,
  kind: 'PERCENT',
  percentBps: 1000,
  amountMinor: null,
  currency: 'INR',
  availableFrom: null,
  availableUntil: null,
  daysOfWeek: null,
  startsOn: null,
  endsOn: null,
  isActive: true,
  createdAt: new Date(2026, 0, n),
  ...patch,
});

describe('discountFor', () => {
  it('takes a percentage off, rounded once, half away from zero', () => {
    expect(discountFor({ kind: 'PERCENT', percentBps: 2000, amountMinor: null }, 115_000)).toBe(23_000);
    // 12.5% of ₹3.33 is 41.625 paise: 42.
    expect(discountFor({ kind: 'PERCENT', percentBps: 1250, amountMinor: null }, 333)).toBe(42);
  });

  it('never takes more than the price', () => {
    expect(discountFor({ kind: 'AMOUNT', percentBps: null, amountMinor: 50_000 }, 18_000)).toBe(18_000);
    expect(discountFor({ kind: 'PERCENT', percentBps: 10_000, amountMinor: null }, 18_000)).toBe(18_000);
  });
});

describe('bestOffer', () => {
  it('applies one that is live, and says what it was', () => {
    const applied = bestOffer([offer({ name: 'Happy hour', percentBps: 2000 })], laal, AT);
    expect(applied).toEqual({
      offerId: expect.any(String), name: 'Happy hour', label: '20% off',
      listPriceMinor: 115_000, priceMinor: 92_000,
    });
  });

  it('never stacks: the biggest single discount wins', () => {
    const applied = bestOffer([
      offer({ name: '10% everything', percentBps: 1000 }),
      offer({ name: '₹300 off mains', scope: 'CATEGORY', categoryId: 'mains', kind: 'AMOUNT', percentBps: null, amountMinor: 30_000 }),
      offer({ name: '20% laal maas', scope: 'DISH', menuItemId: 'laal', percentBps: 2000 }),
    ], laal, AT);
    expect(applied!.name).toBe('₹300 off mains');
    expect(applied!.priceMinor).toBe(85_000);
  });

  it('on a tie, the more specific offer wins', () => {
    const applied = bestOffer([
      offer({ name: 'Menu 20%', percentBps: 2000 }),
      offer({ name: 'Dish 20%', scope: 'DISH', menuItemId: 'laal', percentBps: 2000 }),
    ], laal, AT);
    expect(applied!.name).toBe('Dish 20%');
  });

  it('ignores offers aimed elsewhere, switched off, or not live now', () => {
    expect(bestOffer([
      offer({ scope: 'DISH', menuItemId: 'kachori' }),
      offer({ scope: 'CATEGORY', categoryId: 'sweets' }),
      offer({ isActive: false }),
      offer({ availableFrom: '15:00', availableUntil: '18:00' }),
      offer({ daysOfWeek: [0, 6] }),
      offer({ startsOn: '2026-11-01', endsOn: '2026-11-05' }),
    ], laal, AT)).toBeNull();
  });

  it('runs a happy hour on its own clock', () => {
    const happyHour = offer({ availableFrom: '15:00', availableUntil: '18:00', percentBps: 2500 });
    expect(bestOffer([happyHour], laal, { ...AT, minutes: 16 * 60 })!.priceMinor).toBe(86_250);
    expect(bestOffer([happyHour], laal, { ...AT, minutes: 18 * 60 })).toBeNull();
  });

  it('does not convert an amount in another currency', () => {
    expect(bestOffer([offer({ kind: 'AMOUNT', percentBps: null, amountMinor: 1000, currency: 'USD' })], laal, AT))
      .toBeNull();
  });
});

describe('offerLabel', () => {
  it('reads as the guest would say it', () => {
    expect(offerLabel({ kind: 'PERCENT', percentBps: 2000, amountMinor: null, currency: 'INR' })).toBe('20% off');
    expect(offerLabel({ kind: 'PERCENT', percentBps: 1250, amountMinor: null, currency: 'INR' })).toBe('12.5% off');
    expect(offerLabel({ kind: 'AMOUNT', percentBps: null, amountMinor: 10_000, currency: 'INR' })).toBe('₹100 off');
  });
});
