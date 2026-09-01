import { describe, it, expect } from 'vitest';
import {
  checkRequestTypeRules, deriveRequestTypeFields, requestTypeKeyFrom, uniqueRequestTypeKey,
  SLA_MINUTES_MAX, MAX_QUANTITY_CEILING,
} from './type-rules';

/**
 * The rules a property may not edit its way around.
 *
 * Two of these are CLAUDE.md non-negotiables wearing a form control, and they
 * are the reason this file exists rather than the checks living inside an
 * UPDATE: #9 (a free service call must not grow a verification prompt) and the
 * derived `isChargeable`, which is the same "one number, not two" discipline
 * `slaMinutes` already follows.
 */
const base = {
  key: 'EXTRA_TOWELS',
  category: 'AMENITY',
  priceMinor: 0,
  slaMinutes: 12,
  allowsQuantity: true,
  maxQuantity: 4,
};

describe('what a property may configure', () => {
  it('accepts the shape the seeder writes', () => {
    expect(checkRequestTypeRules(base)).toBeNull();
  });

  /* ── #9 ──────────────────────────────────────────────────────────────── */

  /**
   * `raiseServiceRequest()` demands the CHARGE tier as soon as a request totals
   * more than zero. A price on the one tap is therefore a verification prompt
   * in front of "someone comes up", which is the exact screen #9 keeps out.
   */
  it('refuses to put a price on the one-tap service call', () => {
    const violation = checkRequestTypeRules({
      ...base, key: 'CALL_SERVICE', priceMinor: 100,
    });
    expect(violation?.field).toBe('priceMinor');
    expect(violation?.message).toMatch(/stay free/i);
    // And says what to do instead, rather than only refusing.
    expect(violation?.message).toMatch(/separate type/i);
  });

  it('still lets the one tap be edited in every other way', () => {
    expect(checkRequestTypeRules({
      ...base, key: 'CALL_SERVICE', priceMinor: 0, slaMinutes: 5, allowsQuantity: false, maxQuantity: 1,
    })).toBeNull();
  });

  it('lets anything else carry a price', () => {
    expect(checkRequestTypeRules({ ...base, key: 'LAUNDRY', priceMinor: 45_000 })).toBeNull();
  });

  /* ── The SLA window ──────────────────────────────────────────────────── */

  /**
   * Zero is the interesting one: the sweep escalates anything past its target,
   * so a zero-minute promise breaches on the way to the board and fills the duty
   * manager's bell with requests nobody could have reached in time.
   */
  it('refuses a promise of no time at all', () => {
    expect(checkRequestTypeRules({ ...base, slaMinutes: 0 })?.field).toBe('slaMinutes');
  });

  it('refuses a promise longer than a shift', () => {
    expect(checkRequestTypeRules({ ...base, slaMinutes: SLA_MINUTES_MAX + 1 })?.field)
      .toBe('slaMinutes');
    expect(checkRequestTypeRules({ ...base, slaMinutes: SLA_MINUTES_MAX })).toBeNull();
  });

  it('refuses a fraction of a minute', () => {
    expect(checkRequestTypeRules({ ...base, slaMinutes: 12.5 })?.field).toBe('slaMinutes');
  });

  /* ── Money and quantity ──────────────────────────────────────────────── */

  it('refuses a negative price, and says what blank means', () => {
    const violation = checkRequestTypeRules({ ...base, priceMinor: -1 });
    expect(violation?.field).toBe('priceMinor');
    expect(violation?.message).toMatch(/blank for free/i);
  });

  it('refuses a stepper that cannot step', () => {
    expect(checkRequestTypeRules({ ...base, allowsQuantity: true, maxQuantity: 1 })?.field)
      .toBe('maxQuantity');
  });

  it('ignores the maximum entirely when there is no stepper', () => {
    expect(checkRequestTypeRules({ ...base, allowsQuantity: false, maxQuantity: 1 })).toBeNull();
    expect(checkRequestTypeRules({ ...base, allowsQuantity: false, maxQuantity: 99 })).toBeNull();
  });

  it('caps how many of one thing a guest may ask for', () => {
    expect(checkRequestTypeRules({
      ...base, allowsQuantity: true, maxQuantity: MAX_QUANTITY_CEILING + 1,
    })?.field).toBe('maxQuantity');
  });

  it('refuses a category the guest screens do not group by', () => {
    expect(checkRequestTypeRules({ ...base, category: 'CONCIERGE' })?.field).toBe('category');
  });
});

describe('the two fields a property does not set directly', () => {
  /**
   * The guest's amenities screen prints "Free" or the amount from
   * `isChargeable`, and the verification prompt is decided by the TOTAL. Let the
   * two disagree and a screen says Free above a request that charges the room.
   */
  it('makes isChargeable follow the price, in both directions', () => {
    expect(deriveRequestTypeFields({ priceMinor: 0, allowsQuantity: false, maxQuantity: 1 }))
      .toEqual({ isChargeable: false, maxQuantity: 1 });
    expect(deriveRequestTypeFields({ priceMinor: 1, allowsQuantity: false, maxQuantity: 1 })
      .isChargeable).toBe(true);
  });

  it('collapses the maximum to one when there is no stepper', () => {
    // So turning quantity back on later cannot inherit a 6 somebody abandoned.
    expect(deriveRequestTypeFields({ priceMinor: 0, allowsQuantity: false, maxQuantity: 6 })
      .maxQuantity).toBe(1);
    expect(deriveRequestTypeFields({ priceMinor: 0, allowsQuantity: true, maxQuantity: 6 })
      .maxQuantity).toBe(6);
  });
});

describe('minting a key from a name', () => {
  it('is the shape the seeder uses', () => {
    expect(requestTypeKeyFrom('Extra towels')).toBe('EXTRA_TOWELS');
    expect(requestTypeKeyFrom('Iron and board')).toBe('IRON_AND_BOARD');
  });

  it('folds punctuation and runs of spaces into single underscores', () => {
    expect(requestTypeKeyFrom('  Wi-Fi   trouble!! ')).toBe('WI_FI_TROUBLE');
  });

  it('keeps the letters out of an accent', () => {
    expect(requestTypeKeyFrom('Café table')).toBe('CAFE_TABLE');
  });

  it('gives up rather than minting an empty key', () => {
    expect(requestTypeKeyFrom('!!!')).toBeNull();
    expect(requestTypeKeyFrom('   ')).toBeNull();
  });

  it('never ends in an underscore, however it was truncated', () => {
    const key = requestTypeKeyFrom('a'.repeat(47) + ' something')!;
    expect(key.endsWith('_')).toBe(false);
    expect(key.length).toBeLessThanOrEqual(48);
  });

  it('numbers a duplicate rather than colliding', () => {
    const taken = new Set(['EXTRA_TOWELS']);
    expect(uniqueRequestTypeKey('EXTRA_TOWELS', taken)).toBe('EXTRA_TOWELS_2');
    taken.add('EXTRA_TOWELS_2');
    expect(uniqueRequestTypeKey('EXTRA_TOWELS', taken)).toBe('EXTRA_TOWELS_3');
  });

  it('leaves a free key alone', () => {
    expect(uniqueRequestTypeKey('TURNDOWN', new Set(['EXTRA_TOWELS']))).toBe('TURNDOWN');
  });
});
