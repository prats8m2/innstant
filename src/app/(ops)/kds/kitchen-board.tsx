'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { KitchenTicket, OrderStatus } from '@/modules/ordering';
import { setDishAvailability, type BumpState } from './actions';
import { LiveTickets } from './live-tickets';
import { TicketCard, type TicketPermissions } from './ticket-card';
import { isNight } from './night';
import styles from './kds.module.css';

/**
 * The board: a header a cook reads across, and three columns they work down.
 *
 * Client-side because three things on this screen are genuinely local to the
 * tablet and have no business in the database:
 *
 *   - which tickets have been SEEN (see `acked` below),
 *   - whether the 86 tray is open,
 *   - what time it is, and therefore whether the room is dark.
 *
 * Everything that is a fact about the hotel — the tickets, what is 86'd —
 * arrives as a prop from the server and goes back through a Server Action.
 */

/** The three columns, and the statuses each one owns. Together: KITCHEN_OPEN_STATUSES. */
const COLUMNS: ReadonlyArray<{
  key: string;
  title: string;
  hint: string;
  empty: string;
  statuses: readonly OrderStatus[];
}> = [
  {
    key: 'new',
    title: 'New',
    hint: 'oldest first',
    empty: 'No new orders.',
    statuses: ['PLACED'],
  },
  {
    key: 'cooking',
    title: 'Cooking',
    hint: 'timer from accept',
    empty: 'Nothing on the fire.',
    // Two statuses, one column, because the difference between "we said yes"
    // and "a pan is on" matters to the machine and to the guest's tracking
    // screen, but not to where a cook looks for it.
    statuses: ['ACCEPTED', 'PREPARING'],
  },
  {
    key: 'pass',
    title: 'At the pass',
    hint: 'waiting for a runner',
    empty: 'Pass is clear.',
    statuses: ['READY'],
  },
];

export function KitchenBoard({
  propertyId,
  outletName,
  subtitle,
  timeZone,
  initialScheme,
  tickets,
  unavailable,
  permissions,
}: {
  propertyId: string;
  outletName: string;
  subtitle: string;
  /** The PROPERTY's zone. The clock on a kitchen wall is the hotel's, never the server's. */
  timeZone: string;
  /** Resolved server-side so a night kitchen does not flash white on load. */
  initialScheme: 'light' | 'dark';
  tickets: KitchenTicket[];
  unavailable: ReadonlyArray<{ id: string; name: string }>;
  permissions: TicketPermissions;
}) {
  const now = useClock();
  const scheme = useScheme(initialScheme, timeZone, now);
  const [trayOpen, setTrayOpen] = useState(false);

  /**
   * Which tickets somebody has looked at.
   *
   * Deliberately NOT a column on `orders`. "Seen" is a property of this tablet
   * at this moment, not of the order — a second screen in the pass should not
   * go quiet because the line cook glanced at the first, and nothing about the
   * guest's order changed when somebody looked at it. It buys exactly one
   * thing: a way to stop the red ring and the alert without accepting a ticket
   * the kitchen has not decided on yet, which is what a cook does when four
   * land at once and they need to read before they commit.
   *
   * Because it is a Set of ids, a ticket that arrives after the tap is not in
   * it and comes in loud, which is the whole point.
   */
  const [acked, setAcked] = useState<ReadonlySet<string>>(() => new Set());

  const placed = useMemo(() => tickets.filter((t) => t.status === 'PLACED'), [tickets]);
  const unacked = placed.filter((t) => !acked.has(t.id));

  const ackAll = useCallback(() => {
    setAcked(new Set(placed.map((t) => t.id)));
  }, [placed]);

  const byColumn = COLUMNS.map((column) => ({
    ...column,
    // `kitchenTickets()` already sorts oldest-first and the filter is stable,
    // so each column inherits that order. A board that reorders under a cook's
    // hand is a board they stop trusting.
    tickets: tickets.filter((t) => column.statuses.includes(t.status)),
  }));

  const summary = byColumn.map((c) => `${c.tickets.length} ${c.key === 'pass' ? 'at pass' : c.title.toLowerCase()}`).join(' · ');

  return (
    <main className={styles.shell} data-scheme={scheme}>
      <header className={styles.bar}>
        <div className={styles.identity}>
          <h1 className={styles.title}>{outletName}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>

        {unacked.length ? (
          <button type="button" className={styles.ack} onClick={ackAll}>
            <span className={styles.ping} aria-hidden="true">
              <span className={styles.pingRipple} />
              <span className={styles.pingDot} />
            </span>
            {/* "3 waiting", not "3 new tickets" — the same words the count in
                this bar has always used, and what the floor calls them. */}
            <span>{unacked.length} waiting</span>
            <span className={styles.ackHint}>tap to silence</span>
          </button>
        ) : (
          <p className={styles.allSeen} role="status">
            <span className={styles.seenDot} aria-hidden="true" />
            All tickets seen
          </p>
        )}

        <div className={styles.barRight}>
          {permissions.availability ? (
            <button
              type="button"
              className={styles.trayToggle}
              data-on={unavailable.length > 0}
              aria-expanded={trayOpen}
              onClick={() => setTrayOpen((open) => !open)}
            >
              86 list{unavailable.length ? ` · ${unavailable.length}` : ''}
            </button>
          ) : null}

          <div className={styles.clockStack}>
            <span className={`${styles.clock} tabular`}>{formatTime(now, timeZone)}</span>
            <span className={styles.summary}>{summary}</span>
          </div>

          <LiveTickets propertyId={propertyId} unacknowledged={placed.length} />
        </div>
      </header>

      {trayOpen && permissions.availability ? (
        <EightySixTray
          propertyId={propertyId}
          unavailable={unavailable}
        />
      ) : null}

      <div className={styles.columns}>
        {byColumn.map((column) => (
          <section key={column.key} className={styles.column} aria-labelledby={`col-${column.key}`}>
            <header className={styles.columnHead}>
              <h2 id={`col-${column.key}`} className={styles.columnTitle}>{column.title}</h2>
              <span className={`${styles.columnCount} tabular`}>{column.tickets.length}</span>
              <span className={styles.columnHint}>{column.hint}</span>
            </header>

            {column.tickets.length ? (
              <ul className={styles.columnList}>
                {column.tickets.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    propertyId={propertyId}
                    ticket={ticket}
                    now={now}
                    timeZone={timeZone}
                    fresh={ticket.status === 'PLACED' && !acked.has(ticket.id)}
                    unavailable={unavailable}
                    permissions={permissions}
                  />
                ))}
              </ul>
            ) : (
              <p className={styles.columnEmpty}>{column.empty}</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}

/**
 * The 86 tray: everything the kitchen has pulled tonight, and a way back.
 *
 * Open on demand rather than always on: on a normal night it is empty, and a
 * permanently empty strip across the top of a 1194px screen costs a row of
 * tickets to say nothing.
 */
function EightySixTray({
  propertyId,
  unavailable,
}: {
  propertyId: string;
  unavailable: ReadonlyArray<{ id: string; name: string }>;
}) {
  return (
    <div className={styles.tray}>
      <span className={styles.trayLabel}>Unavailable tonight</span>
      {unavailable.length ? (
        unavailable.map((item) => (
          <PutBack key={item.id} propertyId={propertyId} item={item} />
        ))
      ) : (
        <span className={styles.trayEmpty}>
          Everything on the menu is available. Tap 86 on any ticket line to pull a dish.
        </span>
      )}
    </div>
  );
}

function PutBack({
  propertyId,
  item,
}: {
  propertyId: string;
  item: { id: string; name: string };
}) {
  const [state, action] = useActionState<BumpState, FormData>(setDishAvailability, {});

  return (
    <form action={action} className={styles.trayForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="menuItemId" value={item.id} />
      <input type="hidden" name="available" value="true" />
      <PutBackButton name={item.name} />
      {state.error ? <span className={styles.error} role="alert">{state.error}</span> : null}
    </form>
  );
}

function PutBackButton({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={styles.trayChip} disabled={pending}>
      <span>{name}</span>
      <span className={styles.trayChipHint}>{pending ? '…' : 'put back'}</span>
    </button>
  );
}

/**
 * The board's one clock, shared by the header and every age badge.
 *
 * Twenty seconds, not one. A per-second counter on twenty tickets is twenty
 * re-renders a second on a tablet that is also the kitchen's only screen — the
 * first version of this file rejected exactly that. The board refreshes on
 * every order event anyway; this tick exists for the case a busy board is
 * showing nothing new and a ticket is quietly getting older, and 20s is fine
 * enough that a badge changes colour when it should.
 */
function useClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 20_000);
    return () => window.clearInterval(tick);
  }, []);
  return now;
}

/**
 * Day or night, from the property's clock rather than the tablet's OS setting.
 *
 * A kitchen tablet is mounted on a wall and nobody is going to change its
 * appearance setting at dusk, so `prefers-color-scheme` would leave the screen
 * bright at midnight or dim at noon. The hotel's own hours are the only signal
 * that tracks the room.
 *
 * Seeded from the server so a night kitchen does not flash white while it
 * hydrates, then re-derived on each tick so a screen that has been on since
 * lunch dims by itself at 19:00. The band itself lives in `night.ts` because
 * the server page needs it too.
 */
function useScheme(initial: 'light' | 'dark', timeZone: string, now: number): 'light' | 'dark' {
  const [scheme, setScheme] = useState(initial);
  useEffect(() => {
    setScheme(isNight(now, timeZone) ? 'dark' : 'light');
  }, [now, timeZone]);
  return scheme;
}

function formatTime(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).format(new Date(at));
}
