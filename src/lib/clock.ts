/**
 * Property-local time.
 *
 * CLAUDE.md "Dates": everything is stored as `timestamptz`, and anything a
 * human sees is rendered in the property's timezone (`properties.timezone`),
 * never the server's. Availability windows and business-day rollovers are
 * property-local — which means "what day is it, and how far into it are we"
 * has to be answered in the hotel's own timezone, not the container's.
 *
 * Pure and injectable: every function takes the instant. Nothing here reads the
 * clock, so the behaviour at 00:30 on a Sunday in Udaipur is testable from a
 * laptop in any timezone.
 */

/** Minutes since local midnight, plus which local day it is. 0 = Sunday. */
export interface LocalTime {
  dayOfWeek: number;
  minutes: number;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Where an instant falls in a property's week.
 *
 * `Intl` rather than arithmetic on a UTC offset: India is +5:30 today and that
 * is stable, but a property in a DST timezone is not, and an offset baked into
 * a calculation is wrong twice a year for a day.
 */
export function localTimeAt(instant: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const dayOfWeek = DAYS.indexOf(get('weekday'));
  // `hour12: false` yields 24 for midnight in some ICU versions, not 00.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  if (dayOfWeek < 0 || Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new RangeError(`Could not read local time in ${timeZone}`);
  }

  return { dayOfWeek, minutes: hour * 60 + minute };
}

/** `'07:00'` → 420. Throws rather than guessing — this parses stored data. */
export function parseClock(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  const hour = Number(m?.[1]);
  const minute = Number(m?.[2]);

  if (!m || hour > 23 || minute > 59) {
    throw new RangeError(`Not a time of day: ${hhmm}`);
  }
  return hour * 60 + minute;
}

/** 420 → `'07:00'`. The storage format, for writing back. */
export function toClock(minutes: number): string {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  return `${String(hour).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/**
 * `'23:30'` → `'11:30pm'`, `'01:00'` → `'1am'`, `'12:00'` → `'noon'`.
 *
 * The design reference's voice: "Kitchen open until 11:30pm", "Out Thursday,
 * 11am". Whole hours drop the minutes — "1:00am" reads like a timetable.
 */
export function formatClock(hhmm: string): string {
  const total = parseClock(hhmm);
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;

  if (minute === 0 && hour24 === 12) return 'noon';
  if (minute === 0 && hour24 === 0) return 'midnight';

  const meridiem = hour24 < 12 ? 'am' : 'pm';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return minute === 0
    ? `${hour12}${meridiem}`
    : `${hour12}:${String(minute).padStart(2, '0')}${meridiem}`;
}

/** For "opens Thursday at 7am". */
export function dayName(dayOfWeek: number): string {
  return DAYS[((dayOfWeek % 7) + 7) % 7]!;
}

/**
 * "Thursday, 11am" — the reference's own words for when a guest is due out.
 *
 * Rendered in the PROPERTY's timezone: a guest due out at 11am in Udaipur must
 * not read 5:30am because the server is in UTC. A whole hour drops its minutes,
 * the same rule `formatClock` follows.
 *
 * This lived inline on the room home until the stay screen needed the same
 * sentence. Two copies of a date format is how one of them quietly starts
 * saying 11:00am.
 */
export function formatCheckoutDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  })
    .format(instant)
    .replace(/\s?([ap])m/i, (_, meridiem: string) => `${meridiem.toLowerCase()}m`)
    .replace(/:00(?=[ap]m)/i, '');
}

/**
 * The same instant, short enough for a column.
 *
 * "Sun 5:30am" rather than "Sunday, 5:30am". The front desk reads this as one
 * cell in a table of thirty-four rooms, where a weekday spelled in full either
 * truncates or takes the width the guest's name needs; a guest reads the long
 * form in a sentence about their own stay, and keeps it.
 */
export function formatCheckoutShort(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  })
    .format(instant)
    .replace(/\s?([ap])m/i, (_, meridiem: string) => `${meridiem.toLowerCase()}m`)
    .replace(/:00(?=[ap]m)/i, '')
    .replace(',', '');
}

/**
 * How many nights are left, counted in property-local calendar days.
 *
 * Calendar days rather than 24-hour blocks, because that is what a night is: a
 * guest due out at 11am tomorrow has one night left at 9pm tonight AND at 1am
 * tonight, and dividing elapsed milliseconds gives 0 for one of them.
 *
 * Never negative — an overstayed guest reads "Checking out today", not
 * "-1 nights left".
 */
export function nightsUntil(now: Date, checkoutAt: Date, timeZone: string): number {
  return Math.max(0, localDayNumber(checkoutAt, timeZone) - localDayNumber(now, timeZone));
}

/**
 * A property-local date as a day count, for subtracting one from another.
 *
 * Built from the formatted Y-M-D rather than from the epoch, so it is the
 * hotel's calendar day and not the server's — the whole point of this file.
 */
function localDayNumber(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);

  const utcMidnight = Date.UTC(get('year'), get('month') - 1, get('day'));
  if (Number.isNaN(utcMidnight)) throw new RangeError(`Could not read local date in ${timeZone}`);
  return Math.round(utcMidnight / 86_400_000);
}

/**
 * The narrow date column on a folio line — "12 Mar".
 *
 * Property-local, because a charge posted at 00:30 on Thursday in Udaipur is a
 * Thursday charge on the bill and not a Wednesday one.
 */
export function formatFolioDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', timeZone,
  }).format(instant);
}

/** "Two nights left." — spelled to ten, digits above, the way the copy reads. */
const NUMBER_WORDS = [
  'No', 'One', 'Two', 'Three', 'Four', 'Five',
  'Six', 'Seven', 'Eight', 'Nine', 'Ten',
];

export function spellCount(value: number): string {
  return NUMBER_WORDS[value] ?? String(value);
}

/**
 * The instant at a given property-local hour on the same local day as a
 * reference instant.
 *
 * "Checkout at 2pm" is an hour in the hotel's own day, and turning that into a
 * `timestamptz` is the one bit of date arithmetic this product cannot avoid.
 * Done by measuring the reference's local time-of-day and shifting by the
 * difference, rather than by building a date string and parsing it back — the
 * second approach needs a timezone-aware parser, and `new Date('2026-03-12
 * 14:00')` is parsed in the SERVER's zone, which is exactly the bug this file
 * exists to prevent.
 *
 * The one case it cannot handle is a DST transition falling between the
 * reference and the target on the same day: the shift is measured in wall-clock
 * minutes and applied as elapsed minutes, so an hour would be lost or gained.
 * India has no DST, and for a property that does the error is bounded by one
 * hour on two days a year, on a checkout time a human then confirms. Worth
 * knowing; not worth a date library yet.
 */
export function atLocalHourOnSameDay(
  reference: Date,
  hour: number,
  timeZone: string,
): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Hour must be 0–23, got ${hour}`);
  }
  const local = localTimeAt(reference, timeZone);
  const deltaMinutes = hour * 60 - local.minutes;

  /**
   * Landed on the top of the hour, not on the reference's seconds.
   *
   * `localTimeAt` resolves to whole minutes, so shifting by whole minutes leaves
   * the reference's seconds and milliseconds intact — "checkout at 2pm" came out
   * as 14:00:00.837 for a reference taken at 09:37:00.837. Harmless to read and
   * quietly wrong everywhere else: `scheduled_checkout_at` carried meaningless
   * sub-minute precision, and two calls a millisecond apart produced two
   * different 2pms, which is a comparison nobody expects to fail.
   */
  const shifted = reference.getTime() + deltaMinutes * 60_000;
  return new Date(shifted - (shifted % 60_000));
}

/**
 * "2pm", "11am" — the way the reference writes an hour.
 *
 * Takes no timezone, deliberately: the input is already a property-local hour
 * number, so there is nothing left to convert and a timezone argument here would
 * only invite somebody to pass one and expect it to mean something.
 */
export function formatHour(hour: number): string {
  // Built from a known UTC midnight so the formatting is about the NUMBER, not
  // about any particular day.
  const at = new Date(Date.UTC(2000, 0, 1, hour, 0, 0));
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC',
  })
    .format(at)
    .replace(/\s?([ap])m/i, (_, meridiem: string) => `${meridiem.toLowerCase()}m`)
    .replace(/:00(?=[ap]m)/i, '');
}
