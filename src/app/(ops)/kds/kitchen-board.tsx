'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ListOrdered, Maximize2, Minimize2, Moon, Sun, TriangleAlert,
} from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { KitchenTicket, OrderStatus } from '@/modules/ordering';
import type { GuestThemeKey } from '@/modules/identity/branding';
import { setDishAvailability, type BumpState } from './actions';
import { LiveTickets } from './live-tickets';
import { TicketCard, isLate, type TicketPermissions } from './ticket-card';
import { clock12 } from './clock12';
import { isNight } from '../night';
import { SignOutButton } from '@/components/sign-out-button';
import { SessionWatch } from '@/components/session-watch';
import styles from './kds.module.css';

/**
 * The board: a header a cook reads across, three columns they work down, and
 * the All day panel beside them (Direction A, `Kitchen.dc.html`).
 *
 * Client-side because three things on this screen are genuinely local to the
 * tablet and have no business in the database:
 *
 *   - which tickets have been SEEN (see `acked` below),
 *   - whether the 86 tray is open,
 *   - what time it is, and therefore whether the room is dark.
 *
 * Everything that is a fact about the hotel — the tickets, what is 86'd, how
 * many portions are left — arrives as a prop from the server and goes back
 * through a Server Action.
 *
 * ─── Day and night ────────────────────────────────────────────────────────
 *
 * The board wears the CONSOLE's tokens (D-100): `data-console` light by day
 * and dark from 19:00 on the property's clock, `data-accent` from the
 * property's guest theme. theme.css re-declares every role name on
 * `[data-console]`, so the attribute on this element recomputes everything
 * below it.
 */

/** The three columns, and the statuses each one owns. Together: KITCHEN_OPEN_STATUSES. */
const COLUMNS: ReadonlyArray<{
  key: string;
  title: string;
  empty: string;
  statuses: readonly OrderStatus[];
}> = [
  {
    key: 'new',
    title: 'New',
    empty: 'No new orders.',
    statuses: ['PLACED'],
  },
  {
    key: 'cooking',
    title: 'Cooking',
    empty: 'Nothing on the fire.',
    // Two statuses, one column, because the difference between "we said yes"
    // and "a pan is on" matters to the machine and to the guest's tracking
    // screen, but not to where a cook looks for it.
    statuses: ['ACCEPTED', 'PREPARING'],
  },
  {
    key: 'pass',
    title: 'At the pass',
    empty: 'Pass is clear.',
    statuses: ['READY'],
  },
];

type Mode = 'light' | 'dark';

export function KitchenBoard({
  propertyId,
  subtitle,
  timeZone,
  initialMode,
  accent,
  promiseMinutes,
  portions,
  tickets,
  unavailable,
  permissions,
  renderedAt,
  staffUserId,
}: {
  propertyId: string;
  subtitle: string;
  /** The PROPERTY's zone. The clock on a kitchen wall is the hotel's, never the server's. */
  timeZone: string;
  /** Resolved server-side so a night kitchen does not flash white on load. */
  initialMode: Mode;
  /** The property's guest theme — the console's accent follows it. */
  accent: GuestThemeKey;
  /** The outlet's promise, in minutes — what every ticket is timed against. */
  promiseMinutes: number;
  /** Portions left today, for limited dishes on the board only (D-086). */
  portions: ReadonlyArray<{ menuItemId: string; left: number }>;
  tickets: KitchenTicket[];
  unavailable: ReadonlyArray<{ id: string; name: string }>;
  permissions: TicketPermissions;
  /** The server's clock at render — the first tick, so hydration agrees. */
  renderedAt: number;
  /** Who this screen was drawn for — so another tab signing out is noticed. */
  staffUserId: string;
}) {
  const now = useClock(renderedAt);
  const mode = useMode(initialMode, timeZone, now);
  useDocumentConsole(mode, accent);
  const [trayOpen, setTrayOpen] = useState(false);
  const [allDayOpen, setAllDayOpen] = useState(true);
  const fullscreen = useFullscreen();

  /**
   * Which dish lines a cook has struck through on this tablet (D-089).
   *
   * Local for the same reason `acked` is: "the dal is plated, the lassi is
   * not" is a note on this screen, not a fact about the order, and a second
   * screen at the pass must not lose its own notes because the line cook
   * tapped here. Keyed `ticketId:lineIndex`.
   */
  const [struck, setStruck] = useState<ReadonlySet<string>>(() => new Set());
  const toggleLine = useCallback((key: string) => {
    setStruck((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  /**
   * Which tickets somebody has looked at.
   *
   * Deliberately NOT a column on `orders`. "Seen" is a property of this tablet
   * at this moment, not of the order — a second screen in the pass should not
   * go quiet because the line cook glanced at the first, and nothing about the
   * guest's order changed when somebody looked at it. It buys exactly one
   * thing: a way to stop the ring and the alert without accepting a ticket
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

  const late = tickets.filter((t) => isLate(t, now)).length;
  const oldest = tickets
    .filter((t) => t.placedAt && t.status !== 'READY')
    .map((t) => Math.round((now - new Date(t.placedAt!).getTime()) / 60_000))
    .reduce((max, minutes) => Math.max(max, minutes), -1);

  /**
   * "All day": every dish still to make, totalled across the tickets in New
   * and Cooking — the number a cook batches by ("four laal maas"), which no
   * single ticket shows. Struck lines are left out: they are made.
   *
   * Keyed by the dish where there is one, so the portions-left note below can
   * find it; by name for a line whose dish has since been archived.
   */
  const allDay = useMemo(() => {
    const totals = new Map<string, {
      key: string; menuItemId: string | null; name: string; quantity: number; tickets: number;
    }>();
    for (const ticket of tickets) {
      if (ticket.status === 'READY') continue;
      ticket.lines.forEach((line, i) => {
        if (struck.has(`${ticket.id}:${i}`)) return;
        const key = line.menuItemId ?? `name:${line.name}`;
        const entry = totals.get(key)
          ?? { key, menuItemId: line.menuItemId, name: line.name, quantity: 0, tickets: 0 };
        entry.quantity += line.quantity;
        entry.tickets += 1;
        totals.set(key, entry);
      });
    }
    return [...totals.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
  }, [tickets, struck]);

  /**
   * "Safed maas: last one tonight." From the dish's daily limit (D-086), for
   * a limited dish with two or fewer portions left after what is on the
   * board — a dish with no limit has no entry and says nothing.
   */
  const lastCalls = useMemo(() => {
    const left = new Map(portions.map((p) => [p.menuItemId, p.left]));
    return allDay.flatMap((dish) => {
      const remaining = dish.menuItemId ? left.get(dish.menuItemId) : undefined;
      if (remaining === undefined || remaining > 2) return [];
      if (remaining > 0) return [`${dish.name}: ${remaining} left tonight`];
      return [dish.quantity === 1
        ? `${dish.name}: last one tonight`
        : `${dish.name}: last ${dish.quantity} tonight`];
    });
  }, [allDay, portions]);

  return (
    <main
      className={styles.shell}
      data-console={mode}
      data-accent={accent}
    >
      <header className={styles.bar}>
        <div className={styles.identity}>
          <h1 className={styles.title}>Kitchen</h1>
          <p className={styles.subtitle}>{subtitle}</p>
        </div>

        <div className={styles.clockStack}>
          <span className={`${styles.clock} tabular`}>{clock12(now, timeZone)}</span>
          <span className={styles.mode}>
            {mode === 'dark'
              ? <Moon size={14} aria-hidden="true" />
              : <Sun size={14} aria-hidden="true" />}
            {mode === 'dark' ? 'Night mode · auto after 7pm' : 'Day mode'}
          </span>
        </div>

        <div className={styles.load}>
          <p className={styles.loadLine}>
            <span className="tabular">{tickets.length}</span> open · promise{' '}
            <span className="tabular">{promiseMinutes}</span> min
          </p>
          <p className={styles.loadSub}>
            {late ? (
              // Late is a colour, a word and a mark — never the colour alone.
              <span className={styles.lateCount}>
                <TriangleAlert size={14} strokeWidth={2.4} aria-hidden="true" />
                <span className="tabular">{late}</span> late
              </span>
            ) : null}
            {oldest >= 0 ? (
              <span>oldest <span className="tabular">{oldest}m</span></span>
            ) : null}
            <LiveTickets propertyId={propertyId} unacknowledged={placed.length} />
          </p>
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
          <button
            type="button"
            className={styles.trayToggle}
            aria-pressed={allDayOpen}
            onClick={() => setAllDayOpen((open) => !open)}
          >
            <ListOrdered size={18} aria-hidden="true" />
            All day
          </button>

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

          {fullscreen.supported ? (
            <button
              type="button"
              className={styles.iconButton}
              onClick={fullscreen.toggle}
              aria-label={fullscreen.on ? 'Leave full screen' : 'Full screen'}
              title={fullscreen.on ? 'Leave full screen' : 'Full screen — hides the browser bars'}
            >
              {fullscreen.on ? <Minimize2 size={20} aria-hidden="true" /> : <Maximize2 size={20} aria-hidden="true" />}
            </button>
          ) : null}

          <SignOutButton className={styles.iconButton} />
          <SessionWatch staffUserId={staffUserId} />
        </div>
      </header>

      {trayOpen && permissions.availability ? (
        <EightySixTray
          propertyId={propertyId}
          unavailable={unavailable}
        />
      ) : null}

      <div className={styles.board} data-all-day={allDayOpen}>
        {byColumn.map((column) => (
          <section
            key={column.key}
            className={styles.column}
            data-column={column.key}
            aria-labelledby={`col-${column.key}`}
          >
            <header className={styles.columnHead}>
              <h2 id={`col-${column.key}`} className={styles.columnTitle}>{column.title}</h2>
              <span className={`${styles.columnCount} tabular`}>{column.tickets.length}</span>
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
                    struck={struck}
                    onToggleLine={toggleLine}
                  />
                ))}
              </ul>
            ) : (
              <p className={styles.columnEmpty}>{column.empty}</p>
            )}
          </section>
        ))}

        {allDayOpen ? (
          <aside className={styles.allDay} aria-labelledby="all-day-title">
            <h2 id="all-day-title" className={styles.columnTitle}>All day</h2>
            {allDay.length ? (
              <ul className={styles.allDayList}>
                {allDay.map((dish) => (
                  <li key={dish.key} className={styles.allDayRow}>
                    <span className={styles.allDayName}>
                      {dish.name}
                      {dish.tickets > 1 ? (
                        <span className={styles.allDayTickets}>
                          {' '}· <span className="tabular">{dish.tickets}</span> tickets
                        </span>
                      ) : null}
                    </span>
                    <span className={`${styles.allDayQty} tabular`}>{dish.quantity}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.allDayEmpty}>Nothing to make.</p>
            )}
            {lastCalls.length ? (
              <div className={styles.lastCalls}>
                {lastCalls.map((note) => <p key={note}>{note}</p>)}
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </main>
  );
}

/**
 * The 86 tray: everything the kitchen has pulled tonight, and a way back.
 *
 * Open on demand rather than always on: on a normal night it is empty, and a
 * permanently empty strip across the top of the board costs a row of tickets
 * to say nothing.
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
 * enough that a badge changes colour when it should. It is also why the
 * timers read in whole minutes rather than the board's m:ss.
 */
function useClock(renderedAt: number): number {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
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
function useMode(initial: Mode, timeZone: string, now: number): Mode {
  const [mode, setMode] = useState(initial);
  useEffect(() => {
    setMode(isNight(now, timeZone) ? 'dark' : 'light');
  }, [now, timeZone]);
  return mode;
}

/**
 * `<html>` kept in step with the board while it is open, and put back on the
 * way out — so the page's overscroll and the full-screen backdrop are the
 * board's ground, not the default light console's. The same thing the
 * console's frame does for a person's light or dark.
 */
function useDocumentConsole(mode: Mode, accent: GuestThemeKey): void {
  useEffect(() => {
    const root = document.documentElement;
    const before = {
      console: root.getAttribute('data-console'),
      accent: root.getAttribute('data-accent'),
    };
    root.setAttribute('data-console', mode);
    root.setAttribute('data-accent', accent);
    return () => {
      if (before.console) root.setAttribute('data-console', before.console);
      else root.removeAttribute('data-console');
      if (before.accent) root.setAttribute('data-accent', before.accent);
      else root.removeAttribute('data-accent');
    };
  }, [mode, accent]);
}

/**
 * Full screen, for a tablet on a wall: the browser's own bars are a strip of
 * the board that shows nothing. Not offered where the API is missing (iOS
 * Safari on a phone).
 */
function useFullscreen(): { supported: boolean; on: boolean; toggle: () => void } {
  const [supported, setSupported] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    setSupported(typeof document.documentElement.requestFullscreen === 'function');
    const sync = () => setOn(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);
  return { supported, on, toggle };
}
