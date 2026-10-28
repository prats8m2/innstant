import { describe, expect, it } from 'vitest';
import {
  describeSchedule, isCollectionLive, scheduleState, type CollectionSchedule,
} from './hours';

// Wednesday 28 October 2026, and the days either side.
const WED = '2026-10-28';
const at = (dayOfWeek: number, hhmm: string, date?: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return { dayOfWeek, minutes: h! * 60 + m!, ...(date ? { date } : {}) };
};

const always: CollectionSchedule = {
  availableFrom: null, availableUntil: null, daysOfWeek: null, startsOn: null, endsOn: null,
};

describe('isCollectionLive', () => {
  it('a collection with no schedule is always on, date or no date', () => {
    expect(isCollectionLive(always, at(3, '09:00'))).toBe(true);
    expect(isCollectionLive(always, at(3, '09:00', WED))).toBe(true);
  });

  it('honours the days of the week', () => {
    const weekends = { ...always, daysOfWeek: [0, 6] };
    expect(isCollectionLive(weekends, at(6, '12:00', '2026-10-31'))).toBe(true);
    expect(isCollectionLive(weekends, at(3, '12:00', WED))).toBe(false);
  });

  it('a late window belongs to the day it started', () => {
    // Friday only, 22:00–01:00. At 00:30 the clock says Saturday.
    const fridayLate = { ...always, availableFrom: '22:00', availableUntil: '01:00', daysOfWeek: [5] };
    expect(isCollectionLive(fridayLate, at(5, '23:00', '2026-10-30'))).toBe(true);
    expect(isCollectionLive(fridayLate, at(6, '00:30', '2026-10-31'))).toBe(true);
    // And Thursday's tail is not Friday's, even though the clock says Friday.
    expect(isCollectionLive(fridayLate, at(5, '00:30', '2026-10-30'))).toBe(false);
    expect(isCollectionLive(fridayLate, at(6, '23:00', '2026-10-31'))).toBe(false);
  });

  it('holds to its dates, inclusive at both ends', () => {
    const diwali = { ...always, startsOn: '2026-11-01', endsOn: '2026-11-05' };
    expect(isCollectionLive(diwali, at(0, '12:00', '2026-11-01'))).toBe(true);
    expect(isCollectionLive(diwali, at(4, '23:59', '2026-11-05'))).toBe(true);
    expect(isCollectionLive(diwali, at(6, '23:59', '2026-10-31'))).toBe(false);
    expect(isCollectionLive(diwali, at(5, '00:00', '2026-11-06'))).toBe(false);
  });

  it('a late window on its last date runs past midnight into the next', () => {
    const lastNight = { ...always, availableFrom: '22:00', availableUntil: '01:00', endsOn: WED };
    expect(isCollectionLive(lastNight, at(4, '00:30', '2026-10-29'))).toBe(true);
    expect(isCollectionLive(lastNight, at(4, '22:30', '2026-10-29'))).toBe(false);
  });

  it('stays off when it has dates and the moment has none', () => {
    const today = { ...always, startsOn: WED, endsOn: WED };
    expect(isCollectionLive(today, at(3, '12:00'))).toBe(false);
  });
});

describe('scheduleState', () => {
  it('says why it is not showing', () => {
    const breakfast = { ...always, availableFrom: '07:00', availableUntil: '10:30' };
    expect(scheduleState(breakfast, at(3, '08:00', WED))).toEqual({ kind: 'live' });
    expect(scheduleState(breakfast, at(3, '06:00', WED))).toEqual({ kind: 'later', from: '07:00' });
    expect(scheduleState(breakfast, at(3, '12:00', WED))).toEqual({ kind: 'not-today' });

    const diwali = { ...always, startsOn: '2026-11-01', endsOn: '2026-11-05' };
    expect(scheduleState(diwali, at(3, '12:00', WED))).toEqual({ kind: 'upcoming', startsOn: '2026-11-01' });
    expect(scheduleState(diwali, at(1, '12:00', '2026-11-09'))).toEqual({ kind: 'ended', endedOn: '2026-11-05' });

    const weekends = { ...always, daysOfWeek: [0, 6] };
    expect(scheduleState(weekends, at(3, '12:00', WED))).toEqual({ kind: 'not-today' });
  });
});

describe('describeSchedule', () => {
  it('reads like a menu would say it', () => {
    expect(describeSchedule(always)).toBe('Every day · all day');
    expect(describeSchedule({ ...always, availableFrom: '22:00', availableUntil: '01:00' }))
      .toBe('Every day · 22:00–01:00');
    expect(describeSchedule({ ...always, daysOfWeek: [6, 0], availableFrom: '11:00', availableUntil: '15:30' }))
      .toBe('Weekends · 11:00–15:30');
    expect(describeSchedule({ ...always, daysOfWeek: [1, 2, 3, 4, 5] })).toBe('Weekdays · all day');
    expect(describeSchedule({ ...always, daysOfWeek: [0] })).toBe('Sun · all day');
    expect(describeSchedule({ ...always, startsOn: WED, endsOn: WED }, WED)).toBe('Today only · all day');
    expect(describeSchedule({ ...always, startsOn: WED, endsOn: WED }, '2026-10-27')).toBe('28 Oct only · all day');
    expect(describeSchedule({ ...always, startsOn: '2026-11-01', endsOn: '2026-11-05' }))
      .toBe('1 Nov – 5 Nov · all day');
  });
});
