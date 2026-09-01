import { parseClock, dayName, type LocalTime } from '@/lib/clock';

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
