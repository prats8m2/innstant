'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { checkOutGuest, type DeskState } from '../rooms/actions';
import styles from '../admin.module.css';
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
  propertyId,
  rows,
  mayCheckOut,
  maySeeGuest,
}: {
  propertyId: string;
  rows: DueView[];
  mayCheckOut: boolean;
  maySeeGuest: boolean;
}) {
  return (
    <section className={styles.section} aria-labelledby="due-out">
      <header className={styles.sectionHead}>
        <h2 id="due-out" className={styles.sectionTitle}>Due out today</h2>
        <p className={styles.sectionBlurb}>Earliest first. Anyone past their time is still in the room.</p>
      </header>
      {rows.length ? (
        <ul className={l.rows}>
          {rows.map((row) => (
            <li key={row.stayId} className={l.row} data-departure={row.roomNumber} data-overdue={row.overdue}>
              <span className={`${l.room} tabular`}>{row.roomNumber}</span>
              <span className={l.who}>
                <Guest row={row} maySeeGuest={maySeeGuest} />
                <span className={l.meta}>
                  {row.overdue ? <strong className={l.late}>Overdue · was due {row.time}</strong> : `Due ${row.time}`}
                  {row.open ? <span className={l.open}> · {row.open} still open</span> : null}
                </span>
              </span>
              <Balance balance={row.balance} owes={row.owes} />
              <span className={l.actions}>
                {row.owes && maySeeGuest ? (
                  <Link href={`/admin/guests/${row.guestId}`} className={styles.secondary}>Take payment</Link>
                ) : null}
                {mayCheckOut ? <CheckOut propertyId={propertyId} stayId={row.stayId} roomNumber={row.roomNumber} /> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.sectionEmpty}>Nobody else is due out today.</p>
      )}
    </section>
  );
}

export function LeftToday({ rows, maySeeGuest }: { rows: LeftView[]; maySeeGuest: boolean }) {
  if (!rows.length) return null;
  return (
    <section className={styles.section} aria-labelledby="left-today">
      <header className={styles.sectionHead}>
        <h2 id="left-today" className={styles.sectionTitle}>Left today</h2>
        <p className={styles.sectionBlurb}>Anything still on a bill stays there until it is paid.</p>
      </header>
      <ul className={l.rows}>
        {rows.map((row) => (
          <li key={row.stayId} className={l.row} data-left={row.roomNumber}>
            <span className={`${l.room} tabular`}>{row.roomNumber}</span>
            <span className={l.who}>
              <Guest row={row} maySeeGuest={maySeeGuest} />
              <span className={l.meta}>Left {row.leftAt}</span>
            </span>
            <Balance balance={row.balance} owes={row.owes} unpaid />
            <span className={l.actions}>
              {row.owes && maySeeGuest ? (
                <Link href={`/admin/guests/${row.guestId}`} className={styles.secondary}>Take payment</Link>
              ) : null}
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
  return (
    <span className={`${l.balance} tabular`} data-owes={owes}>
      {owes ? (unpaid ? `${balance} unpaid` : balance) : balance === null ? 'nothing charged' : 'settled'}
    </span>
  );
}

function CheckOut({ propertyId, stayId, roomNumber }: { propertyId: string; stayId: string; roomNumber: string }) {
  const [state, action] = useActionState<DeskState, FormData>(checkOutGuest, {});
  return (
    <form action={action} className={l.inline}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="stayId" value={stayId} />
      <CheckOutButton roomNumber={roomNumber} />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function CheckOutButton({ roomNumber }: { roomNumber: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={styles.primary}
      disabled={pending}
      aria-label={`Check out ${roomNumber}`}
    >
      {pending ? '…' : 'Check out'}
    </button>
  );
}
