import { describe, it, expect } from 'vitest';
import { canQuickAdd, defaultOptionIds } from './quick-add-rules';
import type { DishModifierGroup } from '@/modules/catalog';

const option = (id: string, over: Partial<DishModifierGroup['options'][number]> = {}) => ({
  id, name: id, priceDeltaMinor: 0, currency: 'INR',
  isDefault: false, isAvailable: true, ...over,
});

const group = (over: Partial<DishModifierGroup>): DishModifierGroup => ({
  id: 'g', name: 'g', isRequired: false, minSelections: 0, maxSelections: 1,
  options: [], ...over,
});

/** The Kesari's own shape: one required group with a default, one optional. */
const CHILLI = group({
  id: 'chilli', name: 'Chilli', isRequired: true, minSelections: 1, maxSelections: 1,
  options: [
    option('gentle'),
    option('as-the-chef-makes-it', { isDefault: true }),
    option('fiery'),
  ],
});

const EXTRAS = group({
  id: 'add', name: 'Add', isRequired: false, minSelections: 0, maxSelections: 1,
  options: [option('nothing', { isDefault: true }), option('ghee')],
});

describe('defaultOptionIds', () => {
  /**
   * This must match what the DISH PAGE sends when a guest opens it and presses
   * add without touching anything — which is every `isDefault` option across
   * ALL groups, the no-op "Nothing" included.
   *
   * Drop the no-op and the same dish ordered the same way lands as two
   * separate cart lines, because `findIdenticalLine()` compares option sets
   * and a set differing by one id is a different line. That is the bug this
   * test exists for.
   */
  it('takes every default, across required and optional groups alike', () => {
    expect(defaultOptionIds([CHILLI, EXTRAS]))
      .toEqual(['as-the-chef-makes-it', 'nothing']);
  });

  it('skips a default that is currently unavailable', () => {
    const offTonight = group({
      isRequired: true, minSelections: 1, maxSelections: 1,
      options: [option('warm', { isDefault: true, isAvailable: false }), option('cold')],
    });
    expect(defaultOptionIds([offTonight])).toEqual([]);
  });

  it('returns nothing for a dish with no modifiers', () => {
    expect(defaultOptionIds([])).toEqual([]);
  });
});

describe('canQuickAdd', () => {
  it('allows a dish whose required choice has a default', () => {
    expect(canQuickAdd([CHILLI, EXTRAS])).toBe(true);
  });

  it('allows a dish with no modifiers at all', () => {
    expect(canQuickAdd([])).toBe(true);
  });

  it('ignores optional groups entirely — there is nothing to answer', () => {
    const noDefault = group({ isRequired: false, options: [option('a'), option('b')] });
    expect(canQuickAdd([noDefault])).toBe(true);
  });

  /**
   * The case the whole flag exists for: a property that asks "rare, medium or
   * well done" and takes no view. There is no honest answer to pick on the
   * guest's behalf, so the card must send them into the dish.
   */
  it('refuses a required choice with no default', () => {
    const doneness = group({
      isRequired: true, minSelections: 1, maxSelections: 1,
      options: [option('rare'), option('medium'), option('well')],
    });
    expect(canQuickAdd([doneness])).toBe(false);
  });

  it('refuses when the only default has gone unavailable', () => {
    const offTonight = group({
      isRequired: true, minSelections: 1, maxSelections: 1,
      options: [option('warm', { isDefault: true, isAvailable: false }), option('cold')],
    });
    expect(canQuickAdd([offTonight])).toBe(false);
  });

  /** Defaults that contradict the group: two, where only one may be chosen. */
  it('refuses when the defaults exceed what the group allows', () => {
    const tooMany = group({
      isRequired: true, minSelections: 1, maxSelections: 1,
      options: [option('a', { isDefault: true }), option('b', { isDefault: true })],
    });
    expect(canQuickAdd([tooMany])).toBe(false);
  });

  it('refuses when a group needs two and only one is defaulted', () => {
    const needsTwo = group({
      isRequired: true, minSelections: 2, maxSelections: 3,
      options: [option('a', { isDefault: true }), option('b'), option('c')],
    });
    expect(canQuickAdd([needsTwo])).toBe(false);
  });

  it('is false if ANY required group cannot be answered', () => {
    const doneness = group({
      id: 'doneness', isRequired: true, minSelections: 1, maxSelections: 1,
      options: [option('rare'), option('medium')],
    });
    expect(canQuickAdd([CHILLI, doneness])).toBe(false);
  });
});
