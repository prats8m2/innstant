import { describe, it, expect } from 'vitest';
import {
  planDay, partForCategory, partAtHour, describeTrip, PARTS, PART_LABELS,
  type PlannedPlace,
} from './plan';

const place = (over: Partial<PlannedPlace> & { name: string; category: string }): PlannedPlace => ({
  id: over.name,
  editorialNote: null,
  description: null,
  walkMinutes: null,
  driveMinutes: null,
  isPartner: false,
  partnerOffer: null,
  ...over,
});

const CITY: PlannedPlace[] = [
  place({ name: 'Jagdish Temple', category: 'TEMPLE', walkMinutes: 6 }),
  place({ name: 'Gangaur Ghat', category: 'GHAT', walkMinutes: 4 }),
  place({ name: 'City Palace', category: 'PALACE', walkMinutes: 9 }),
  place({ name: 'Ambrai Ghat', category: 'VIEWPOINT', walkMinutes: 12 }),
  place({ name: 'Upre', category: 'DINING', walkMinutes: 8 }),
  place({ name: 'Monsoon Palace', category: 'VIEWPOINT', driveMinutes: 25 }),
];

describe('partAtHour', () => {
  /**
   * These bands have to match `greetingFor()` on the room home. A guest told
   * "good evening" and then shown "this afternoon" one tap later has caught
   * the app not knowing what time it is — and the two are computed in
   * different files, so nothing but this test holds them together.
   */
  it('uses the same bands the room home greets by', () => {
    expect(partAtHour(7)).toBe('morning');
    expect(partAtHour(11.9)).toBe('morning');
    expect(partAtHour(12)).toBe('afternoon');
    expect(partAtHour(16.9)).toBe('afternoon');
    expect(partAtHour(17)).toBe('evening');
    expect(partAtHour(20.9)).toBe('evening');
    expect(partAtHour(21)).toBe('night');
    expect(partAtHour(2)).toBe('night');
  });
});

describe('partForCategory', () => {
  it('is case-insensitive, because a category is free text', () => {
    expect(partForCategory('dining')).toBe('night');
    expect(partForCategory('DINING')).toBe('night');
  });

  /**
   * The fallback is the whole point: a GM who types a category nobody mapped
   * must still see their place on the screen. A place that silently vanishes
   * is the failure a guest cannot see and therefore cannot report.
   */
  it('puts an unmapped category somewhere rather than nowhere', () => {
    expect(PARTS).toContain(partForCategory('HOT_AIR_BALLOON'));
    expect(partForCategory('HOT_AIR_BALLOON')).toBe('afternoon');
  });

  it('has a label for every part', () => {
    for (const part of PARTS) {
      expect(PART_LABELS[part].length).toBeGreaterThan(0);
    }
  });
});

describe('planDay', () => {
  it('opens on the part of the day the guest is standing in', () => {
    expect(planDay(CITY, 9)[0]?.part).toBe('morning');
    expect(planDay(CITY, 14)[0]?.part).toBe('afternoon');
    expect(planDay(CITY, 22)[0]?.part).toBe('night');
  });

  /**
   * Rotated, not truncated. At ten at night the screen leads with dinner, and
   * the morning still follows — "what did I miss" and "what about tomorrow"
   * are the same list, and a guest who has just checked in at 11pm would
   * otherwise be shown one restaurant and nothing else.
   */
  it('keeps the rest of the day after the part it opens on', () => {
    const late = planDay(CITY, 22).map((s) => s.part);
    expect(late[0]).toBe('night');
    expect(late).toContain('morning');
    expect(late).toContain('afternoon');
    expect(late).toContain('evening');
  });

  it('marks exactly one section as now', () => {
    for (const hour of [0, 6, 9, 13, 18, 23]) {
      const marked = planDay(CITY, hour).filter((s) => s.isNow);
      expect(marked, `at ${hour}:00`).toHaveLength(1);
    }
  });

  it('sorts each section by walking time, nearest first', () => {
    const morning = planDay(CITY, 9).find((s) => s.part === 'morning');
    expect(morning?.places.map((p) => p.name)).toEqual(['Gangaur Ghat', 'Jagdish Temple']);
  });

  /**
   * A place with no walking time sorts LAST rather than first. Treating a
   * missing number as zero would put the 25-minute drive above the four-minute
   * walk, which is the opposite of useful.
   */
  it('sorts a place with no walking time last, not first', () => {
    const evening = planDay(CITY, 18).find((s) => s.part === 'evening');
    expect(evening?.places.map((p) => p.name)).toEqual(['Ambrai Ghat', 'Monsoon Palace']);
  });

  it('drops empty sections rather than showing a heading with nothing under it', () => {
    const onlyDinner = planDay([place({ name: 'Upre', category: 'DINING' })], 9);
    expect(onlyDinner).toHaveLength(1);
    expect(onlyDinner[0]?.part).toBe('night');
  });

  it('returns nothing at all for a property that has curated nothing', () => {
    expect(planDay([], 9)).toEqual([]);
  });

  it('loses no place, whatever the hour', () => {
    for (const hour of [0, 9, 15, 20]) {
      const shown = planDay(CITY, hour).flatMap((s) => s.places.map((p) => p.name));
      expect(new Set(shown).size, `at ${hour}:00`).toBe(CITY.length);
    }
  });
});

describe('describeTrip', () => {
  it('prefers walking, falls back to driving', () => {
    expect(describeTrip(place({ name: 'a', category: 'DINING', walkMinutes: 8 }))).toBe('8 min walk');
    expect(describeTrip(place({ name: 'b', category: 'DINING', driveMinutes: 25 }))).toBe('25 min drive');
  });

  /** Silence rather than a guess. "0 min" or "nearby" would both be lies. */
  it('says nothing when neither is known', () => {
    expect(describeTrip(place({ name: 'c', category: 'DINING' }))).toBeNull();
  });

  it('prefers walking even when both are known', () => {
    expect(describeTrip(place({ name: 'd', category: 'DINING', walkMinutes: 5, driveMinutes: 2 })))
      .toBe('5 min walk');
  });
});
