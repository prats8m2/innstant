/**
 * The overview's arithmetic — pure, so every number on the KPI row is tested
 * without a database (kpis.test.ts). Amounts are integer minor units (#5);
 * nothing here formats money.
 */
import { addDays, dayName, dayOfWeekOf, formatHour } from '@/lib/clock';
import type { ReportRange, ReportWindow } from '@/lib/report-window';

/** Buckets 0..`upto` — the part of the period that has happened. */
export function soFar(series: readonly number[], upto: number): number[] {
  return series.slice(0, Math.max(0, upto) + 1);
}

export function sum(series: readonly number[]): number {
  return series.reduce((total, n) => total + n, 0);
}

/** Running totals — today's sparkline climbs through the day. */
export function cumulative(series: readonly number[]): number[] {
  let running = 0;
  return series.map((n) => (running += n));
}

/** Bucket by bucket, a + b. The two must be the same length. */
export function addSeries(a: readonly number[], b: readonly number[]): number[] {
  return a.map((n, i) => n + (b[i] ?? 0));
}

/** A whole percentage, or null with nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/**
 * What a sparkline draws for a period. Today: running totals by the hour, so
 * the line is the day so far. 7 and 30 days: one value per day.
 */
export function trend(series: readonly number[], range: ReportRange, upto: number): number[] {
  const happened = soFar(series, upto);
  return range === 'today' ? cumulative(happened) : happened;
}

/**
 * A rate as a sparkline: the running rate through today, or each day's rate.
 * A bucket with nothing to divide carries the last known rate forward rather
 * than dropping to zero — "nothing finished at 3am" is not "0% on time".
 * Leading empty buckets are dropped; with no rate at all the line is empty.
 */
export function rateTrend(
  part: readonly number[],
  whole: readonly number[],
  range: ReportRange,
  upto: number,
): number[] {
  const p = range === 'today' ? cumulative(soFar(part, upto)) : soFar(part, upto);
  const w = range === 'today' ? cumulative(soFar(whole, upto)) : soFar(whole, upto);
  const out: number[] = [];
  let last: number | null = null;
  for (let i = 0; i < w.length; i++) {
    const rate: number | null = w[i]! > 0 ? (p[i]! / w[i]!) * 100 : last;
    if (rate === null) continue;
    out.push(rate);
    last = rate;
  }
  return out;
}

/**
 * Occupancy over the period, as a whole percentage of sellable rooms.
 * Today: rooms in house now. 7 and 30 days: the average night — room-nights
 * in house divided by room-nights there were to sell.
 */
export function occupancyPercent(
  inHouse: readonly number[],
  range: ReportRange,
  upto: number,
  rooms: number,
): number | null {
  const happened = soFar(inHouse, upto);
  if (!rooms || !happened.length) return null;
  if (range === 'today') return percent(happened[happened.length - 1]!, rooms);
  return percent(sum(happened), rooms * happened.length);
}

export type DeltaKind =
  /** Relative change, for money: "12.2%". */
  | 'relative'
  /** Absolute change, for a count: "6". */
  | 'count'
  /** Change in percentage points, for a rate: "3 pts". */
  | 'points';

export interface Delta {
  direction: 'up' | 'down' | 'flat' | 'none';
  /** What the pill shows, without the arrow. Empty with nothing to compare. */
  text: string;
}

/**
 * The change against the previous period. Higher is better for every number
 * on the overview, so "up" is good and "down" is the warning tone.
 * `none` when there is nothing to compare with — no previous figure, or a
 * relative change from zero, which has no honest percentage.
 */
export function delta(kind: DeltaKind, current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return { direction: 'none', text: '' };
  const diff = current - previous;
  if (kind === 'relative') {
    if (previous === 0) return current === 0 ? { direction: 'flat', text: '0%' } : { direction: 'none', text: '' };
    const change = Math.round((diff / previous) * 1000) / 10;
    if (change === 0) return { direction: 'flat', text: '0%' };
    return { direction: change > 0 ? 'up' : 'down', text: `${Math.abs(change).toFixed(1)}%` };
  }
  if (diff === 0) return { direction: 'flat', text: kind === 'points' ? '0 pts' : '0' };
  const size = Math.abs(diff);
  return {
    direction: diff > 0 ? 'up' : 'down',
    text: kind === 'points' ? `${size} ${size === 1 ? 'pt' : 'pts'}` : `${size}`,
  };
}

/** "vs last Monday", "vs the 7 days before". */
export function comparisonLabel(window: ReportWindow, todayDate: string): string {
  if (window.range === 'today') return `vs last ${dayName(dayOfWeekOf(todayDate))}`;
  return `vs the ${window.days} days before`;
}

/** The label under a bar: "7am" for an hour, "Mon 2" for a day. */
export function bucketLabel(window: ReportWindow, index: number, todayDate: string): string {
  if (window.bucket === 'hour') return formatHour(index);
  const date = addDays(todayDate, index - (window.days - 1));
  return `${dayName(dayOfWeekOf(date)).slice(0, 3)} ${Number(date.slice(8, 10))}`;
}

/** The long form, for a tooltip and the table: "7am–8am", "Monday 2 November". */
export function bucketTitle(window: ReportWindow, index: number, todayDate: string): string {
  if (window.bucket === 'hour') return `${formatHour(index)}–${formatHour((index + 1) % 24)}`;
  const date = addDays(todayDate, index - (window.days - 1));
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`));
  return `${dayName(dayOfWeekOf(date))} ${Number(date.slice(8, 10))} ${month}`;
}

/**
 * A sparkline's polyline points in a `width`×`height` box, with `pad` above
 * and below so a 2px stroke is not clipped. A flat series draws a flat line
 * through the middle; a single value is a flat line too, not a dot.
 */
export function sparkPoints(values: readonly number[], width: number, height: number, pad = 3): string {
  if (!values.length) return '';
  const series = values.length === 1 ? [values[0]!, values[0]!] : values;
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min;
  const step = width / (series.length - 1);
  return series
    .map((v, i) => {
      const y = span === 0 ? height / 2 : height - pad - ((v - min) / span) * (height - pad * 2);
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

/**
 * A round top for a chart's scale, so its gridlines land on numbers a person
 * would say, and whose half is one too (the chart draws a line at half):
 * 2, 4, 6, 8, 10, 12, 16, 20, 30, 40… times a power of ten. Never below
 * `floor`.
 */
export function niceCeiling(n: number, floor = 2): number {
  const value = Math.max(n, floor);
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10]) {
    const top = step * power;
    // A top whose half is a whole number (counts and minor units both are).
    if (value <= top && Number.isInteger(top / 2)) return top;
  }
  return 10 * power;
}

/** One line of a CSV, quoted where it has to be. */
export function csvLine(cells: readonly (string | number)[]): string {
  return cells
    .map((cell) => {
      const text = String(cell);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(',');
}

/** Minor units as a plain decimal for a spreadsheet: 1234550 → "12345.50". */
export function minorToDecimal(minor: number, minorUnits = 2): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const unit = 10 ** minorUnits;
  return `${sign}${Math.floor(abs / unit)}.${String(abs % unit).padStart(minorUnits, '0')}`;
}
