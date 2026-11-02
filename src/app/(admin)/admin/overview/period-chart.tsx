'use client';

import { useState } from 'react';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { niceCeiling } from './kpis';
import styles from './overview.module.css';

/**
 * Food & drink by hour (today) or by day (7 / 30 days).
 *
 * One series in the accent — the bucket "now" is in at full strength, the ones
 * before it a lighter mix — and the comparison period as a thin grey tick at
 * its own height in the same bucket: a reference, not a second set of bars
 * competing for the eye. One axis, hairline gridlines at the top and half, a
 * square foot on the baseline and a 4px round top. Text stays in the text
 * colours, never the bar's. Hover or focus a bucket for its figures; the same
 * figures are a table for anyone who cannot use the picture.
 *
 * HTML rather than SVG so it reflows with the card at any width without
 * scaling its own text.
 */
export function PeriodChart({
  unit,
  currency,
  values,
  previous,
  labels,
  titles,
  upto,
  hourly,
  currentName,
  previousName,
  previousEach,
}: {
  unit: 'money' | 'count';
  currency: CurrencyCode;
  values: number[];
  previous: number[];
  labels: string[];
  titles: string[];
  /** The bucket "now" is in; later ones have not happened. */
  upto: number;
  /** Hours trim the empty night; days show every day. */
  hourly: boolean;
  currentName: string;
  previousName: string;
  /** The comparison for ONE bucket, in a tooltip: "last Monday", "a week earlier". */
  previousEach: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const show = (n: number) => (unit === 'money'
    ? formatMoney(money(n, currency), { showDecimals: false })
    : `${n}`);

  // Today: from the first hour anything happened (6am at the latest) to now,
  // or to the last hour the comparison day had something — a night with no
  // orders is not twelve empty columns.
  let first = 0;
  let last = values.length - 1;
  if (hourly) {
    const busy = (i: number) => (values[i] ?? 0) > 0 || (previous[i] ?? 0) > 0;
    const firstBusy = values.findIndex((_, i) => busy(i));
    first = Math.min(firstBusy < 0 ? 6 : firstBusy, 6);
    let lastBusy = -1;
    for (let i = values.length - 1; i >= 0; i--) if (busy(i)) { lastBusy = i; break; }
    last = Math.max(upto, lastBusy, first);
  }
  const indexes = Array.from({ length: last - first + 1 }, (_, k) => first + k);

  const peak = Math.max(0, ...indexes.map((i) => values[i] ?? 0), ...indexes.map((i) => previous[i] ?? 0));
  const top = niceCeiling(peak, unit === 'money' ? 100_00 : 2);
  const pct = (n: number) => `${Math.min(100, (n / top) * 100)}%`;
  // Labels that fit a phone: every one for a week, every third hour, every
  // fifth day of a month — and always the bucket "now" is in.
  const every = indexes.length <= 8 ? 1 : indexes.length <= 24 ? 3 : 5;

  const busiest = indexes.reduce((best, i) => ((values[i] ?? 0) > (values[best] ?? 0) ? i : best), indexes[0] ?? 0);
  const total = values.reduce((n, v) => n + v, 0);
  const summary = total
    ? `${show(total)} in all; the busiest ${hourly ? 'hour' : 'day'} ${titles[busiest]}, with ${show(values[busiest] ?? 0)}.`
    : `Nothing yet${hourly ? ' today' : ''}.`;

  return (
    <figure className={styles.chart}>
      <div className={styles.legend} aria-hidden="true">
        <span><span className={styles.legendBar} /> {currentName}</span>
        <span><span className={styles.legendTick} /> {previousName}</span>
      </div>

      <div className={styles.plotWrap}>
        <div className={styles.yAxis} aria-hidden="true">
          <span className="tabular">{show(top)}</span>
          <span className="tabular">{show(top / 2)}</span>
          <span className="tabular">{show(0)}</span>
        </div>

        <div className={styles.plotCol}>
          <div
            className={styles.plot}
            role="group"
            aria-label={`${summary} Each ${hourly ? 'hour' : 'day'} can be focused for its figures.`}
          >
            <span className={styles.grid} style={{ bottom: '100%' }} />
            <span className={styles.grid} style={{ bottom: '50%' }} />
            {indexes.map((i, k) => {
              const v = values[i] ?? 0;
              const p = previous[i] ?? 0;
              const future = i > upto;
              return (
                <div
                  key={i}
                  className={styles.slot}
                  data-active={active === i || undefined}
                  data-side={k >= indexes.length / 2 ? 'left' : undefined}
                  tabIndex={0}
                  aria-label={`${titles[i]}: ${future ? 'not yet' : show(v)}; ${previousEach} ${show(p)}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  {v > 0 ? (
                    <span className={styles.bar} data-now={i === upto || undefined} style={{ height: pct(v) }} />
                  ) : null}
                  {p > 0 ? <span className={styles.tick} style={{ bottom: pct(p) }} /> : null}
                  {active === i ? (
                    <span className={styles.tip} role="tooltip">
                      <strong>{titles[i]}</strong>
                      <span className="tabular">{future ? 'not yet' : show(v)}</span>
                      <span className={styles.tipMuted}><span className="tabular">{show(p)}</span> {previousEach}</span>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className={styles.xAxis} aria-hidden="true">
            {indexes.map((i, k) => (
              <span key={i} className="tabular">{k % every === 0 ? labels[i] : ''}</span>
            ))}
          </div>
        </div>
      </div>

      <figcaption className={styles.srOnly}>{summary}</figcaption>

      <details className={styles.table}>
        <summary>Show as a table</summary>
        <div className={styles.tableScroll}>
          <table>
            <thead>
              <tr><th scope="col">{hourly ? 'Hour' : 'Day'}</th><th scope="col">{currentName}</th><th scope="col">{previousName}</th></tr>
            </thead>
            <tbody>
              {indexes.filter((i) => (values[i] ?? 0) || (previous[i] ?? 0)).map((i) => (
                <tr key={i}>
                  <td>{titles[i]}</td>
                  <td className="tabular">{show(values[i] ?? 0)}</td>
                  <td className="tabular">{show(previous[i] ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
