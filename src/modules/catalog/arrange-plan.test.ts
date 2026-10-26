import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '@/lib/errors';
import { planArrangement } from './arrange-plan';

// Two sections, as the board would have loaded them.
const current = {
  categories: [
    { id: 'mains', sortOrder: 0 },
    { id: 'sweets', sortOrder: 1 },
  ],
  items: [
    { id: 'laal-maas', categoryId: 'mains', sortOrder: 0 },
    { id: 'gatte', categoryId: 'mains', sortOrder: 1 },
    { id: 'kachori', categoryId: 'sweets', sortOrder: 0 },
  ],
};

const asLoaded = [
  { categoryId: 'mains', itemIds: ['laal-maas', 'gatte'] },
  { categoryId: 'sweets', itemIds: ['kachori'] },
];

describe('planArrangement', () => {
  it('writes nothing for the arrangement already on the menu', () => {
    expect(planArrangement(current, asLoaded)).toEqual({ categories: [], items: [] });
  });

  it('swaps two sections and touches no dish', () => {
    const plan = planArrangement(current, [asLoaded[1]!, asLoaded[0]!]);
    expect(plan.categories).toEqual([
      { id: 'sweets', sortOrder: 0 },
      { id: 'mains', sortOrder: 1 },
    ]);
    expect(plan.items).toEqual([]);
  });

  it('reorders within a section without calling it a move', () => {
    const plan = planArrangement(current, [
      { categoryId: 'mains', itemIds: ['gatte', 'laal-maas'] },
      asLoaded[1]!,
    ]);
    expect(plan.items).toEqual([
      { id: 'gatte', categoryId: 'mains', sortOrder: 0 },
      { id: 'laal-maas', categoryId: 'mains', sortOrder: 1 },
    ]);
    expect(plan.items.some((i) => i.fromCategoryId)).toBe(false);
  });

  it('moves a dish across sections and says where it came from', () => {
    const plan = planArrangement(current, [
      { categoryId: 'mains', itemIds: ['laal-maas'] },
      { categoryId: 'sweets', itemIds: ['gatte', 'kachori'] },
    ]);
    expect(plan.items).toEqual([
      { id: 'gatte', categoryId: 'sweets', sortOrder: 0, fromCategoryId: 'mains' },
      { id: 'kachori', categoryId: 'sweets', sortOrder: 1 },
    ]);
  });

  it('allows a section to be emptied', () => {
    const plan = planArrangement(current, [
      { categoryId: 'mains', itemIds: ['laal-maas', 'gatte', 'kachori'] },
      { categoryId: 'sweets', itemIds: [] },
    ]);
    expect(plan.items).toEqual([
      { id: 'kachori', categoryId: 'mains', sortOrder: 2, fromCategoryId: 'sweets' },
    ]);
  });

  it('refuses a dish listed twice', () => {
    expect(() => planArrangement(current, [
      { categoryId: 'mains', itemIds: ['laal-maas', 'gatte'] },
      { categoryId: 'sweets', itemIds: ['kachori', 'gatte'] },
    ])).toThrow(ValidationError);
  });

  it('refuses a section listed twice', () => {
    expect(() => planArrangement(current, [asLoaded[0]!, asLoaded[0]!])).toThrow(ValidationError);
  });

  it('refuses an arrangement missing a dish added since the board loaded', () => {
    const withNewDish = {
      ...current,
      items: [...current.items, { id: 'lassi', categoryId: 'sweets', sortOrder: 1 }],
    };
    expect(() => planArrangement(withNewDish, asLoaded)).toThrow(ConflictError);
  });

  it('refuses an arrangement naming a dish that is no longer on the menu', () => {
    expect(() => planArrangement(current, [
      asLoaded[0]!,
      { categoryId: 'sweets', itemIds: ['kachori', 'archived-yesterday'] },
    ])).toThrow(ConflictError);
  });

  it('refuses an arrangement missing a section', () => {
    expect(() => planArrangement(current, [asLoaded[0]!])).toThrow(ConflictError);
  });
});
