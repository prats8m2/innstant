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
