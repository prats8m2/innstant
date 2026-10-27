import { describe, expect, it } from 'vitest';
import { adjustPrice } from './price-adjust';

describe('adjustPrice', () => {
  it('raises by a percentage and rounds to the printed step', () => {
    // ₹1,150 + 5% = ₹1,207.50 → ₹1,210 to the nearest ₹10.
    expect(adjustPrice(115_000, 500, 1_000)).toBe(121_000);
    // To the nearest ₹1: ₹1,207.50 → ₹1,208 (halves round up).
    expect(adjustPrice(115_000, 500, 100)).toBe(120_800);
    // Paise left alone.
    expect(adjustPrice(115_000, 500, 1)).toBe(120_750);
  });

  it('lowers by a percentage', () => {
    // ₹620 − 10% = ₹558 → ₹560.
    expect(adjustPrice(62_000, -1_000, 1_000)).toBe(56_000);
  });

  it('never prices a dish at nothing, and keeps a free one free', () => {
    expect(adjustPrice(500, -9_000, 1_000)).toBe(1_000);
    expect(adjustPrice(0, 500, 1_000)).toBe(0);
  });

  it('refuses a change nobody means', () => {
    expect(() => adjustPrice(115_000, -9_500, 1_000)).toThrow(RangeError);
    expect(() => adjustPrice(115_000, 10_500, 1_000)).toThrow(RangeError);
    expect(() => adjustPrice(115_000, 500, 0)).toThrow(RangeError);
  });
});
