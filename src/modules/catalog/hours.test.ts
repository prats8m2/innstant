import { describe, it, expect } from 'vitest';
import { outletOpenState, describeOpenState, type OutletHoursDay } from './hours';
import { formatClock } from '@/lib/clock';

/**
 * The seeded Kesari hours: every day, 07:00 to 01:00 the next morning. This is
 * the shape that broke a naive `closesAt < opensAt` comparison, so it is the
 * one most of these cases use.
 */
const everyDay = (
  opensAt: string,
  closesAt: string,
  crossesMidnight: boolean,
): OutletHoursDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt, crossesMidnight }));

const KESARI = everyDay('07:00', '01:00', true);

const at = (dayOfWeek: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return { dayOfWeek, minutes: h * 60 + m };
};

describe('outletOpenState', () => {
  it('is open in the middle of service', () => {
    const state = outletOpenState(KESARI, at(3, '21:00'));
    expect(state.isOpen).toBe(true);
    expect(state.closesAt).toBe('01:00');
  });

  it('is open after midnight, on the strength of yesterday’s window', () => {
    // The case the hardcoded "open until 11:30pm" string got wrong in both
    // directions: at 00:30 the kitchen IS open, until 1am.
    const state = outletOpenState(KESARI, at(3, '00:30'));
    expect(state.isOpen).toBe(true);
    expect(state.closesAt).toBe('01:00');
  });

  it('is closed in the small hours, and says when it opens today', () => {
    const state = outletOpenState(KESARI, at(3, '03:00'));
    expect(state.isOpen).toBe(false);
    expect(state.nextOpen).toEqual({ dayOfWeek: 3, opensAt: '07:00', today: true });
  });

  it('closes exactly at the closing minute, not a minute after', () => {
    expect(outletOpenState(KESARI, at(3, '00:59')).isOpen).toBe(true);
    expect(outletOpenState(KESARI, at(3, '01:00')).isOpen).toBe(false);
  });

  it('opens exactly at the opening minute', () => {
    expect(outletOpenState(KESARI, at(3, '06:59')).isOpen).toBe(false);
    expect(outletOpenState(KESARI, at(3, '07:00')).isOpen).toBe(true);
  });

  it('carries a Saturday-night window into Sunday morning', () => {
    // Saturday is day 6; its window ends past the end of the week. Sunday
    // 00:30 is early in the week, not late — the wraparound case.
    const saturdayOnly: OutletHoursDay[] = [
      { dayOfWeek: 6, opensAt: '19:00', closesAt: '02:00', crossesMidnight: true },
    ];
    expect(outletOpenState(saturdayOnly, at(6, '23:00')).isOpen).toBe(true);
    expect(outletOpenState(saturdayOnly, at(0, '00:30')).isOpen).toBe(true);
    expect(outletOpenState(saturdayOnly, at(0, '02:30')).isOpen).toBe(false);
  });

  it('treats a day with no row as closed that day', () => {
    // No `is_closed` column, and "closed on Tuesdays" must not be 00:00–00:00.
    const notTuesday = KESARI.filter((h) => h.dayOfWeek !== 2);
    expect(outletOpenState(notTuesday, at(2, '21:00')).isOpen).toBe(false);
    expect(outletOpenState(notTuesday, at(2, '21:00')).nextOpen)
      .toEqual({ dayOfWeek: 3, opensAt: '07:00', today: false });
    // Monday night still runs into Tuesday morning, because that is Monday's row.
    expect(outletOpenState(notTuesday, at(2, '00:30')).isOpen).toBe(true);
  });

  it('is closed, with nothing to promise, when there are no hours at all', () => {
    const state = outletOpenState([], at(3, '21:00'));
    expect(state).toEqual({ isOpen: false, closesAt: null, nextOpen: null });
  });

  it('handles a same-day window without the midnight flag', () => {
    const breakfast = everyDay('07:00', '10:30', false);
    expect(outletOpenState(breakfast, at(3, '08:00')).isOpen).toBe(true);
    expect(outletOpenState(breakfast, at(3, '11:00')).isOpen).toBe(false);
    expect(outletOpenState(breakfast, at(3, '00:30')).isOpen).toBe(false);
  });

  it('reads bad data as closed rather than as a 23-hour service', () => {
    // closesAt before opensAt with the flag unset is a data error. Being told
    // to call the desk beats an order nobody is there to cook.
    const wrong: OutletHoursDay[] = [
      { dayOfWeek: 3, opensAt: '19:00', closesAt: '02:00', crossesMidnight: false },
    ];
    expect(outletOpenState(wrong, at(3, '20:00')).isOpen).toBe(false);
  });

  it('wraps to the first window of the week when the last one has passed', () => {
    const weekend: OutletHoursDay[] = [
      { dayOfWeek: 5, opensAt: '19:00', closesAt: '23:00', crossesMidnight: false },
    ];
    const state = outletOpenState(weekend, at(6, '20:00'));
    expect(state.isOpen).toBe(false);
    expect(state.nextOpen).toEqual({ dayOfWeek: 5, opensAt: '19:00', today: false });
  });
});

describe('describeOpenState', () => {
  const say = (dayOfWeek: number, hhmm: string, hours = KESARI) =>
    describeOpenState(outletOpenState(hours, at(dayOfWeek, hhmm)), formatClock);

  it('tells a guest what they need to know, in the reference’s voice', () => {
    expect(say(3, '21:00')).toBe('Kitchen open until 1am');
    expect(say(3, '00:30')).toBe('Kitchen open until 1am');
    expect(say(3, '03:00')).toBe('The kitchen opens at 7am');
  });

  it('names the day when it is not today', () => {
    const notTuesday = KESARI.filter((h) => h.dayOfWeek !== 2);
    expect(say(2, '21:00', notTuesday)).toBe('The kitchen opens Wednesday at 7am');
  });

  it('says something even with no hours configured', () => {
    expect(describeOpenState(outletOpenState([], at(3, '21:00')), formatClock))
      .toBe('The kitchen is closed');
  });
});
