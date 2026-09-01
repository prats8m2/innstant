'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { checkInGuest, checkOutGuest, vouchForRoom, type DeskState } from './actions';
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
  stay: {
    id: string;
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
          <ul className={styles.dishes}>
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
  return (
    <li
      className={`${styles.dish} ${styles.typeRow}`}
      data-available={!room.stay}
      /* A stable hook for a desk's Ctrl-F and for the e2e suite: the room number
         is inside a name that changes the moment somebody checks in. */
      data-room={room.number}
    >
      <span className={styles.dishBody}>
        <span className={styles.dishName}>
          {room.number}
          {room.stay ? ` · ${room.stay.guestName}` : null}
        </span>
        <span className={styles.dishFlags}>
          {room.roomTypeName ?? 'Room'}
          {room.stay ? (
            <>
              {' · '}
              {room.stay.nightsLeft === 0 ? 'out today' : `out ${room.stay.dueOut}`}
              {room.stay.guestPhone ? ` · ${room.stay.guestPhone}` : null}
            </>
          ) : ' · empty'}
        </span>
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
      {room.stay ? (
        <span className={`${styles.dishPrice} tabular`}>
          {room.stay.balance ?? 'nothing yet'}
        </span>
      ) : null}

      {room.stay
        ? <Occupied propertyId={propertyId} room={room} permissions={permissions} />
        : permissions.checkIn
          ? <CheckIn propertyId={propertyId} room={room} checkoutHours={checkoutHours} />
          : null}
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
    <span className={styles.roomActions}>
      {permissions.vouch ? (
        <Vouch propertyId={propertyId} stayId={stay.id} roomNumber={room.number} />
      ) : null}
      {permissions.checkOut ? (
        <CheckOut propertyId={propertyId} stay={stay} roomNumber={room.number} />
      ) : null}
    </span>
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
