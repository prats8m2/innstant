'use client';

import { useState } from 'react';
import styles from './admin.module.css';

/**
 * Orders by the hour, today against yesterday, in the hotel's own hours.
 *
 * Today is the columns, in the accent; yesterday is a thin grey tick at its
 * own height in the same hour, a reference rather than a second series
 * competing for the eye. Columns are capped at 24px with a rounded top and a
 * square foot on one baseline; gridlines are hairlines; text stays in the
 * text colours, never the bar's. Hover or focus an hour for its numbers, and
 * the same figures are a table for anyone who cannot use the picture.
 *
 * HTML rather than SVG, so it reflows with the card at any width without
 * scaling its own text.
 */
export function OrdersByHour({
  today,
  yesterday,
  nowHour,
}: {
  today: number[];
  yesterday: number[];
  /** The hotel's current hour: later hours have nothing yet and say so. */
  nowHour: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const peak = Math.max(1, ...today, ...yesterday);
  const top = niceCeiling(peak);
  const pct = (n: number) => `${(n / top) * 100}%`;
  const busiest = today.indexOf(Math.max(...today));
  const totalToday = today.reduce((n, x) => n + x, 0);

  const summary = totalToday
    ? `${totalToday} ${totalToday === 1 ? 'order' : 'orders'} so far today, the busiest hour ${label(busiest)}.`
    : 'No orders yet today.';

  return (
    <figure className={styles.hourChart}>
      <div className={styles.hourLegend} aria-hidden="true">
        <span><span className={styles.hourSwatch} /> Today</span>
        <span><span className={styles.hourTickKey} /> Yesterday</span>
      </div>

      <div className={styles.hourPlot} role="img" aria-label={`Orders by hour. ${summary}`}>
        <span className={styles.hourGrid} style={{ bottom: '100%' }}><span>{top}</span></span>
        <span className={styles.hourGrid} style={{ bottom: '50%' }}><span>{top / 2}</span></span>
        <span className={styles.hourGrid} style={{ bottom: '0%' }}><span>0</span></span>

        {today.map((count, hour) => (
          <div
            key={hour}
            className={styles.hourSlot}
            data-future={hour > nowHour || undefined}
            data-active={active === hour || undefined}
            tabIndex={0}
            aria-label={`${label(hour)}: ${count} today, ${yesterday[hour]} yesterday`}
            onMouseEnter={() => setActive(hour)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(hour)}
            onBlur={() => setActive(null)}
          >
            {count ? <span className={styles.hourBar} style={{ height: pct(count) }} /> : null}
            {yesterday[hour] ? (
              <span className={styles.hourTick} style={{ bottom: pct(yesterday[hour]!) }} />
            ) : null}
            {active === hour ? (
              <span className={styles.hourTip} role="tooltip">
                <strong>{label(hour)}</strong>
                <span>{count} today</span>
                <span>{yesterday[hour]} yesterday</span>
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div className={styles.hourAxis} aria-hidden="true">
        {today.map((_, hour) => (
          <span key={hour}>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>
        ))}
      </div>

      <figcaption className={styles.hourCaption}>{summary}</figcaption>

      <details className={styles.hourTable}>
        <summary>Show as a table</summary>
        <table>
          <thead><tr><th>Hour</th><th>Today</th><th>Yesterday</th></tr></thead>
          <tbody>
            {today.map((count, hour) => (count || yesterday[hour] ? (
              <tr key={hour}>
                <td className="tabular">{label(hour)}</td>
                <td className="tabular">{count}</td>
                <td className="tabular">{yesterday[hour]}</td>
              </tr>
            ) : null))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function label(hour: number): string {
  const h = String(hour).padStart(2, '0');
  return `${h}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`;
}

/** A round top for the scale: 1, 2, 4, 6, 8, 10, 20, 40… */
function niceCeiling(n: number): number {
  if (n <= 2) return 2;
  if (n <= 10) return Math.ceil(n / 2) * 2;
  const step = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / step) * step;
}
