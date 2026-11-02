'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Search, IndianRupee, Crown, Sparkles, Brush, Wrench } from 'lucide-react';
import {
  checkInGuest, checkOutGuest, vouchForRoom, setRoomState, changeCheckout, raiseForGuest, type DeskState,
} from './actions';
import { GuestLink } from './guest-link';
import styles from '../admin.module.css';
import r from './rooms.module.css';

/**
 * The key rack, as a grid (D-094).
 *
 * It was a table: thirty-four rows, each carrying Copy link, Open, Reprint and
 * Check someone in at the same weight — 3,100px on a desk and 5,000 on a
 * phone, to answer "which rooms are free" and "who is in 214". Now every room
 * is a tile in key-rack order, coloured by what it is (empty, in house, out
 * today), and everything you can DO to a room is in its panel (`?room=`),
 * where there is room to say what each action does.
 *
 * Every string is formatted on the server — a client component importing a
 * value from a `modules/*` index drags `pg` into the browser bundle, and money
 * formatting belongs in one place (#5).
 */
export interface RoomView {
  id: string;
  number: string;
  floorName: string;
  roomTypeName: string | null;
  /** Null when this account lacks `qr:read`. */
  qr: { publicCode: string; url: string | null } | null;
  /** D-096 — is it ready for the next guest. */
  clean: { status: 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'OUT_OF_ORDER'; note: string | null };
  stay: {
    id: string;
    guestId: string;
    guestName: string;
    guestPhone: string | null;
    isVip: boolean;
    notes: string | null;
    /** `YYYY-MM-DD` and the hour, property-local — the change-checkout form's start. */
    checkoutDate: string;
    checkoutHour: number;
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
  /** Mark a room made up or to be made up (`request:advance`). */
  clean: boolean;
  /** The second signature (`request:verify`). */
  inspect: boolean;
  /** Take it out of order, or back (`room:manage`). */
  outOfOrder: boolean;
  /** Move a checkout, raise a request for a caller (`stay:update`). */
  updateStay: boolean;
}

export interface CatalogOption {
  id: string;
  label: string;
  allowsQuantity: boolean;
  maxQuantity: number;
}

const CLEAN_LABEL: Record<RoomView['clean']['status'], string> = {
  CLEAN: 'Clean', DIRTY: 'To make up', INSPECTED: 'Inspected', OUT_OF_ORDER: 'Out of order',
};

type State = 'empty' | 'in' | 'out';

function stateOf(room: RoomView): State {
  if (!room.stay) return 'empty';
  return room.stay.nightsLeft <= 0 ? 'out' : 'in';
}

/**
 * The grid, with a search over room numbers and guest names.
 *
 * The search is local — every room is already on the page, and a desk typing
 * "kap" while a guest spells their name should see the rack narrow as they
 * type, not after a round trip.
 */
export function RoomGrid({
  rooms,
  linkFor,
  selected,
}: {
  rooms: RoomView[];
  /** The room's panel, keeping whatever filter is on. */
  linkFor: Record<string, string>;
  selected: string | null;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => needle
    ? rooms.filter((room) => room.number.toLowerCase().startsWith(needle)
      || room.stay?.guestName.toLowerCase().includes(needle))
    : rooms, [rooms, needle]);
  const floors = [...new Set(shown.map((room) => room.floorName))];

  return (
    <div className={r.rack}>
      <label className={r.search}>
        <Search size={16} className={r.searchIcon} aria-hidden="true" />
        <input
          type="search"
          className={r.searchInput}
          placeholder="Room number or guest name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Find a room or a guest"
        />
      </label>

      {floors.length === 0 ? (
        <p className={styles.sectionEmpty}>No room or guest matches &ldquo;{query}&rdquo;.</p>
      ) : null}

      {floors.map((floor) => {
        const onFloor = shown.filter((room) => room.floorName === floor);
        const taken = onFloor.filter((room) => room.stay).length;
        return (
          <section key={floor} className={r.floor} aria-label={floor}>
            <h2 className={r.floorTitle}>
              {floor}
              <span className={`${r.floorCount} tabular`}>{taken} of {onFloor.length} taken</span>
            </h2>
            <ul className={r.grid}>
              {onFloor.map((room) => (
                <Tile
                  key={room.id}
                  room={room}
                  href={linkFor[room.number]!}
                  current={room.number === selected}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Tile({ room, href, current }: { room: RoomView; href: string; current: boolean }) {
  const state = stateOf(room);
  const stay = room.stay;
  return (
    <li
      className={r.tileItem}
      /* Stable hooks for a desk's Ctrl-F and for the e2e suite: the room number
         is the one thing about a tile that never changes. */
      data-room={room.number}
      data-occupied={stay ? 'true' : 'false'}
      data-state={state}
      data-clean={room.clean.status}
    >
      <Link href={href} scroll={false} className={r.tile} aria-current={current ? 'true' : undefined}>
        <span className={r.tileTop}>
          <span className={`${r.tileNumber} tabular`}>{room.number}</span>
          <span className={r.marks}>
            {stay?.isVip ? (
              <span className={r.vipMark} title="VIP">
                <Crown size={12} aria-hidden="true" />
                <span className={r.srOnly}>VIP</span>
              </span>
            ) : null}
            {stay?.owes ? (
              <span className={r.owes} title={`${stay.balance} on the folio`}>
                <IndianRupee size={12} aria-hidden="true" />
                <span className={r.srOnly}>owes {stay.balance}</span>
              </span>
            ) : null}
          </span>
        </span>
        <span className={r.tileGuest}>{stay ? stay.guestName : 'empty'}</span>
        <span className={r.tileMeta}>
          {stay
            ? state === 'out' ? 'Out today' : `Out ${stay.dueOut}`
            : room.roomTypeName ?? 'Room'}
        </span>
        {/* The housekeeping half (D-096). Said for an empty room always — it
            is the question a desk asks before selling it — and for an occupied
            one only when it is not the ordinary case. */}
        {!stay || room.clean.status === 'DIRTY' || room.clean.status === 'OUT_OF_ORDER' ? (
          <span className={r.cleanChip} data-clean={room.clean.status}>
            {room.clean.status === 'OUT_OF_ORDER' ? <Wrench size={11} aria-hidden="true" />
              : room.clean.status === 'DIRTY' ? <Brush size={11} aria-hidden="true" />
                : <Sparkles size={11} aria-hidden="true" />}
            {room.clean.status === 'CLEAN' || room.clean.status === 'INSPECTED'
              ? (stay ? CLEAN_LABEL[room.clean.status] : `Ready · ${CLEAN_LABEL[room.clean.status].toLowerCase()}`)
              : CLEAN_LABEL[room.clean.status]}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * One room, and everything that can be done to it.
 *
 * Rendered inside the console's `SidePanel` by the page. The check-in form is
 * open, not behind a disclosure: opening an empty room's panel IS the step
 * that said "check someone in".
 */
export function RoomPanel({
  propertyId,
  room,
  checkoutHours,
  permissions,
  deskHref,
  catalog,
  raiseKey,
}: {
  propertyId: string;
  room: RoomView;
  checkoutHours: number[];
  permissions: DeskPermissions;
  /** The same room on the Front desk, where its orders, requests and bill are. */
  deskHref: string;
  /** What a guest who rings down can be given (empty without `stay:update`). */
  catalog: CatalogOption[];
  /** Minted per render, so a double tap raises one request (#8). */
  raiseKey: string;
}) {
  const stay = room.stay;
  const state = stateOf(room);

  return (
    <div className={r.panel} data-room-panel={room.number}>
      <div className={r.panelHero} data-state={state}>
        <span className={`${r.panelNumber} tabular`}>{room.number}</span>
        <span className={r.panelHeroText}>
          <span className={r.panelStatus}>
            {state === 'empty' ? 'Empty' : state === 'out' ? 'In house · out today' : 'In house'}
          </span>
          <span className={r.panelSub}>{room.roomTypeName ?? 'Room'} · {room.floorName}</span>
        </span>
      </div>

      {stay ? (
        <section className={r.panelSection}>
          <h3 className={r.panelTitle}>Guest</h3>
          <dl className={r.facts}>
            <dt>Name</dt>
            <dd>
              {/* Straight to what the desk needs when a guest rings down about
                  a charge, or when something has gone wrong. */}
              <Link href={`/admin/guests/${stay.guestId}`}>{stay.guestName}</Link>
            </dd>
            {stay.isVip ? (<><dt>Status</dt><dd><span className={r.vipBadge}><Crown size={12} aria-hidden="true" /> VIP</span></dd></>) : null}
            {stay.guestPhone ? (<><dt>Phone</dt><dd className="tabular">{stay.guestPhone}</dd></>) : null}
            <dt>Due out</dt>
            <dd>{state === 'out' ? 'Today' : stay.dueOut}{stay.nightsLeft > 0 ? ` · ${stay.nightsLeft} ${stay.nightsLeft === 1 ? 'night' : 'nights'} left` : ''}</dd>
            <dt>Folio</dt>
            {/* "nothing yet" rather than ₹0: a guest who has bought nothing and
                one who has paid up look different to a desk. */}
            <dd className="tabular" data-owes={stay.owes}>{stay.balance ?? 'nothing yet'}</dd>
          </dl>
          {/* What the desk has written down about them — the allergy, the
              anniversary, the complaint last time. Shown where it is used. */}
          {stay.notes ? <p className={r.notes}>{stay.notes}</p> : null}
          <p className={r.panelLinks}>
            <Link href={deskHref}>Orders, requests and the bill on the Front desk →</Link>
          </p>
        </section>
      ) : null}

      <RoomState propertyId={propertyId} room={room} permissions={permissions} />

      {stay && (permissions.checkOut || permissions.vouch) ? (
        <section className={r.panelSection}>
          <h3 className={r.panelTitle}>At the desk</h3>
          <div className={r.panelActions}>
            {/* Owing anything, checking out is the bill screen's job: review,
                settle, close (D-095). Square, it is one tap here. */}
            {permissions.checkOut && stay.owes ? (
              <Link href={`/admin/checkouts/${stay.id}`} className={styles.primary}>Settle and check out</Link>
            ) : permissions.checkOut ? (
              <CheckOut propertyId={propertyId} stay={stay} roomNumber={room.number} />
            ) : null}
            <Link href={`/admin/checkouts/${stay.id}`} className={r.panelLink}>The bill — add a charge or take a payment →</Link>
            {permissions.vouch ? <Vouch propertyId={propertyId} stayId={stay.id} roomNumber={room.number} /> : null}
          </div>
        </section>
      ) : null}

      {stay && permissions.updateStay ? (
        <section className={r.panelSection}>
          <h3 className={r.panelTitle}>Move their checkout</h3>
          <ChangeCheckout propertyId={propertyId} stay={stay} checkoutHours={checkoutHours} />
        </section>
      ) : null}

      {stay && permissions.updateStay && catalog.length ? (
        <section className={r.panelSection}>
          <h3 className={r.panelTitle}>They rang the desk</h3>
          <RaiseRequest propertyId={propertyId} room={room} stayId={stay.id} catalog={catalog} raiseKey={raiseKey} />
        </section>
      ) : null}

      {!stay && permissions.checkIn && room.clean.status !== 'OUT_OF_ORDER' ? (
        <section className={r.panelSection}>
          <h3 className={r.panelTitle}>Check someone in</h3>
          {/* Said, not blocked: a desk at 2am with one room left will put
              a guest in it and send housekeeping straight up. */}
          {room.clean.status === 'DIRTY' ? (
            <p className={r.warn}>Not made up since the last guest. Send housekeeping up before they arrive.</p>
          ) : null}
          <CheckIn propertyId={propertyId} room={room} checkoutHours={checkoutHours} />
        </section>
      ) : null}

      {/* The sticker's own link, whoever is in the room and whether anybody is —
          a desk reprints stickers for empty rooms more often than full ones. */}
      {room.qr ? (
        <section className={r.panelSection}>
          <h3 className={r.panelTitle}>The sticker on the nightstand</h3>
          <GuestLink
            propertyId={propertyId}
            roomId={room.id}
            roomNumber={room.number}
            publicCode={room.qr.publicCode}
            url={room.qr.url}
            mayReprint={permissions.reprintQr}
            occupied={stay != null}
          />
        </section>
      ) : null}
    </div>
  );
}

/**
 * The housekeeping half of the room (D-096): what state it is in, and the
 * moves the person looking may make. Each button is one state; out of order
 * asks why.
 */
function RoomState({ propertyId, room, permissions }: { propertyId: string; room: RoomView; permissions: DeskPermissions }) {
  const status = room.clean.status;
  const moves: Array<{ to: RoomView['clean']['status']; label: string; allowed: boolean }> = [
    { to: 'CLEAN', label: status === 'OUT_OF_ORDER' ? 'Back in order, clean' : 'Mark clean', allowed: status !== 'CLEAN' && (status === 'OUT_OF_ORDER' ? permissions.outOfOrder : permissions.clean) },
    { to: 'INSPECTED', label: 'Inspected', allowed: status === 'CLEAN' && permissions.inspect },
    { to: 'DIRTY', label: 'Needs making up', allowed: (status === 'CLEAN' || status === 'INSPECTED') && permissions.clean },
  ];
  const visible = moves.filter((m) => m.allowed);
  return (
    <section className={r.panelSection} data-room-state={status}>
      <h3 className={r.panelTitle}>The room</h3>
      <p className={r.cleanLine}>
        <span className={r.cleanChip} data-clean={status}>{CLEAN_LABEL[status]}</span>
        {status === 'OUT_OF_ORDER' && room.clean.note ? <span className={r.cleanNote}>{room.clean.note}</span> : null}
      </p>
      {visible.length ? (
        <div className={r.stateButtons}>
          {visible.map((m) => <StateButton key={m.to} propertyId={propertyId} roomId={room.id} to={m.to} label={m.label} />)}
        </div>
      ) : null}
      {permissions.outOfOrder && status !== 'OUT_OF_ORDER' && !room.stay ? <OutOfOrder propertyId={propertyId} roomId={room.id} /> : null}
    </section>
  );
}

function StateButton({ propertyId, roomId, to, label }: { propertyId: string; roomId: string; to: string; label: string }) {
  const [state, action] = useActionState<DeskState, FormData>(setRoomState, {});
  return (
    <form action={action} className={r.inlineForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="roomId" value={roomId} />
      <input type="hidden" name="status" value={to} />
      <SubmitButton label={label} />
      {state.error ? <span className={styles.inlineError} role="alert">{state.error}</span> : null}
    </form>
  );
}

function OutOfOrder({ propertyId, roomId }: { propertyId: string; roomId: string }) {
  const [state, action] = useActionState<DeskState, FormData>(setRoomState, {});
  return (
    <details className={styles.roomForm}>
      <summary className={styles.disclosureHead}>Take it out of order</summary>
      <form action={action} className={styles.stackedForm}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="roomId" value={roomId} />
        <input type="hidden" name="status" value="OUT_OF_ORDER" />
        <label className={styles.field}>
          <span className={styles.label}>What is wrong</span>
          <input name="note" className={styles.input} maxLength={160} required placeholder="AC not cooling — engineer booked" />
          <span className={styles.hint}>Nobody can be checked in until it is back in order.</span>
        </label>
        {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
        <SubmitButton label="Out of order" />
      </form>
    </details>
  );
}

function ChangeCheckout({ propertyId, stay, checkoutHours }: {
  propertyId: string; stay: NonNullable<RoomView['stay']>; checkoutHours: number[];
}) {
  const [state, action] = useActionState<DeskState, FormData>(changeCheckout, {});
  const hours = checkoutHours.includes(stay.checkoutHour) ? checkoutHours : [...checkoutHours, stay.checkoutHour].sort((a, b) => a - b);
  return (
    <form action={action} className={styles.stackedForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="stayId" value={stay.id} />
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span className={styles.label}>Date</span>
          <input name="date" type="date" className={styles.input} defaultValue={stay.checkoutDate} required />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Out at</span>
          <select name="checkoutHour" className={styles.input} defaultValue={stay.checkoutHour}>
            {hours.map((hour) => (
              <option key={hour} value={hour}>{hour === 12 ? 'noon' : hour > 12 ? `${hour - 12}pm` : `${hour}am`}</option>
            ))}
          </select>
        </label>
      </div>
      <span className={styles.hint}>Staying on, or leaving early. Their phone works until the new time; add the extra nights on the bill.</span>
      {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
      <SubmitButton label="Move the checkout" />
    </form>
  );
}

function RaiseRequest({ propertyId, room, stayId, catalog, raiseKey }: {
  propertyId: string; room: RoomView; stayId: string; catalog: CatalogOption[]; raiseKey: string;
}) {
  const [state, action] = useActionState<DeskState, FormData>(raiseForGuest, {});
  const [typeId, setTypeId] = useState('');
  const chosen = catalog.find((c) => c.id === typeId);
  return (
    <form action={action} className={styles.stackedForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="stayId" value={stayId} />
      <input type="hidden" name="roomId" value={room.id} />
      {/* Fresh after each one goes through, so a second request is a second
          request and a double tap is still one. */}
      <input type="hidden" name="idempotencyKey" value={state.done ? `${raiseKey.slice(0, 24)}${Date.now().toString(16).slice(-12).padStart(12, '0')}` : raiseKey} />
      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>What they asked for</span>
          <select name="requestTypeId" className={styles.input} value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
            <option value="" disabled>Choose</option>
            {catalog.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        {chosen?.allowsQuantity ? (
          <label className={styles.field}>
            <span className={styles.label}>How many</span>
            <input name="quantity" type="number" min={1} max={chosen.maxQuantity} defaultValue={1} className={styles.input} />
          </label>
        ) : null}
        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>Note</span>
          <input name="note" className={styles.input} maxLength={300} placeholder="Leave them outside the door" />
        </label>
      </div>
      {state.error ? <p className={styles.inlineError} role="alert">{state.error}</p> : null}
      {state.done ? <p className={styles.inlineDone}>{state.done}</p> : null}
      <SubmitButton label={`Raise it for ${room.number}`} />
    </form>
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
    <form action={action} className={styles.stackedForm}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="roomId" value={room.id} />

      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.wide}`}>
          <span className={styles.label}>Name</span>
          <input name="fullName" className={styles.input} required maxLength={160} autoComplete="off" />
        </label>

        <label className={`${styles.field} ${styles.wide}`}>
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
    <form action={action} className={r.checkOut}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="stayId" value={stay.id} />
      {/* Said before the button, not in a tooltip a tablet never shows: the
          one thing a desk must not learn after pressing it. */}
      <p className={styles.hint}>
        {stay.owes
          ? `${stay.balance} is still on the folio. It stays on the bill after they leave; take it at the desk first if you can.`
          : `Frees ${roomNumber} and ends every session on the guest’s phone.`}
      </p>
      <SubmitButton label="Check out" />
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
