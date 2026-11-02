'use client';

import Link from 'next/link';
import { AlarmClock } from 'lucide-react';
import ui from '../rooms/controls.module.css';
import l from './leaving.module.css';

/**
 * Today's departures (D-094). Every string arrives formatted from the server
 * (#5, and no `modules/*` value in a client bundle).
 *
 * Room numbers are printed bare, never as "Room 210": the late-checkout queue
 * above names its rows that way and is found by it.
 */
export interface DueView {
  stayId: string;
  guestId: string;
  guestName: string;
  roomNumber: string;
  floorName: string;
  /** "11am" — today, so no weekday. */
  time: string;
  /** Their time has passed and they are still checked in. */
  overdue: boolean;
  /** Null when nothing was ever charged. */
  balance: string | null;
  owes: boolean;
  /** "1 order, 2 requests" — what is still on its way to the room. */
  open: string | null;
}

export interface LeftView {
  stayId: string;
  guestId: string;
  guestName: string;
  roomNumber: string;
  leftAt: string;
  balance: string | null;
  owes: boolean;
}

export function DueOut({
  rows,
  mayCheckOut,
  maySeeGuest,
}: {
  rows: DueView[];
  mayCheckOut: boolean;
  maySeeGuest: boolean;
}) {
  return (
    <section className={`${ui.card} ${l.section}`} aria-labelledby="due-out">
      <header className={l.sectionHead}>
        <h2 id="due-out" className={l.sectionTitle}>Due out today <span className={`${l.sectionCount} tabular`}>{rows.length}</span></h2>
        <p className={l.sectionBlurb}>Earliest first. Anyone past their time is still in the room.</p>
      </header>
      {rows.length ? (
        <ul className={l.rows}>
          {rows.map((row) => (
            <li key={row.stayId} className={l.row} data-departure={row.roomNumber} data-overdue={row.overdue}>
              <span className={`${l.room} tabular`}>{row.roomNumber}</span>
              <span className={l.who}>
                <Guest row={row} maySeeGuest={maySeeGuest} />
                <span className={l.meta}>
                  {row.overdue ? (
                    <>
                      <span className={ui.pill} data-tone="crit"><AlarmClock size={12} strokeWidth={1.75} aria-hidden="true" />Late</span>
                      <span>was due <span className="tabular">{row.time}</span></span>
                    </>
                  ) : <span>Due <span className="tabular">{row.time}</span></span>}
                  {row.open ? <span className={l.open}>{row.open} still open</span> : null}
                </span>
              </span>
              <Balance balance={row.balance} owes={row.owes} />
              <span className={l.actions}>
                {/* Straight to the bill (D-095): checking out is reviewing
                    it, settling it and closing it, on one screen. */}
                {mayCheckOut ? (
                  <Link href={`/admin/checkouts/${row.stayId}`} className={`${ui.btn} ${ui.primary}`} aria-label={`Check out ${row.roomNumber}`}>
                    {row.owes ? 'Settle and check out' : 'Check out'}
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={l.sectionEmpty}>Nobody else is due out today.</p>
      )}
    </section>
  );
}

export function LeftToday({ rows, maySeeGuest }: { rows: LeftView[]; maySeeGuest: boolean }) {
  if (!rows.length) return null;
  return (
    <section className={`${ui.card} ${l.section}`} aria-labelledby="left-today">
      <header className={l.sectionHead}>
        <h2 id="left-today" className={l.sectionTitle}>Left today <span className={`${l.sectionCount} tabular`}>{rows.length}</span></h2>
        <p className={l.sectionBlurb}>Anything still on a bill stays there until it is paid.</p>
      </header>
      <ul className={l.rows}>
        {rows.map((row) => (
          <li key={row.stayId} className={l.row} data-left={row.roomNumber}>
            <span className={`${l.room} tabular`}>{row.roomNumber}</span>
            <span className={l.who}>
              <Guest row={row} maySeeGuest={maySeeGuest} />
              <span className={l.meta}><span>Left <span className="tabular">{row.leftAt}</span></span></span>
            </span>
            <Balance balance={row.balance} owes={row.owes} unpaid />
            <span className={l.actions}>
              {/* The bill stays open after they leave; it is collected on
                  the same screen. */}
              <Link href={`/admin/checkouts/${row.stayId}`} className={ui.btn}>
                {row.owes ? 'Collect' : 'Bill'}
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Guest({ row, maySeeGuest }: { row: { guestId: string; guestName: string }; maySeeGuest: boolean }) {
  return maySeeGuest
    ? <Link href={`/admin/guests/${row.guestId}`} className={l.name}>{row.guestName}</Link>
    : <span className={l.name}>{row.guestName}</span>;
}

function Balance({ balance, owes, unpaid = false }: { balance: string | null; owes: boolean; unpaid?: boolean }) {
  // A status is a colour and a word: "Owes ₹2,410", "Settled".
  if (owes) {
    return (
      <span className={l.balance}>
        <span className={ui.pill} data-tone={unpaid ? 'crit' : 'warn'}>
          {unpaid ? 'Left owing' : 'Owes'} <span className="tabular">{balance}</span>
        </span>
      </span>
    );
  }
  return (
    <span className={l.balance}>
      {balance === null ? 'nothing charged' : <span className={ui.pill} data-tone="pos">Settled</span>}
    </span>
  );
}
