import { describe, it, expect } from 'vitest';
import {
  searchMenu, menuFacets, countDishes, foldForSearch, matchTier, passesFilters,
} from './menu-search';
import type { MenuDish, MenuSection } from './menu';

/**
 * What a diner typing three letters gets back.
 *
 * The rule is what is worth testing, not the plumbing: the folding, the order
 * the tiers impose, what a filter does with a dish nobody classified, and the
 * fact that a dish belonging to three sections is one result. The function is
 * pure over the sections `getMenu()` already assembles, so none of this needs
 * a database or a clock.
 */
const dish = (id: string, over: Partial<MenuDish> = {}): MenuDish => ({
  id,
  name: id,
  description: null,
  priceMinor: 100_00,
  listPriceMinor: null,
  offer: null,
  currency: 'INR',
  isAvailable: true,
  dietaryFlags: [],
  spiceLevel: null,
  prepTimeMinutes: null,
  imageUrl: null,
  blurhash: null,
  canQuickAdd: true,
  ...over,
});

const section = (
  label: string,
  items: MenuDish[],
  kind: MenuSection['kind'] = 'COLLECTION',
): MenuSection => ({ id: label, kind, title: label, label, blurb: null, items });

const ids = (hits: ReturnType<typeof searchMenu>) => hits.map((hit) => hit.dish.id);

describe('foldForSearch', () => {
  it('folds case and accents, so a keyboard without ñ still finds the dish', () => {
    expect(foldForSearch('  Jalapeño  ')).toBe('jalapeno');
    expect(foldForSearch('LAAL MAAS')).toBe('laal maas');
  });

  it('leaves the letters alone — no stemming, no transliteration', () => {
    // "paneer" / "panir" is a real miss, and the honest fix is a synonym list
    // a property maintains rather than a guess made in a fold.
    expect(foldForSearch('panir')).toBe('panir');
  });
});

describe('matchTier', () => {
  const chai = dish('chai', {
    name: 'Masala chai',
    description: 'Cardamom, ginger, black pepper',
  });

  it('ranks a word prefix of the name above a bare substring of it', () => {
    expect(matchTier(chai, 'chai')).toBe(3);
    expect(matchTier(chai, 'asal')).toBe(2);
  });

  it('puts a description-only match below every name match', () => {
    expect(matchTier(chai, 'ginger')).toBe(1);
  });

  it('is 0 for a miss, and 0 for no query at all', () => {
    expect(matchTier(chai, 'lassi')).toBe(0);
    expect(matchTier(chai, '')).toBe(0);
  });

  it('matches a word anywhere in the name, not only the first', () => {
    expect(matchTier(dish('x', { name: 'Dal baati churma' }), 'baa')).toBe(3);
  });
});

describe('passesFilters', () => {
  const vegNuts = dish('x', {
    dietaryFlags: ['VEGETARIAN', 'CONTAINS_NUTS'],
    spiceLevel: 2,
    priceMinor: 320_00,
  });

  it('requires every requested flag, so veg AND non-veg is nothing', () => {
    expect(passesFilters(vegNuts, { dietaryFlags: ['VEGETARIAN'] })).toBe(true);
    expect(passesFilters(vegNuts, {
      dietaryFlags: ['VEGETARIAN', 'NON_VEGETARIAN'],
    })).toBe(false);
  });

  it('excludes on the warning flags, which is the only way to say "no nuts"', () => {
    expect(passesFilters(vegNuts, { excludeDietaryFlags: ['CONTAINS_NUTS'] })).toBe(false);
  });

  it('treats an undeclared spice level as undeclared, not as mild', () => {
    const unknown = dish('y', { spiceLevel: null });
    expect(passesFilters(unknown, { maxSpice: 1 })).toBe(false);
    expect(passesFilters(unknown, { minSpice: 3 })).toBe(false);
    // No spice filter at all: the dish is not being asked about.
    expect(passesFilters(unknown, { dietaryFlags: [] })).toBe(true);
  });

  it('bounds spice and price inclusively', () => {
    expect(passesFilters(vegNuts, { minSpice: 2, maxSpice: 2 })).toBe(true);
    expect(passesFilters(vegNuts, { minSpice: 3 })).toBe(false);
    expect(passesFilters(vegNuts, { minPriceMinor: 320_00, maxPriceMinor: 320_00 })).toBe(true);
    expect(passesFilters(vegNuts, { maxPriceMinor: 319_99 })).toBe(false);
  });
});

describe('searchMenu', () => {
  const LAAL = dish('laal', { name: 'Laal maas with bajra roti', spiceLevel: 4, priceMinor: 1150_00, dietaryFlags: ['NON_VEGETARIAN'] });
  const KER = dish('ker', { name: 'Ker sangri', description: 'Desert beans, slow cooked', dietaryFlags: ['VEGETARIAN', 'VEGAN'], spiceLevel: 1, priceMinor: 450_00 });
  const CHAI = dish('chai', { name: 'Masala chai', dietaryFlags: ['VEGETARIAN'], priceMinor: 180_00 });
  const LASSI = dish('lassi', { name: 'Kesar lassi', dietaryFlags: ['VEGETARIAN', 'CONTAINS_NUTS'], priceMinor: 320_00, isAvailable: false });

  const MENU: MenuSection[] = [
    section('Chef Bhairav', [LAAL, KER]),
    section('Rooftop', [LAAL, CHAI]),
    section('Drinks', [CHAI, LASSI], 'CATEGORY'),
  ];

  it('returns a dish once, under the first section it appears in', () => {
    const hits = searchMenu(MENU, { query: 'laal' });
    expect(hits).toHaveLength(1);
    // Collections precede categories in getMenu(), so the first is the
    // editorial one — the eyebrow says "Chef Bhairav", not "Mains".
    expect(hits[0]!.section).toBe('Chef Bhairav');
  });

  it('with no query, returns the whole menu available-first in menu order', () => {
    expect(ids(searchMenu(MENU))).toEqual(['laal', 'ker', 'chai', 'lassi']);
  });

  it('puts an exact name match above a near miss even when it is 86d', () => {
    // A guest who types the name of a dish that is off tonight has asked a
    // question. "Kesar lassi — unavailable" answers it; burying it does not.
    const hits = searchMenu(MENU, { query: 'kesar' });
    expect(ids(hits)).toEqual(['lassi']);
    expect(hits[0]!.dish.isAvailable).toBe(false);
  });

  it('orders name matches above description matches', () => {
    const SOUP = dish('soup', { name: 'Desert broth', description: 'nothing' });
    const menu = [section('All', [KER, SOUP])];
    // KER matches only in its description ("Desert beans"); SOUP in its name.
    expect(ids(searchMenu(menu, { query: 'desert' }))).toEqual(['soup', 'ker']);
  });

  it('filters with no query at all — a chip tapped on an empty box', () => {
    expect(ids(searchMenu(MENU, { filters: { dietaryFlags: ['VEGAN'] } }))).toEqual(['ker']);
  });

  it('ANDs the query and the filters', () => {
    expect(searchMenu(MENU, {
      query: 'laal',
      filters: { dietaryFlags: ['VEGETARIAN'] },
    })).toEqual([]);
  });

  it('caps at the limit, keeping the best matches', () => {
    expect(ids(searchMenu(MENU, { limit: 2 }))).toEqual(['laal', 'ker']);
  });

  it('answers an all-miss with nothing rather than with the menu', () => {
    expect(searchMenu(MENU, { query: 'pizza' })).toEqual([]);
  });

  describe('facets', () => {
    it('offers only what this menu actually declares', () => {
      expect(menuFacets(MENU)).toEqual({
        dietaryFlags: ['CONTAINS_NUTS', 'NON_VEGETARIAN', 'VEGAN', 'VEGETARIAN'],
        spiceLevels: [1, 4],
        priceRange: { minMinor: 180_00, maxMinor: 1150_00 },
      });
    });

    it('includes tonight’s unavailable dishes, so chips do not move', () => {
      // Kesar lassi is 86'd and is the only dish carrying CONTAINS_NUTS.
      expect(menuFacets(MENU).dietaryFlags).toContain('CONTAINS_NUTS');
    });

    it('has no price range on an empty menu', () => {
      expect(menuFacets([])).toEqual({
        dietaryFlags: [], spiceLevels: [], priceRange: null,
      });
    });
  });

  it('counts each dish once across the sections it appears in', () => {
    expect(countDishes(MENU)).toBe(4);
  });
});
