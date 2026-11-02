import { describe, expect, it } from 'vitest';
import { reportWindow } from '@/lib/report-window';
import {
  addSeries, bucketLabel, bucketTitle, comparisonLabel, csvLine, cumulative, delta,
  minorToDecimal, niceCeiling, occupancyPercent, percent, rateTrend, soFar, sparkPoints, sum, trend,
} from './kpis';

describe('the overview arithmetic', () => {
  it('counts only the buckets that have happened', () => {
    expect(soFar([1, 2, 3, 4], 1)).toEqual([1, 2]);
    expect(sum(soFar([1, 2, 3, 4], 3))).toBe(10);
    expect(soFar([5, 6], -1)).toEqual([5]);
  });

  it('adds food sales and folio revenue bucket by bucket, in minor units', () => {
    expect(addSeries([115_000, 0, 250_050], [0, 1_800_000, -5_000])).toEqual([115_000, 1_800_000, 245_050]);
  });

  it('runs totals through today and keeps days as days', () => {
    expect(cumulative([2, 0, 3])).toEqual([2, 2, 5]);
    expect(trend([2, 0, 3, 9], 'today', 2)).toEqual([2, 2, 5]);
    expect(trend([2, 0, 3, 9], '7d', 3)).toEqual([2, 0, 3, 9]);
  });

  it('rounds a rate to a whole percent, and has none without a whole', () => {
    expect(percent(37, 40)).toBe(93);
    expect(percent(0, 0)).toBeNull();
  });

  it('carries a rate forward over an empty bucket instead of dropping to zero', () => {
    // Daily: day 2 finished nothing.
    expect(rateTrend([1, 0, 3], [2, 0, 4], '7d', 2)).toEqual([50, 50, 75]);
    // Today: the running rate.
    // Running: 1 of 2, then 4 of 6.
    const running = rateTrend([0, 1, 3], [0, 2, 4], 'today', 2);
    expect(running).toHaveLength(2);
    expect(running[0]).toBe(50);
    expect(running[1]).toBeCloseTo(66.67, 1);
    expect(rateTrend([0, 0], [0, 0], '7d', 1)).toEqual([]);
  });

  it('reads occupancy as rooms in house now today, and the average night otherwise', () => {
    expect(occupancyPercent([20, 25, 29, 0], 'today', 2, 34)).toBe(85);
    // 7 nights × 34 rooms = 238 room-nights; 200 sold → 84%.
    expect(occupancyPercent([30, 30, 30, 30, 30, 25, 25], '7d', 6, 34)).toBe(84);
    expect(occupancyPercent([1], 'today', 0, 0)).toBeNull();
  });

  it('gives money a relative change, counts an absolute one and rates points', () => {
    expect(delta('relative', 13_074_000, 11_653_000)).toEqual({ direction: 'up', text: '12.2%' });
    expect(delta('relative', 90, 100)).toEqual({ direction: 'down', text: '10.0%' });
    expect(delta('relative', 100, 0)).toEqual({ direction: 'none', text: '' });
    expect(delta('relative', 0, 0)).toEqual({ direction: 'flat', text: '0%' });
    expect(delta('count', 46, 40)).toEqual({ direction: 'up', text: '6' });
    expect(delta('points', 92, 95)).toEqual({ direction: 'down', text: '3 pts' });
    expect(delta('points', 92, 91)).toEqual({ direction: 'up', text: '1 pt' });
    expect(delta('points', 80, 80)).toEqual({ direction: 'flat', text: '0 pts' });
    expect(delta('points', null, 80)).toEqual({ direction: 'none', text: '' });
  });

  it('names what it compares with in the hotel’s words', () => {
    // 2026-11-02 is a Monday.
    expect(comparisonLabel(reportWindow('today', 'Asia/Kolkata'), '2026-11-02')).toBe('vs last Monday');
    expect(comparisonLabel(reportWindow('7d', 'Asia/Kolkata'), '2026-11-02')).toBe('vs the 7 days before');
  });

  it('labels hours and days in the hotel’s calendar', () => {
    const today = reportWindow('today', 'Asia/Kolkata');
    expect(bucketLabel(today, 7, '2026-11-02')).toBe('7am');
    expect(bucketTitle(today, 23, '2026-11-02')).toBe('11pm–12am');
    const week = reportWindow('7d', 'Asia/Kolkata');
    expect(bucketLabel(week, 6, '2026-11-02')).toBe('Mon 2');
    expect(bucketLabel(week, 0, '2026-11-02')).toBe('Tue 27');
    expect(bucketTitle(week, 0, '2026-11-02')).toBe('Tuesday 27 October');
  });

  it('draws a sparkline inside its box, flat when nothing moves', () => {
    expect(sparkPoints([0, 10], 96, 32)).toBe('0.0,29.0 96.0,3.0');
    expect(sparkPoints([5, 5, 5], 96, 32)).toBe('0.0,16.0 48.0,16.0 96.0,16.0');
    expect(sparkPoints([7], 96, 32)).toBe('0.0,16.0 96.0,16.0');
    expect(sparkPoints([], 96, 32)).toBe('');
  });

  it('rounds a chart’s top to a number with a whole half', () => {
    expect(niceCeiling(3)).toBe(4);
    expect(niceCeiling(7)).toBe(8);
    expect(niceCeiling(11)).toBe(12);
    expect(niceCeiling(642_000)).toBe(800_000);
    expect(niceCeiling(0)).toBe(2);
  });

  it('writes CSV a spreadsheet reads, money as a plain decimal', () => {
    expect(csvLine(['Mon 2', 'Room 2, east', 'say "hi"'])).toBe('Mon 2,"Room 2, east","say ""hi"""');
    expect(minorToDecimal(1_234_550)).toBe('12345.50');
    expect(minorToDecimal(-505)).toBe('-5.05');
    expect(minorToDecimal(7)).toBe('0.07');
  });
});
