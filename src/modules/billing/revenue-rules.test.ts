import { describe, expect, it } from 'vitest';
import {
  addToParts, emptyParts, folioRevenueMinor, revenuePartOf, type RevenueLine,
} from './revenue-rules';

const line = (over: Partial<RevenueLine>): RevenueLine => ({
  source: 'MANUAL', category: null, target: null, reverses: null, ...over,
});

describe('which part of revenue a folio line is', () => {
  it('puts a room charge and the tax on it in rooms', () => {
    expect(revenuePartOf(line({ category: 'ROOM' }))).toBe('rooms');
    expect(revenuePartOf(line({
      category: 'TAX', target: { source: 'MANUAL', category: 'ROOM', targetCategory: null },
    }))).toBe('rooms');
  });

  it('puts amenities, late checkout and every other desk charge (and its tax) in services', () => {
    expect(revenuePartOf(line({ source: 'SERVICE_REQUEST' }))).toBe('services');
    expect(revenuePartOf(line({ source: 'CHECKOUT_FEE' }))).toBe('services');
    expect(revenuePartOf(line({ category: 'MINIBAR' }))).toBe('services');
    expect(revenuePartOf(line({
      category: 'TAX', target: { source: 'MANUAL', category: 'LAUNDRY', targetCategory: null },
    }))).toBe('services');
  });

  it('skips payments and order charges — food comes from the orders themselves', () => {
    expect(revenuePartOf(line({ source: 'PAYMENT' }))).toBeNull();
    expect(revenuePartOf(line({ source: 'ORDER' }))).toBeNull();
  });

  it('files a correction with the line it corrects', () => {
    expect(revenuePartOf(line({
      source: 'ADJUSTMENT', target: { source: 'MANUAL', category: 'ROOM', targetCategory: null },
    }))).toBe('rooms');
    // A discount on the tax line of a room charge is still rooms.
    expect(revenuePartOf(line({
      source: 'ADJUSTMENT', target: { source: 'MANUAL', category: 'TAX', targetCategory: 'ROOM' },
    }))).toBe('rooms');
    expect(revenuePartOf(line({
      source: 'ADJUSTMENT', target: { source: 'ORDER', category: null, targetCategory: null },
    }))).toBe('foodCorrections');
  });

  it('does not take a rejected order off twice, but does take off a reversed request', () => {
    expect(revenuePartOf(line({ source: 'ADJUSTMENT', reverses: 'ORDER' }))).toBeNull();
    expect(revenuePartOf(line({ source: 'ADJUSTMENT', reverses: 'SERVICE_REQUEST' }))).toBe('services');
  });

  it('keeps a whole-bill discount as a credit', () => {
    expect(revenuePartOf(line({ source: 'ADJUSTMENT' }))).toBe('credits');
  });

  it('sums a folio into its parts, in minor units', () => {
    const parts = emptyParts();
    addToParts(parts, line({ category: 'ROOM' }), 1_800_000);
    addToParts(parts, line({ category: 'TAX', target: { source: 'MANUAL', category: 'ROOM', targetCategory: null } }), 216_000);
    addToParts(parts, line({ source: 'SERVICE_REQUEST' }), 35_000);
    addToParts(parts, line({ source: 'ADJUSTMENT', target: { source: 'ORDER', category: null, targetCategory: null } }), -20_000);
    addToParts(parts, line({ source: 'ADJUSTMENT' }), -50_000);
    addToParts(parts, line({ source: 'PAYMENT' }), 999_999);
    expect(parts).toEqual({
      roomsMinor: 2_016_000, servicesMinor: 35_000, foodCorrectionsMinor: -20_000, creditsMinor: -50_000,
    });
    expect(folioRevenueMinor(parts)).toBe(1_981_000);
  });
});
