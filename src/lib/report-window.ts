import { sql, type SQL } from 'drizzle-orm';

/**
 * The period a report covers — the console overview's Today / 7 days / 30 days.
 *
 * Every boundary is the PROPERTY's calendar (CLAUDE.md "Dates"): "today" starts
 * at the hotel's midnight, not the server's, and is worked out in SQL with
 * `AT TIME ZONE` so the container's clock and zone never enter it.
 *
 *   today  local midnight → now, in hours. Compared with the same weekday a
 *          week ago, up to the same time of day: at 10am, Monday's ₹4,200
 *          against last Monday's ₹31,000 for the WHOLE day reads as a disaster,
 *          when the honest comparison is against last Monday by 10am. A week
 *          rather than yesterday because a hotel's week has a shape — Sunday
 *          is not a Monday.
 *   7d     the last seven local days including today, in days; compared with
 *          the seven before, again up to the same time of day.
 *   30d    the same with thirty.
 *
 * The previous window is the current one moved back by `shiftDays` on the
 * hotel's wall clock (`local - N days`, then back to an instant), so a DST
 * change between the two lands on the right local hour.
 */
export const REPORT_RANGES = ['today', '7d', '30d'] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];

export interface ReportWindow {
  range: ReportRange;
  timeZone: string;
  /** Local days covered, today included. */
  days: number;
  /** How far back the comparison window sits. */
  shiftDays: number;
  bucket: 'hour' | 'day';
  /** 24 hourly buckets for today; one per day otherwise. */
  buckets: number;
}

export function parseReportRange(value: unknown): ReportRange {
  const v = Array.isArray(value) ? value[0] : value;
  return REPORT_RANGES.includes(v as ReportRange) ? (v as ReportRange) : 'today';
}

export function reportWindow(range: ReportRange, timeZone: string): ReportWindow {
  if (range === 'today') {
    return { range, timeZone, days: 1, shiftDays: 7, bucket: 'hour', buckets: 24 };
  }
  const days = range === '7d' ? 7 : 30;
  return { range, timeZone, days, shiftDays: days, bucket: 'day', buckets: days };
}

/**
 * The bucket "now" falls in: the hotel's current hour for today, the last day
 * otherwise. Buckets after it have not happened yet.
 */
export function currentBucket(window: ReportWindow, localMinutes: number): number {
  return window.bucket === 'hour' ? Math.floor(localMinutes / 60) : window.buckets - 1;
}

export interface WindowSql {
  /** Start of the window as a local wall-clock `timestamp` (no zone). */
  localStart: SQL;
  /** Start and end as instants (`timestamptz`). End is "now", moved back for the previous window. */
  start: SQL;
  end: SQL;
  /** The bucket index (0-based int) a `timestamptz` column falls in. */
  bucketOf: (column: SQL) => SQL;
  /** The instant that closes bucket `i`, capped at the window's end. */
  bucketEnd: (index: SQL) => SQL;
}

/**
 * The window as SQL fragments, for a service function to drop into its query.
 * `now()` is the transaction's start, so every query in one `withTenant()`
 * agrees on what "now" is.
 */
export function windowSql(window: ReportWindow, which: 'current' | 'previous'): WindowSql {
  const tz = window.timeZone;
  const shift = which === 'previous' ? window.shiftDays : 0;
  const localNow = sql`((now() AT TIME ZONE ${tz}) - make_interval(days => ${shift}::int))`;
  const localStart = sql`(date_trunc('day', ${localNow}) - make_interval(days => ${window.days - 1}::int))`;
  const end = sql`(${localNow} AT TIME ZONE ${tz})`;
  const step = window.bucket === 'hour' ? sql`interval '1 hour'` : sql`interval '1 day'`;
  return {
    localStart,
    start: sql`(${localStart} AT TIME ZONE ${tz})`,
    end,
    bucketOf: (column) => (window.bucket === 'hour'
      ? sql`extract(hour FROM ${column} AT TIME ZONE ${tz})::int`
      : sql`((${column} AT TIME ZONE ${tz})::date - ${localStart}::date)::int`),
    bucketEnd: (index) => sql`LEAST(${end}, ((${localStart} + (${index} + 1) * ${step}) AT TIME ZONE ${tz}))`,
  };
}

/** A zeroed series, one slot per bucket. */
export function emptySeries(window: ReportWindow): number[] {
  return Array.from({ length: window.buckets }, () => 0);
}
