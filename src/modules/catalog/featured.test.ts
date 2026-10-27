import { describe, it, expect } from 'vitest';
import { featuredDishes } from './featured';
import type { MenuDish, MenuSection } from './menu';

/**
 * The strip the home screen leads with.
 *
 * What is worth testing here is the RULE, not the plumbing: across collections
 * rather than down one, never the same dish twice, never one the kitchen has
 * turned off — and an empty answer rather than a short apology when there is
 * nothing to show. The function is pure over the sections `getMenu()` already
 * assembles, so none of this needs a database or a clock.
 */
const dish = (id: string, over: Partial<MenuDish> = {}): MenuDish => ({
  id,
  name: id,
  description: null,
  priceMinor: 100_00,
  listPriceMinor: null,
  offer: null,
  remainingToday: null,
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
  title: string,
  kind: MenuSection['kind'],
  items: MenuDish[],
): MenuSection => ({ id: title, kind, title, label: title, blurb: null, items });

/** The Kesari's own shape after 10pm: three collections, then the categories. */
const LAAL = dish('laal-maas');
const KACHORI = dish('pyaaz-kachori');
const MOHAN = dish('mohan-maas');
const KER = dish('ker-sangri');

describe('featuredDishes', () => {
  it('takes one from each collection rather than three from the first', () => {
    const picked = featuredDishes([
      section('From the rooftop', 'COLLECTION', [LAAL, MOHAN, KER]),
      section('After 10pm', 'COLLECTION', [KACHORI]),
      section('Chef Bhairav’s table', 'COLLECTION', [LAAL, MOHAN]),
    ]);

    // Three different tags is the whole point — taking the first three members
    // of collection zero would have labelled all three "From the rooftop".
    expect(picked.map((p) => p.section)).toEqual([
      'From the rooftop', 'After 10pm', 'Chef Bhairav’s table',
    ]);
    expect(picked.map((p) => p.dish.id)).toEqual(['laal-maas', 'pyaaz-kachori', 'mohan-maas']);
  });

  it('never stands the same dish in the strip twice', () => {
    // Laal maas belongs to three sections on the live menu. Without the taken
    // set the strip would be that one dish, three times, under three tags.
    const picked = featuredDishes([
      section('From the rooftop', 'COLLECTION', [LAAL, MOHAN]),
      section('Chef’s specials', 'COLLECTION', [LAAL, MOHAN]),
      section('Rajasthani classics', 'CATEGORY', [LAAL, MOHAN, KER]),
    ]);

    expect(new Set(picked.map((p) => p.dish.id)).size).toBe(picked.length);
    expect(picked.map((p) => p.dish.id)).toEqual(['laal-maas', 'mohan-maas', 'ker-sangri']);
  });

  it('skips a dish the kitchen has turned off tonight', () => {
    const picked = featuredDishes([
      section('From the rooftop', 'COLLECTION', [
        dish('off-tonight', { isAvailable: false }),
        LAAL,
      ]),
    ]);

    expect(picked.map((p) => p.dish.id)).toEqual(['laal-maas']);
  });

  it('tops up from the categories when fewer than three collections are showing', () => {
    // Daylight: "After 10pm" has been filtered out upstream by its window, so
    // two collections are showing and the third slot comes from the menu's own
    // ordering rather than from a second pass down collection zero.
    const picked = featuredDishes([
      section('From the rooftop', 'COLLECTION', [LAAL]),
      section('Chef Bhairav’s table', 'COLLECTION', [LAAL, MOHAN]),
      section('Rajasthani classics', 'CATEGORY', [KER]),
      section('Drinks', 'CATEGORY', [dish('masala-chai')]),
    ]);

    expect(picked.map((p) => p.section)).toEqual([
      'From the rooftop', 'Chef Bhairav’s table', 'Rajasthani classics',
    ]);
  });

  it('tags the strip with the section’s short label, not its full title', () => {
    // `label` is what `railLabel()` made of the title, and it is what the
    // design's eyebrow shows: "Chef Bhairav", never "Chef Bhairav’s table".
    const picked = featuredDishes([
      {
        id: 'bhairav',
        kind: 'COLLECTION',
        title: 'Chef Bhairav’s table',
        label: 'Chef Bhairav',
        blurb: null,
        items: [LAAL],
      },
    ]);

    expect(picked.map((p) => p.section)).toEqual(['Chef Bhairav']);
  });

  it('never puts a category ahead of a collection', () => {
    const picked = featuredDishes([
      section('Drinks', 'CATEGORY', [dish('masala-chai')]),
      section('From the rooftop', 'COLLECTION', [LAAL]),
    ]);

    expect(picked[0]?.section).toBe('From the rooftop');
  });

  it('returns nothing at all when there is nothing available to show', () => {
    expect(featuredDishes([])).toEqual([]);
    expect(featuredDishes([
      section('From the rooftop', 'COLLECTION', [dish('off', { isAvailable: false })]),
      section('Drinks', 'CATEGORY', []),
    ])).toEqual([]);
  });

  it('stops at the cap, however many sections there are', () => {
    const sections = Array.from({ length: 9 }, (_, i) =>
      section(`c${i}`, 'COLLECTION', [dish(`d${i}`)]));

    expect(featuredDishes(sections)).toHaveLength(3);
    expect(featuredDishes(sections, 1)).toHaveLength(1);
    expect(featuredDishes(sections, 5)).toHaveLength(5);
  });
});
