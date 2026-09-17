'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { checkInGuest, checkOutGuest, vouchForRoom, type DeskState } from './actions';
import { GuestLink } from './guest-link';
import styles from '../admin.module.css';

/**
 * The key rack.
 *
 * Every string is formatted on the server — a client component importing a value
 * from a `modules/*` index drags `pg` into the browser bundle, and money
 * formatting belongs in one place (#5).
 */
export interface RoomView {
  id: string;
  number: string;
  floorName: string;
  roomTypeName: string | null;
  /** Null when this account lacks `qr:read`. */
  qr: { publicCode: string; url: string | null } | null;
  stay: {
    id: string;
    guestId: string;
    guestName: string;
    guestPhone: string | null;
    dueOut: string;
    nightsLeft: number;
    /** Null when nothing has ever been charged — not the same as ₹0. */
    balance: string | null;
    owes: boolean;
  } | null;
}

export interface DeskPermissions {
  checkIn: boolean;
  checkOut: boolean;
  vouch: boolean;
  /** `qr:regenerate` — kills the sticker on the nightstand. */
  reprintQr: boolean;
}

export function RoomBoard({
  propertyId,
  rooms,
  checkoutHours,
  permissions,
}: {
  propertyId: string;
  rooms: RoomView[];
  checkoutHours: number[];
  permissions: DeskPermissions;
}) {
  const floors = [...new Set(rooms.map((room) => room.floorName))];

  return (
    <>
      {floors.map((floor) => (
        <section key={floor} className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{floor}</h2>
          </header>
          {/* The list owns the tracks; every row borrows them (`subgrid`). */}
          <ul className={`${styles.dishes} ${styles.roomTable}`}>
            <RoomsHead />
            {rooms.filter((room) => room.floorName === floor).map((room) => (
              <Room
                key={room.id}
                propertyId={propertyId}
                room={room}
                checkoutHours={checkoutHours}
                permissions={permissions}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/**
 * One room, as a table row.
 *
 * Explicit cells rather than "whatever children happen to be here", because the
 * desk reads DOWN this list: thirty-four rooms whose guest name starts at a
 * different x each line is thirty-four separate searches. The grid template is
 * in `.roomRow`, and `RoomsHead` prints the same tracks as a header.
 *
 * It also fixes the shape that made every empty room two lines tall — the
 * check-in disclosure was the third child of a two-column grid, so it wrapped.
 */
function Room({
  propertyId,
  room,
  checkoutHours,
  permissions,
}: {
  propertyId: string;
  room: RoomView;
  checkoutHours: number[];
  permissions: DeskPermissions;
}) {
  const stay = room.stay;

  return (
    <li
      className={`${styles.dish} ${styles.roomRow}`}
      /* A stable hook for a desk's Ctrl-F and for the e2e suite: the room number
         is inside a name that changes the moment somebody checks in. */
      data-room={room.number}
      data-occupied={stay ? 'true' : 'false'}
    >
      <span className={styles.roomCell}>
        <span className={`${styles.roomNumber} tabular`}>{room.number}</span>
        <span className={styles.roomType}>{room.roomTypeName ?? 'Room'}</span>
      </span>

      <span className={styles.roomCell}>
        {stay ? (
          <>
            {/* Straight to what the desk needs when a guest rings down about a
                charge, or when something has gone wrong. */}
            <Link href={`/admin/guests/${stay.guestId}`} className={styles.guestName}>
              {stay.guestName}
            </Link>
            {stay.guestPhone ? (
              <span className={styles.roomMeta}>{stay.guestPhone}</span>
            ) : null}
          </>
        ) : (
          <span className={styles.roomEmpty}>empty</span>
        )}
      </span>

      <span className={styles.roomCell}>
        {stay ? (
          <>
            {/* Zero nights left is today, which is the only value a desk scans
                this column for — so it says so rather than printing a date. */}
            <span className={stay.nightsLeft === 0 ? styles.dueToday : styles.roomMeta}>
              {stay.nightsLeft === 0 ? 'out today' : stay.dueOut}
            </span>
          </>
        ) : null}
      </span>

      {/*
        * Deliberately not saffron. Nearly every guest owes something in the
        * middle of their stay, and colouring all of them would light the whole
        * board up — saffron means "somebody needs to do something" everywhere
        * else in this console. The number is enough here, and the check-out
        * button's own title says it again before the desk presses it.
        *
        * "nothing yet" rather than ₹0: a guest who has bought nothing and one
        * who has paid up look different to a desk.
        */}
      <span className={`${styles.roomBalance} tabular`}>
        {stay ? stay.balance ?? 'nothing yet' : null}
      </span>

      {/* The sticker's own link, whoever is in the room and whether anybody is —
          a desk reprints stickers for empty rooms more often than full ones. */}
      <span className={styles.roomSticker}>
        {room.qr ? (
          <GuestLink
            propertyId={propertyId}
            roomId={room.id}
            roomNumber={room.number}
            publicCode={room.qr.publicCode}
            url={room.qr.url}
            mayReprint={permissions.reprintQr}
            occupied={stay != null}
          />
        ) : null}
      </span>

      <span className={styles.roomActions}>
        {stay
          ? <Occupied propertyId={propertyId} room={room} permissions={permissions} />
          : permissions.checkIn
            ? <CheckIn propertyId={propertyId} room={room} checkoutHours={checkoutHours} />
            : null}
      </span>
    </li>
  );
}

/**
 * The column names, printed once per floor.
 *
 * `aria-hidden` and not a `<th>`: this is a list of rooms, not a data table —
 * each row's own text already names what it holds ("out today", "₹15,680"), and
 * a screen reader hearing six column names before every floor would be read a
 * header it cannot use to navigate. It is a sighted-scanning aid.
 */
function RoomsHead() {
  return (
    <li className={`${styles.dish} ${styles.roomRow} ${styles.rowHead}`} aria-hidden="true">
      <span>Room</span>
      <span>Guest</span>
      <span>Due out</span>
      <span className={styles.roomBalance}>Balance</span>
      <span>Sticker</span>
      <span />
    </li>
  );
}

function Occupied({
  propertyId,
  room,
  permissions,
}: {
  propertyId: string;
  room: RoomView;
  permissions: DeskPermissions;
}) {
  const stay = room.stay!;

  return (
    <>
      {permissions.vouch ? (
        <Vouch propertyId={propertyId} stayId={stay.id} roomNumber={room.number} />
      ) : null}
      {permissions.checkOut ? (
        <CheckOut propertyId={propertyId} stay={stay} roomNumber={room.number} />
      ) : null}
    </>
  );
}

function CheckIn({
  propertyId,
  room,
  checkoutHours,
}: {
  propertyId: string;
  room: RoomView;
  checkoutHours: number[];
}) {
  const [state, action] = useActionState<DeskState, FormData>(checkInGuest, {});

  return (
    <details className={styles.roomForm}>
      <summary className={styles.disclosureHead}>Check someone in</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="roomId" value={room.id} />

        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <input name="fullName" className={styles.input} required maxLength={160} />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Phone</span>
            <input
              name="phone"
              className={styles.input}
              inputMode="tel"
              maxLength={32}
              placeholder="+91…"
            />
            {/* The identity key (EXTENSION-POINTS §2), and what the guest answers
                the one verification prompt with (D-012). */}
            <span className={styles.hint}>
              How a returning guest is recognised, and what they verify with.
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Nights</span>
            <input
              name="nights"
              type="number"
              min={1}
              max={60}
              defaultValue={1}
              className={styles.input}
              required
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Out at</span>
            <select name="checkoutHour" defaultValue={11} className={styles.input}>
              {checkoutHours.map((hour) => (
                <option key={hour} value={hour}>
                  {hour > 12 ? `${hour - 12}pm` : `${hour}am`}
                </option>
              ))}
            </select>
          </label>
        </div>

        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}

        <SubmitButton label={`Check in to ${room.number}`} primary />
      </form>
    </details>
  );
}

function CheckOut({
  propertyId,
  stay,
  roomNumber,
}: {
  propertyId: string;
  stay: NonNullable<RoomView['stay']>;
  roomNumber: string;
}) {
  const [state, action] = useActionState<DeskState, FormData>(checkOutGuest, {});

  return (
    <form action={action} className={styles.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="stayId" value={stay.id} />
      <SubmitButton
        label="Check out"
        title={
          stay.owes
            ? `${stay.balance} is still on room ${roomNumber}. Take it at the desk first.`
            : `Free room ${roomNumber} and end every session on it`
        }
      />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

/**
 * D-012's front-desk bypass: the guest sees no prompt at all.
 *
 * Its own permission (`guest:vouch`) rather than folded into `guest:update`,
 * because it escalates a guest session with zero guest-side interaction. Grants
 * CHARGE and not FULL (D-031) — vouching for who somebody is lets them charge to
 * the room; it does not hand over their bill.
 */
function Vouch({
  propertyId,
  stayId,
  roomNumber,
}: {
  propertyId: string;
  stayId: string;
  roomNumber: string;
}) {
  const [state, action] = useActionState<DeskState, FormData>(vouchForRoom, {});

  return (
    <details className={styles.roomForm}>
      <summary className={styles.disclosureHead}>Vouch</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="stayId" value={stayId} />

        <label className={styles.field}>
          <span className={styles.label}>How you know it is them</span>
          <input
            name="reason"
            className={styles.input}
            maxLength={200}
            placeholder="Confirmed passport at the desk"
          />
          <span className={styles.hint}>
            Room {roomNumber} can then charge to the room without being asked.
            They still answer the question themselves to see their bill.
          </span>
        </label>

        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}

        <SubmitButton label="Vouch for them" />
      </form>
    </details>
  );
}

function SubmitButton({
  label,
  title,
  primary = false,
}: {
  label: string;
  title?: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primary ? styles.primary : styles.secondary}
      title={title}
      disabled={pending}
    >
      {pending ? '…' : label}
    </button>
  );
}
