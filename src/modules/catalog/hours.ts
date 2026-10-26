import { parseClock, dayName, addDays, type LocalTime } from '@/lib/clock';

/**
 * When the kitchen is open. Pure — no database, no clock.
 *
 * ─── Why this existed as a hardcoded string until now ──────────────────────
 *
 * `outlet_hours` has been written by `provisionProperty()` since S6 and read by
 * NOTHING. Both guest screens said "Kitchen open until 11:30pm" in markup, while
 * the seeded rows said 07:00–01:00. Two sources of truth, one of them a literal,
 * and the wrong one was on the screen.
 *
 * ─── The representation ────────────────────────────────────────────────────
 *
 * One row per day the outlet opens. A day with NO row is a day it does not
 * open — there is no `is_closed` column and there does not need to be, and
 * "closed on Tuesdays" must not be encoded as `00:00`–`00:00`.
 *
 * `crossesMidnight` is explicit rather than inferred from `closesAt < opensAt`
 * (see the column comment in schema/catalog.ts). A kitchen open 07:00–01:00 is
 * open at half past midnight on the strength of YESTERDAY's row, which is the
 * case a naive comparison gets wrong in the direction that matters: telling a
 * guest at 00:30 that the kitchen is shut when it is not.
 */

export interface OutletHoursDay {
  /** 0 = Sunday, as the column stores it. */
  dayOfWeek: number;
  /** `HH:MM`, property-local. */
  opensAt: string;
  closesAt: string;
  crossesMidnight: boolean;
}

export interface OutletOpenState {
  isOpen: boolean;
  /** `HH:MM` the current window ends — only when open. */
  closesAt: string | null;
  /** When it next opens — only when closed. `today` drives the wording. */
  nextOpen: { dayOfWeek: number; opensAt: string; today: boolean } | null;
}

const WEEK = 7 * 1440;

/** A window in minutes-since-Sunday-midnight, which may run past the week's end. */
interface Window {
  start: number;
  end: number;
  closesAt: string;
  opensAt: string;
  dayOfWeek: number;
}

function windowsFor(hours: readonly OutletHoursDay[]): Window[] {
  const windows: Window[] = [];

  for (const day of hours) {
    if (day.dayOfWeek < 0 || day.dayOfWeek > 6) continue;

    const opens = parseClock(day.opensAt);
    const closes = parseClock(day.closesAt);
    const duration = day.crossesMidnight
      ? 1440 - opens + closes
      : closes - opens;

    // A non-crossing window that ends before it starts is bad data, not a
    // 23-hour service. Skipping it means the outlet reads as closed then,
    // which is the safe direction: a guest is told to call rather than sent
    // an order nobody is there to cook.
    if (duration <= 0) continue;

    const start = day.dayOfWeek * 1440 + opens;
    windows.push({
      start,
      end: start + duration,
      closesAt: day.closesAt,
      opensAt: day.opensAt,
      dayOfWeek: day.dayOfWeek,
    });
  }

  return windows.sort((a, b) => a.start - b.start);
}

export function outletOpenState(
  hours: readonly OutletHoursDay[],
  at: LocalTime,
): OutletOpenState {
  const windows = windowsFor(hours);
  if (!windows.length) return { isOpen: false, closesAt: null, nextOpen: null };

  const now = at.dayOfWeek * 1440 + at.minutes;

  for (const w of windows) {
    // `now + WEEK` catches a Saturday-night window that runs into Sunday: it
    // ends past the week's end, and Sunday 00:30 is early in the week, not late.
    if ((now >= w.start && now < w.end) || (now + WEEK >= w.start && now + WEEK < w.end)) {
      return { isOpen: true, closesAt: w.closesAt, nextOpen: null };
    }
  }

  const next = windows.find((w) => w.start > now) ?? windows[0]!;
  return {
    isOpen: false,
    closesAt: null,
    nextOpen: {
      dayOfWeek: next.dayOfWeek,
      opensAt: next.opensAt,
      today: next.dayOfWeek === at.dayOfWeek && next.start > now,
    },
  };
}

/**
 * The line the guest reads. One sentence, and it says what to do next rather
 * than only what is wrong (CLAUDE.md "Errors").
 *
 * Takes the formatter so this file stays free of presentation choices, and so
 * `formatClock` lives in one place.
 */
export function describeOpenState(
  state: OutletOpenState,
  format: (hhmm: string) => string,
): string {
  if (state.isOpen && state.closesAt) {
    return `Kitchen open until ${format(state.closesAt)}`;
  }
  if (!state.nextOpen) return 'The kitchen is closed';

  return state.nextOpen.today
    ? `The kitchen opens at ${format(state.nextOpen.opensAt)}`
    : `The kitchen opens ${dayName(state.nextOpen.dayOfWeek)} at ${format(state.nextOpen.opensAt)}`;
}


/**
 * Whether a time-boxed thing is showing right now.
 *
 * `collections.available_from` / `available_until` exist so that "After 10pm"
 * can be literal — and, like `outlet_hours`, they were written by the seeder
 * (22:00–01:00) and ignored by the read, so the collection appeared at
 * breakfast. Second instance of the same bug, same fix: a pure function, and a
 * caller that passes property-local time.
 *
 * A window that ends before it starts crosses midnight. There is no flag here,
 * unlike `outlet_hours`, because there is no day-of-week to be ambiguous
 * against: 22:00–01:00 can only mean one thing.
 *
 * Either bound missing means unbounded on that side. Both missing means always,
 * which is what a collection with no window is.
 */
export function isWithinWindow(
  availableFrom: string | null,
  availableUntil: string | null,
  at: LocalTime,
): boolean {
  if (!availableFrom && !availableUntil) return true;

  const now = at.minutes;
  const from = availableFrom ? parseClock(availableFrom) : null;
  const until = availableUntil ? parseClock(availableUntil) : null;

  if (from !== null && until !== null) {
    // Same-day window, or one that runs past midnight.
    return until > from
      ? now >= from && now < until
      : now >= from || now < until;
  }

  if (from !== null) return now >= from;
  return now < until!;
}

/* ── Menus on a schedule (D-084) ────────────────────────────────────────── */

/** Everything that decides when a collection is on the guest's menu. */
export interface CollectionSchedule {
  availableFrom: string | null;
  availableUntil: string | null;
  /** 0 = Sunday. Null (or empty) is every day. */
  daysOfWeek: readonly number[] | null;
  /** Property-local `YYYY-MM-DD`, inclusive. Null is an open end. */
  startsOn: string | null;
  endsOn: string | null;
}

/**
 * Which day's service a moment belongs to, for this schedule.
 *
 * `isWithinWindow()` needed no notion of this while collections had only a
 * time of day. With days and dates (migration 0010) it matters: "Friday,
 * 22:00–01:00" must still be on at 00:30, when the clock already says
 * Saturday. A window that runs past midnight belongs to the day it STARTED,
 * the same rule `outlet_hours.crosses_midnight` encodes for the kitchen.
 */
function serviceDay(schedule: CollectionSchedule, at: LocalTime): LocalTime {
  const { availableFrom: from, availableUntil: until } = schedule;
  if (!from || !until) return at;
  const start = parseClock(from);
  const end = parseClock(until);
  const crosses = end <= start;
  if (!crosses || at.minutes >= end) return at;
  return {
    dayOfWeek: (at.dayOfWeek + 6) % 7,
    minutes: at.minutes,
    ...(at.date ? { date: addDays(at.date, -1) } : {}),
  };
}

function runsOnDay(schedule: CollectionSchedule, day: LocalTime): boolean {
  if (schedule.daysOfWeek?.length && !schedule.daysOfWeek.includes(day.dayOfWeek)) return false;
  if (schedule.startsOn || schedule.endsOn) {
    // A date range with no date to test it against stays off: see LocalTime.date.
    if (!day.date) return false;
    if (schedule.startsOn && day.date < schedule.startsOn) return false;
    if (schedule.endsOn && day.date > schedule.endsOn) return false;
  }
  return true;
}

/**
 * Whether a collection is on the guest's menu at this moment.
 *
 * The time window first, then the day the moment belongs to (see
 * `serviceDay`), then that day against the days of the week and the dates.
 * `YYYY-MM-DD` strings compare correctly as strings, so no Date is built.
 */
export function isCollectionLive(schedule: CollectionSchedule, at: LocalTime): boolean {
  if (!isWithinWindow(schedule.availableFrom, schedule.availableUntil, at)) return false;
  return runsOnDay(schedule, serviceDay(schedule, at));
}

/**
 * Where a collection stands, for the console. The guest only needs
 * live-or-not; a manager needs to know WHY it is not showing, because
 * "later today", "not on Tuesdays" and "it ended on the 5th" each call for
 * a different thing to do.
 */
export type ScheduleState =
  | { kind: 'live' }
  | { kind: 'later'; from: string }
  | { kind: 'not-today' }
  | { kind: 'upcoming'; startsOn: string }
  | { kind: 'ended'; endedOn: string };

export function scheduleState(schedule: CollectionSchedule, at: LocalTime): ScheduleState {
  if (isCollectionLive(schedule, at)) return { kind: 'live' };

  if (at.date && schedule.endsOn && at.date > schedule.endsOn) {
    return { kind: 'ended', endedOn: schedule.endsOn };
  }
  if (at.date && schedule.startsOn && at.date < schedule.startsOn) {
    return { kind: 'upcoming', startsOn: schedule.startsOn };
  }

  // On today's days and dates, but outside the window: is the window still
  // ahead of us today?
  if (runsOnDay(schedule, at) && schedule.availableFrom
    && parseClock(schedule.availableFrom) > at.minutes) {
    return { kind: 'later', from: schedule.availableFrom };
  }
  return { kind: 'not-today' };
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The schedule in words: "Every day · 22:00–01:00", "Sat, Sun · 11:00–15:30",
 * "Today only", "1 Nov – 5 Nov". What the board's cards and the collections
 * page print, so the two never describe one schedule two ways.
 */
export function describeSchedule(schedule: CollectionSchedule, today?: string): string {
  const parts: string[] = [];

  const { startsOn, endsOn } = schedule;
  if (startsOn && endsOn && startsOn === endsOn) {
    parts.push(startsOn === today ? 'Today only' : `${shortDate(startsOn)} only`);
  } else if (startsOn && endsOn) {
    parts.push(`${shortDate(startsOn)} – ${shortDate(endsOn)}`);
  } else if (startsOn) {
    parts.push(`From ${shortDate(startsOn)}`);
  } else if (endsOn) {
    parts.push(`Until ${shortDate(endsOn)}`);
  }

  const days = schedule.daysOfWeek?.length ? [...schedule.daysOfWeek].sort() : null;
  if (days && days.length < 7) {
    const weekend = days.length === 2 && days[0] === 0 && days[1] === 6;
    const weekdays = days.length === 5 && days.every((d, i) => d === i + 1);
    parts.push(weekend ? 'Weekends' : weekdays ? 'Weekdays' : days.map((d) => SHORT_DAYS[d]).join(', '));
  } else if (!startsOn && !endsOn) {
    parts.push('Every day');
  }

  if (schedule.availableFrom && schedule.availableUntil) {
    parts.push(`${schedule.availableFrom}–${schedule.availableUntil}`);
  } else {
    parts.push('all day');
  }

  return parts.join(' · ');
}

/** `2026-11-05` → `5 Nov`. A bare date, so UTC and no zone can shift it. */
function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y!, m! - 1, d!)));
}


/**
 * Today's window, whatever the time is now.
 *
 * `outletOpenState()` answers "is it open, and until when" — the live question.
 * This answers "when is it open today", which is what a menu footer says: the
 * two are complementary, and printing the live line twice on one screen was how
 * an e2e caught this being a duplicate rather than a second fact.
 *
 * Returns the row for the day the guest is currently in, not the row whose
 * window covers this instant — at 00:30 the kitchen is open on yesterday's row,
 * but "today's hours" still means today's.
 */
export function hoursForDay(
  hours: readonly OutletHoursDay[],
  dayOfWeek: number,
): OutletHoursDay | null {
  return hours.find((h) => h.dayOfWeek === dayOfWeek) ?? null;
}

/**
 * A dish's own schedule. `menu_item_availability_windows`.
 *
 * Distinct from the `is_available` kill switch a kitchen flips mid-service (the
 * schema says so in a comment, and it is the right distinction): this is
 * "breakfast stops at 10:30", written once and then true every day. The switch
 * is "we are out of sole", true for one evening.
 *
 * Written by nothing and read by nothing until now — the third and last of the
 * stored-and-ignored columns the sweep turned up.
 *
 * `dayOfWeek: null` means every day. A window whose end is before its start
 * crosses midnight, exactly as a collection's does.
 */
export interface ItemAvailabilityWindow {
  /** null = every day. 0 = Sunday. */
  dayOfWeek: number | null;
  startsAt: string;
  endsAt: string;
}

export function isItemOnNow(
  windows: readonly ItemAvailabilityWindow[],
  at: LocalTime,
): boolean {
  // No schedule is the common case and means "always", not "never". Getting
  // this the wrong way round would empty every menu in the product.
  if (!windows.length) return true;

  return windows.some((w) => {
    if (w.dayOfWeek === null) return isWithinWindow(w.startsAt, w.endsAt, at);

    const opens = parseClock(w.startsAt);
    const closes = parseClock(w.endsAt);
    // Equal start and end is a data error, and `closes <= opens` would read it
    // as a full 24 hours — the widest possible reading of a mistake. Contribute
    // nothing instead: the dish then looks off, which is visible and fixable,
    // rather than on all week, which is not. Rejected on write as well.
    if (closes === opens) return false;

    const duration = closes < opens ? 1440 - opens + closes : closes - opens;

    const start = w.dayOfWeek * 1440 + opens;
    const end = start + duration;
    const now = at.dayOfWeek * 1440 + at.minutes;

    // `now + WEEK` catches a Saturday window running into Sunday — the same
    // wraparound the outlet hours have.
    return (now >= start && now < end) || (now + WEEK >= start && now + WEEK < end);
  });
}
