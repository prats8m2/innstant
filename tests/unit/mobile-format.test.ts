import { describe, it, expect } from 'vitest';
import {
  toRoman, padCount, spiceWordFor, flagChipFor, distinctDishCount,
  greetingFor, initialOf,
} from '../../mobile/lib/format';

/**
 * The home screen's small conversions. D-080.
 *
 * `mobile/lib/format.ts` imports nothing — not React Native, not even a type
 * from the contract — specifically so this file can reach across and run it
 * under the WEB app's `pnpm test`. The app has no runner of its own, and the
 * alternative to this file is a screen full of untested arithmetic that only
 * ever gets looked at on a phone.
 *
 * Same argument as `mobile-theme.test.ts` one directory over: the failure that
 * matters is somebody changing the thing on THIS side of the boundary, and
 * this is where that change gets run.
 */
describe('toRoman', () => {
  it('numbers the contents list the way a printed card does', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(toRoman))
      .toEqual(['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']);
  });

  it('keeps going past the seven sections the menu has today', () => {
    // The eighth section is the one a seven-entry lookup would have rendered
    // as an empty string, under a row that still has a name and a count.
    expect(toRoman(8)).toBe('VIII');
    expect(toRoman(14)).toBe('XIV');
    expect(toRoman(40)).toBe('XL');
  });

  it('renders nothing for a number that is not a position', () => {
    expect(toRoman(0)).toBe('');
    expect(toRoman(-1)).toBe('');
    expect(toRoman(1.5)).toBe('');
  });
});

describe('padCount', () => {
  it('zero-pads so the count column does not wobble', () => {
    expect(padCount(2)).toBe('02');
    expect(padCount(0)).toBe('00');
    expect(padCount(11)).toBe('11');
  });

  it('leaves a count that is already wider alone', () => {
    expect(padCount(104)).toBe('104');
  });
});

describe('spiceWordFor', () => {
  it('names each of the five levels', () => {
    expect([1, 2, 3, 4, 5].map(spiceWordFor))
      .toEqual(['Mild', 'Gentle', 'Medium', 'Hot', 'Very hot']);
  });

  /** A dish with no spice level draws no meter — not a meter reading zero. */
  it('stays null for a dish that has no level', () => {
    expect(spiceWordFor(null)).toBeNull();
    expect(spiceWordFor(0)).toBeNull();
    expect(spiceWordFor(6)).toBeNull();
  });
});

describe('flagChipFor', () => {
  it('renders the three flags the menu actually uses', () => {
    expect(flagChipFor('VEGETARIAN')).toEqual({ label: 'Veg', tone: 'positive' });
    expect(flagChipFor('VEGAN')).toEqual({ label: 'Vegan', tone: 'positive' });
    expect(flagChipFor('CONTAINS_NUTS')).toEqual({ label: 'Nuts', tone: 'secondary' });
  });

  /**
   * The server's list is open-ended — `MENU_DIETARY_FLAGS` is edited by a
   * property, not by this file. A chip reading CONTAINS_SHELLFISH in screaming
   * snake case is worse than no chip, and the dish screen shows the full list
   * anyway.
   */
  it('renders nothing for a flag it does not know', () => {
    expect(flagChipFor('CONTAINS_SHELLFISH')).toBeNull();
    expect(flagChipFor('')).toBeNull();
  });
});

describe('distinctDishCount', () => {
  /**
   * The number the header says out loud. The Kesari's live menu is ten dishes
   * across seventeen section appearances — laal maas and mohan maas are each
   * in three sections — and "17 dishes" over a menu of ten is a claim the
   * kitchen cannot back.
   */
  it('counts dishes, not the rows the layout draws', () => {
    const sections = [
      { items: [{ id: 'laal' }, { id: 'mohan' }, { id: 'ker' }] },
      { items: [{ id: 'laal' }, { id: 'mohan' }] },
      { items: [{ id: 'laal' }, { id: 'mohan' }, { id: 'gatte' }] },
    ];

    expect(sections.reduce((n, s) => n + s.items.length, 0)).toBe(8);
    expect(distinctDishCount(sections)).toBe(4);
  });

  it('is zero for a menu with nothing on it', () => {
    expect(distinctDishCount([])).toBe(0);
    expect(distinctDishCount([{ items: [] }, { items: [] }])).toBe(0);
  });
});

describe('greetingFor', () => {
  /**
   * The rule CLAUDE.md states and this screen would otherwise break: the
   * greeting sits beside a kitchen's hours and an ETA, both already
   * property-local. One instant, two zones, two different greetings — and the
   * property's is the one that renders.
   */
  it('reads the property clock and not the device one', () => {
    const instant = new Date('2026-10-14T20:00:00Z');

    // 01:30 the next day in Udaipur; 21:00 the same evening in London.
    expect(greetingFor(instant, 'Asia/Kolkata')).toBe('Good morning');
    expect(greetingFor(instant, 'Europe/London')).toBe('Good evening');
  });

  it('turns over at noon and at five', () => {
    const atKolkata = (hhmm: string) =>
      greetingFor(new Date(`2026-10-14T${hhmm}:00+05:30`), 'Asia/Kolkata');

    expect(atKolkata('00:00')).toBe('Good morning');
    expect(atKolkata('11:59')).toBe('Good morning');
    expect(atKolkata('12:00')).toBe('Good afternoon');
    expect(atKolkata('16:59')).toBe('Good afternoon');
    expect(atKolkata('17:00')).toBe('Good evening');
    expect(atKolkata('23:59')).toBe('Good evening');
  });

  it('still greets somebody when the zone is nonsense', () => {
    // An unknown IANA zone throws rather than falling back, and a wrong
    // greeting is not worth a crashed screen.
    expect(greetingFor(new Date('2026-10-14T20:00:00Z'), 'Mars/Olympus'))
      .toMatch(/^Good /);
  });
});

describe('initialOf', () => {
  it('takes the first letter, uppercased', () => {
    expect(initialOf('priya')).toBe('P');
    expect(initialOf('  Bhairav Singh ')).toBe('B');
  });

  /**
   * `name[0]` would return half a surrogate pair here — a tofu box where an
   * initial should be. `ApiCustomer.name` is whatever somebody called
   * themselves, so this is not a hypothetical input.
   */
  it('takes a whole grapheme, not half a code point', () => {
    expect(initialOf('प्रतीक')).toBe('प');
    expect(initialOf('🙂 somebody')).toBe('🙂');
  });

  it('is empty for an empty name, so the corner falls back to the icon', () => {
    expect(initialOf('')).toBe('');
    expect(initialOf('   ')).toBe('');
  });
});
