import { formatMoney, money } from '@/lib/money';
import styles from '../admin.module.css';

/**
 * What has happened to a dish, newest first, in words: the dish page and the
 * menu studio's side panel both show it, so it is written once.
 */
export function DishHistory({ events }: { events: readonly Record<string, unknown>[] }) {
  if (!events.length) return null;
  return (
    <section className={styles.history}>
      <h2 className={styles.historyTitle}>What has happened to it</h2>
      <ol className={styles.historyList}>
        {events.slice().reverse().map((event, i) => (
          <li key={`${event.occurred_at as string}-${i}`} className={styles.historyRow}>
            <span className={`${styles.historyWhen} tabular`}>
              {new Date(event.occurred_at as string).toISOString().slice(0, 16).replace('T', ' ')}
            </span>
            <span className={styles.historyWhat}>{describe(event)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The log, in words.
 *
 * Only the event types the catalog writes. Anything unrecognised prints its
 * raw type rather than being swallowed, because a silently dropped audit row
 * is worse than an ugly one.
 */
function describe(event: Record<string, unknown>): string {
  const type = String(event.event_type);
  const payload = (event.payload ?? {}) as Record<string, unknown>;

  if (type === 'menu_item.repriced') {
    const from = Number(payload.fromMinor);
    const to = Number(payload.toMinor);
    const currency = (payload.currency as 'INR') ?? 'INR';
    return `Repriced from ${formatMoney(money(from, currency))} to ${formatMoney(money(to, currency))}`;
  }

  // Dragged into another section on the menu studio's board.
  if (type === 'menu_item.moved') {
    return payload.from && payload.to
      ? `Moved from ${String(payload.from)} to ${String(payload.to)}`
      : 'Moved to another section';
  }

  // D-086.
  if (type === 'menu_item.daily_limit_set') {
    return payload.dailyLimit
      ? `Limited to ${String(payload.dailyLimit)} a day`
      : 'Daily limit removed';
  }

  if (type === 'menu_item.created' && payload.copiedFrom) return 'Added as a copy of another dish';

  return {
    'menu_item.created': 'Added to the menu',
    'menu_item.updated': 'Edited',
    'menu_item.available': 'Put back on',
    'menu_item.unavailable': 'Taken off for the night',
    'menu_item.archived': 'Taken off the menu',
  }[type] ?? type;
}
