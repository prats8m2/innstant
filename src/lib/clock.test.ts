import { describe, it, expect } from 'vitest';
import {
  localTimeAt, parseClock, toClock, formatClock, dayName, formatCheckoutDay, formatCheckoutShort, nightsUntil, formatFolioDate, spellCount, atLocalHourOnSameDay, formatHour,
} from './clock';

/**
 * The whole point of this file is that it does not depend on where it runs.
 * Every case below is an explicit instant in an explicit timezone.
 */
describe('localTimeAt', () => {
  it('answers in the property timezone, not the server one', () => {
    // 2026-09-01T18:30:00Z is 2026-09-02T00:00 in Kolkata: a different DAY.
    const instant = new Date('2026-09-01T18:30:00Z');

    expect(localTimeAt(instant, 'Asia/Kolkata')).toEqual({ dayOfWeek: 3, minutes: 0 });
    expect(localTimeAt(instant, 'UTC')).toEqual({ dayOfWeek: 2, minutes: 18 * 60 + 30 });
  });

  it('reads midnight as 0, not 24', () => {
    // ICU has returned '24' for hour12:false midnight; that would be 1440.
    const midnight = new Date('2026-08-31T18:30:00Z'); // 00:00 IST, Tuesday
    expect(localTimeAt(midnight, 'Asia/Kolkata').minutes).toBe(0);
  });

  it('handles a half-hour offset', () => {
    const instant = new Date('2026-09-01T06:00:00Z');
    expect(localTimeAt(instant, 'Asia/Kolkata').minutes).toBe(11 * 60 + 30);
  });

  it('follows DST where a fixed offset would not', () => {
    const july = new Date('2026-07-01T12:00:00Z');
    const january = new Date('2026-01-01T12:00:00Z');

    expect(localTimeAt(july, 'Europe/London').minutes).toBe(13 * 60);
    expect(localTimeAt(january, 'Europe/London').minutes).toBe(12 * 60);
  });

  it('refuses a timezone it cannot read', () => {
    expect(() => localTimeAt(new Date('2026-09-01T00:00:00Z'), 'Mars/Olympus')).toThrow();
  });
});

describe('clock strings', () => {
  it('round-trips', () => {
    for (const hhmm of ['00:00', '07:00', '11:30', '23:59', '01:00']) {
      expect(toClock(parseClock(hhmm))).toBe(hhmm);
    }
  });

  it('refuses what is not a time of day', () => {
    for (const bad of ['', '7', '24:00', '07:60', '7:0', 'seven', '07:00:00']) {
      expect(() => parseClock(bad), bad).toThrow(RangeError);
    }
  });

  it('accepts a single-digit hour, because stored data has both forms', () => {
    expect(parseClock('7:00')).toBe(420);
  });

  it('wraps rather than producing a 25th hour', () => {
    expect(toClock(1440)).toBe('00:00');
    expect(toClock(1500)).toBe('01:00');
    expect(toClock(-60)).toBe('23:00');
  });

  it('speaks the way the reference writes times', () => {
    expect(formatClock('23:30')).toBe('11:30pm');
    expect(formatClock('01:00')).toBe('1am');
    expect(formatClock('07:00')).toBe('7am');
    expect(formatClock('12:00')).toBe('noon');
    expect(formatClock('00:00')).toBe('midnight');
    expect(formatClock('12:30')).toBe('12:30pm');
    expect(formatClock('00:30')).toBe('12:30am');
  });

  it('names days from 0 = Sunday, as the column does', () => {
    expect(dayName(0)).toBe('Sunday');
    expect(dayName(4)).toBe('Thursday');
    expect(dayName(7)).toBe('Sunday');
  });
});

/**
 * The stay screen's dates. Property-local, every one of them — a guest due out
 * at 11am in Udaipur must never read 5:30am because the server is in UTC.
 */
describe('when the guest is due out', () => {
  const UDAIPUR = 'Asia/Kolkata';

  it('reads the way the reference writes it', () => {
    // Thursday 12 March 2026, 11:00 IST = 05:30 UTC.
    expect(formatCheckoutDay(new Date('2026-03-12T05:30:00Z'), UDAIPUR))
      .toBe('Thursday, 11am');
  });

  /**
   * The desk's column form. Same instant, same timezone, fewer characters —
   * a weekday spelled in full either truncates or steals the width the guest's
   * name needs, in a table of thirty-four rooms.
   */
  it('has a short form for the board, with no comma', () => {
    expect(formatCheckoutShort(new Date('2026-03-12T05:30:00Z'), UDAIPUR))
      .toBe('Thu 11am');
    expect(formatCheckoutShort(new Date('2026-03-12T06:00:00Z'), UDAIPUR))
      .toBe('Thu 11:30am');
  });

  it('keeps the minutes when there are any', () => {
    expect(formatCheckoutDay(new Date('2026-03-12T06:00:00Z'), UDAIPUR))
      .toBe('Thursday, 11:30am');
  });

  it('is the property\'s day, not the server\'s', () => {
    // 20:00 UTC on Wednesday is 01:30 THURSDAY in Udaipur.
    expect(formatCheckoutDay(new Date('2026-03-11T20:00:00Z'), UDAIPUR))
      .toMatch(/^Thursday/);
  });
});

describe('nights left', () => {
  const UDAIPUR = 'Asia/Kolkata';
  const checkout = new Date('2026-03-12T05:30:00Z'); // Thu 11am local

  it('counts calendar nights, not 24-hour blocks', () => {
    // Tuesday 21:00 local and Wednesday 01:00 local are different nights, and
    // dividing elapsed milliseconds would call one of them the same.
    const tuesdayEvening = new Date('2026-03-10T15:30:00Z'); // Tue 21:00 IST
    const wednesdayJustAfterMidnight = new Date('2026-03-10T19:00:00Z'); // Wed 00:30 IST

    expect(nightsUntil(tuesdayEvening, checkout, UDAIPUR)).toBe(2);
    expect(nightsUntil(wednesdayJustAfterMidnight, checkout, UDAIPUR)).toBe(1);
  });

  it('is zero on the day of checkout, before and after the hour', () => {
    expect(nightsUntil(new Date('2026-03-12T02:00:00Z'), checkout, UDAIPUR)).toBe(0);
    expect(nightsUntil(new Date('2026-03-12T09:00:00Z'), checkout, UDAIPUR)).toBe(0);
  });

  it('never goes negative for a guest who has overstayed', () => {
    expect(nightsUntil(new Date('2026-03-20T09:00:00Z'), checkout, UDAIPUR)).toBe(0);
  });
});

describe('the folio date column', () => {
  it('is short enough for a 46px column', () => {
    expect(formatFolioDate(new Date('2026-03-12T13:00:00Z'), 'Asia/Kolkata')).toBe('12 Mar');
  });

  it('rolls over on the property\'s midnight', () => {
    // 19:00 UTC on the 11th is 00:30 on the 12th in Udaipur.
    expect(formatFolioDate(new Date('2026-03-11T19:00:00Z'), 'Asia/Kolkata')).toBe('12 Mar');
  });
});

describe('spelling a small count', () => {
  it('spells to ten, the way the copy reads', () => {
    expect(spellCount(0)).toBe('No');
    expect(spellCount(1)).toBe('One');
    expect(spellCount(2)).toBe('Two');
    expect(spellCount(10)).toBe('Ten');
  });

  it('gives up and uses digits above ten', () => {
    expect(spellCount(11)).toBe('11');
    expect(spellCount(42)).toBe('42');
  });
});

describe('an instant at a property-local hour', () => {
  const UDAIPUR = 'Asia/Kolkata';

  it('lands on the hour in the property\'s day', () => {
    // Thursday 09:37 IST = 04:07 UTC. 2pm IST that day = 08:30 UTC.
    const at = atLocalHourOnSameDay(new Date('2026-03-12T04:07:23.456Z'), 14, UDAIPUR);
    expect(at.toISOString()).toBe('2026-03-12T08:30:00.000Z');
  });

  /**
   * The reference's seconds used to survive the shift, so "2pm" was
   * 14:00:00.837 and two calls a millisecond apart produced two different 2pms.
   */
  it('drops the seconds it was given', () => {
    const a = atLocalHourOnSameDay(new Date('2026-03-12T04:07:23.456Z'), 14, UDAIPUR);
    const b = atLocalHourOnSameDay(new Date('2026-03-12T05:59:59.999Z'), 14, UDAIPUR);
    expect(a.getTime()).toBe(b.getTime());
  });

  it('can go backwards as well as forwards', () => {
    // 8pm IST asking for 9am IST is earlier the same local day.
    const at = atLocalHourOnSameDay(new Date('2026-03-12T14:30:00Z'), 9, UDAIPUR);
    expect(at.toISOString()).toBe('2026-03-12T03:30:00.000Z');
  });

  it('stays on the property\'s day across the server\'s midnight', () => {
    // 19:30 UTC Wednesday is 01:00 THURSDAY in Udaipur, so 11am is Thursday's.
    const at = atLocalHourOnSameDay(new Date('2026-03-11T19:30:00Z'), 11, UDAIPUR);
    expect(at.toISOString()).toBe('2026-03-12T05:30:00.000Z');
  });

  it('refuses an hour that is not one', () => {
    expect(() => atLocalHourOnSameDay(new Date(), 24, UDAIPUR)).toThrow(RangeError);
    expect(() => atLocalHourOnSameDay(new Date(), -1, UDAIPUR)).toThrow(RangeError);
    expect(() => atLocalHourOnSameDay(new Date(), 9.5, UDAIPUR)).toThrow(RangeError);
  });
});

describe('formatting an hour', () => {
  it('is the way the reference writes one', () => {
    expect(formatHour(14)).toBe('2pm');
    expect(formatHour(11)).toBe('11am');
    expect(formatHour(0)).toBe('12am');
    expect(formatHour(12)).toBe('12pm');
  });
});
