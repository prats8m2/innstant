import { describe, it, expect } from 'vitest';
import { normalisePhone, isDialable, formatPhone } from '@/lib/phone';

/**
 * One human number must always produce one string. D-081.
 *
 * `guests` is unique on (tenant_id, phone), so a number that normalises three
 * ways is three accounts and three order histories for one person. And the OTP
 * rate limit is keyed on the normalised form, so a number that normalises three
 * ways is also three separate buckets of five attempts each — an attacker who
 * wants more tries just adds a space.
 */
describe('normalisePhone', () => {
  it.each([
    ['+91 98290 11111', '+919829011111'],
    ['+919829011111',   '+919829011111'],
    ['9829011111',      '+919829011111'],
    ['098290 11111',    '+919829011111'],
    ['0091 98290 11111','+919829011111'],
    ['+91-98290-11111', '+919829011111'],
    ['  9829011111  ',  '+919829011111'],
    ['(98290) 11111',   '+919829011111'],
  ])('%s → %s', (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it('collapses every spelling of one number to one bucket', () => {
    const spellings = ['+91 98290 11111', '9829011111', '098290-11111', '+919829011111'];
    expect(new Set(spellings.map(normalisePhone)).size).toBe(1);
  });

  /**
   * The leading digit is what distinguishes an Indian mobile from a landline
   * or a short code. Promoting one of those to +91 would create an account
   * nobody can receive an SMS for.
   */
  it('does not promote a non-mobile to +91', () => {
    expect(normalisePhone('1800123456')).toBe('1800123456');
    expect(normalisePhone('2212345678')).toBe('2212345678');
  });

  /** A property outside India must still be able to take an order. */
  it('leaves a foreign number alone rather than guessing', () => {
    expect(normalisePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalisePhone('+1 (415) 555-2671')).toBe('+14155552671');
  });
});

describe('isDialable', () => {
  it('accepts what can be texted and rejects what cannot', () => {
    expect(isDialable('+919829011111')).toBe(true);
    expect(isDialable('+442079460958')).toBe(true);
    expect(isDialable('12345')).toBe(false);
    expect(isDialable('')).toBe(false);
    expect(isDialable('+1234567890123456')).toBe(false);
  });
});

describe('formatPhone', () => {
  it('groups an Indian number for a screen and leaves others whole', () => {
    expect(formatPhone('+919829011111')).toBe('+91 98290 11111');
    expect(formatPhone('+442079460958')).toBe('+442079460958');
  });
});
