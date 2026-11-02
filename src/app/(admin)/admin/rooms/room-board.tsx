'use client';

import { useActionState, useId, useMemo, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import {
  AlarmClock, Brush, Check, CheckCheck, ChevronRight, Crown, LogOut, QrCode, Search, Wrench, X,
  type LucideIcon,
} from 'lucide-react';
import {
  checkInGuest, checkOutGuest, vouchForRoom, setRoomState, changeCheckout, raiseForGuest, type DeskState,
} from './actions';
import { GuestLink } from './guest-link';
import r from './rooms.module.css';
import ui from './controls.module.css';

/**
 * The key rack, as a grid or a list (D-094, rebuilt to Direction A).
 *
 * Every room is a tile in key-rack order: its number, the guest, and two
 * statuses — who is in it (in house, out today, late, empty) and whether it
 * is ready (ready, inspected, to make up, out of order) — each a colour AND a
 * word. Everything you can DO to a room is in its panel (`?room=`).
 *
 * Every string is formatted on the server — a client component importing a
 * value from a `modules/*` index drags `pg` into the browser bundle, and money
 * formatting belongs in one place (#5).
 */
export interface LiveItem {
  key: string;
  /** "Laal maas, Dal" or "Extra towels ×2". */
  label: string;
  /** The order or request number, in mono. */
  ref: string | null;
  /** "Cooking", "Sunita", "Late", "Needs an answer". */
  status: string;
  tone: 'accent' | 'info' | 'warn' | 'crit' | 'neutral';
  /** The tile's one-line version, for its live mark. */
  short: string;
}

export interface RoomView {
  id: string;
  number: string;
  floorName: string;
  roomTypeName: string | null;
  /** Null when this account lacks `qr:read`. */
  qr: { publicCode: string; url: string | null } | null;
  /** D-096 — is it ready for the next guest. */
  clean: { status: 'CLEAN' | 'DIRTY' | 'INSPECTED' | 'OUT_OF_ORDER'; note: string | null };
  /** Orders, requests and asks in flight for this room. */
  live: LiveItem[];
  stay: {
    id: string;
    guestId: string;
    guestName: string;
    guestPhone: string | null;
    isVip: boolean;
    notes: string | null;
    arrived: { day: string; time: string } | null;
    leaving: { day: string; time: string };
    /** `YYYY-MM-DD` and the hour, property-local — the change-checkout form's start. */
    checkoutDate: string;
    checkoutHour: number;
    dueOut: string;
    nightsLeft: number;
    /** Past their checkout time and still checked in. */
    late: boolean;
    /** Null when nothing has ever been charged — not the same as ₹0. */
    balance: string | null;
    owes: boolean;
  } | null;
}

export interface FolioView {
  sections: Array<{
    key: string;
    title: string;
    count: number;
    total: string;
    lines: Array<{ id: string; description: string; sub: string; amount: string; isCredit: boolean }>;
  }>;
  payments: Array<{ id: string; description: string; date: string; amount: string; isRefund: boolean }>;
  charges: string;
  balance: string;
  balanceMinor: number;
  settled: boolean;
}

export interface ActivityItem {
  key: string;
  text: string;
  day: string;
  time: string;
  who: string;
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
  /** The Folio tab (`folio:read`). */
  seeBill: boolean;
}

export interface CatalogOption {
  id: string;
  label: string;
  allowsQuantity: boolean;
  maxQuantity: number;
}

type Tone = 'accent' | 'pos' | 'warn' | 'warn-line' | 'crit' | 'info' | 'solid' | 'neutral';
interface Status { word: string; tone: Tone; icon: LucideIcon | null }

const CLEAN: Record<RoomView['clean']['status'], Status> = {
  CLEAN: { word: 'Ready', tone: 'pos', icon: Check },
  INSPECTED: { word: 'Inspected', tone: 'pos', icon: CheckCheck },
  DIRTY: { word: 'To make up', tone: 'warn-line', icon: Brush },
  OUT_OF_ORDER: { word: 'Out of order', tone: 'solid', icon: Wrench },
};

type State = 'empty' | 'in' | 'out';

function stateOf(room: RoomView): State {
  if (!room.stay) return 'empty';
  return room.stay.nightsLeft <= 0 ? 'out' : 'in';
}

/** Who is in the room, as a word: the tile's first pill. */
function occupancyOf(room: RoomView): Status {
  if (!room.stay) return { word: 'Empty', tone: 'neutral', icon: null };
  if (room.stay.late) return { word: 'Late', tone: 'crit', icon: AlarmClock };
  if (room.stay.nightsLeft <= 0) return { word: 'Out today', tone: 'warn', icon: LogOut };
  return { word: 'In house', tone: 'accent', icon: null };
}

function Pill({ status, small = false }: { status: Status; small?: boolean }) {
  const Icon = status.icon;
  return (
    <span className={ui.pill} data-tone={status.tone}>
      {Icon ? <Icon size={small ? 11 : 12} strokeWidth={1.75} aria-hidden="true" /> : null}
      {status.word}
    </span>
  );
}

/**
 * The rack: a toolbar (search and the filters), then the floors.
 *
 * The search is local — every room is already on the page, and a desk typing
 * "kap" while a guest spells their name should see the rack narrow as they
 * type, not after a round trip.
 */
export function RoomRack({
  rooms,
  layout,
  linkFor,
  selected,
  filters,
  empty,
}: {
  rooms: RoomView[];
  layout: 'grid' | 'list';
  /** The room's panel, keeping whatever filter and view are on. */
  linkFor: Record<string, string>;
  selected: string | null;
  /** The filter chips: links, so a filter survives a reload (D-061). */
  filters: Array<{ key: string; label: string; count: number; href: string; current: boolean }>;
  /** Said when the filter itself leaves nothing, with the way out of it. */
  empty: { text: string; allHref: string } | null;
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
      <div className={`${ui.card} ${r.toolbar}`}>
        <label className={r.search}>
          <Search size={15} strokeWidth={1.5} className={r.searchIcon} aria-hidden="true" />
          <span className={ui.srOnly}>Find a room or a guest</span>
          <input
            type="search"
            className={r.searchInput}
            placeholder="Room number or guest"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <nav className={r.chips} aria-label="Show rooms">
          {filters.map((f) => (
            <Link key={f.key} href={f.href} scroll={false} className={r.chip} aria-current={f.current ? 'page' : undefined}>
              {f.label}
              <span className={`${r.chipCount} tabular`}>{f.count}</span>
            </Link>
          ))}
        </nav>
      </div>

      {empty ? (
        <p className={r.empty}>{empty.text} <Link href={empty.allHref}>Show every room</Link></p>
      ) : null}

      {!empty && floors.length === 0 ? (
        <p className={r.empty}>No room or guest matches &ldquo;{query}&rdquo;.</p>
      ) : null}

      {layout === 'list' && floors.length ? (
        <RoomList rooms={shown} linkFor={linkFor} selected={selected} />
      ) : floors.map((floor) => {
        const onFloor = shown.filter((room) => room.floorName === floor);
        const taken = onFloor.filter((room) => room.stay).length;
        const inHouse = taken === 0 ? 'nobody in' : taken === onFloor.length ? 'all in house' : `${taken} in house`;
        return (
          <section key={floor} className={r.floor} aria-label={floor}>
            <h2 className={r.floorTitle}>
              {floor}
              <span className={r.floorCount}>
                <span className="tabular">{onFloor.length}</span> {onFloor.length === 1 ? 'room' : 'rooms'} · {inHouse}
              </span>
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

/** What a screen reader hears for a tile: the whole row in one sentence. */
function describe(room: RoomView): string {
  const stay = room.stay;
  return [
    `Room ${room.number}`,
    stay ? stay.guestName : 'empty',
    occupancyOf(room).word,
    CLEAN[room.clean.status].word,
    stay?.isVip ? 'VIP' : null,
    stay?.owes ? `owes ${stay.balance}` : null,
    room.live.length ? room.live.map((l) => l.short).join(', ') : null,
  ].filter(Boolean).join(', ');
}

function Tile({ room, href, current }: { room: RoomView; href: string; current: boolean }) {
  const state = stateOf(room);
  const stay = room.stay;
  const live = room.live[0];
  const lateWork = room.live.some((l) => l.tone === 'crit');
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
        <span className={ui.srOnly}>{describe(room)}</span>
        <span className={r.tileBody} aria-hidden="true">
          <span className={r.tileTop}>
            <span className={`${r.tileNumber} tabular`}>{room.number}</span>
            <span className={r.marks}>
              {live ? (
                <span className={r.liveDot} data-tone={lateWork ? 'crit' : 'accent'} title={room.live.map((l) => l.short).join(' · ')} />
              ) : null}
              {stay?.isVip ? <span className={r.vip}>VIP</span> : null}
            </span>
          </span>
          <span className={r.tileGuest} data-empty={stay ? undefined : 'true'}>
            {stay
              ? stay.guestName
              : room.clean.status === 'OUT_OF_ORDER' && room.clean.note ? room.clean.note : room.roomTypeName ?? '—'}
          </span>
          <span className={r.tilePills}>
            <Pill status={occupancyOf(room)} small />
            <Pill status={CLEAN[room.clean.status]} small />
            {stay?.owes && state === 'out' ? (
              <span className={ui.pill} data-tone="warn">Owes <span className="tabular">{stay.balance}</span></span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * The same rooms as a table, for a desk that reads across: one row each,
 * sortable by eye, its own horizontal scroll on a phone.
 */
function RoomList({ rooms, linkFor, selected }: { rooms: RoomView[]; linkFor: Record<string, string>; selected: string | null }) {
  return (
    <div className={`${ui.card} ${r.tableBox}`}>
      <table className={r.table}>
        <thead>
          <tr>
            <th scope="col">Room</th>
            <th scope="col">Guest</th>
            <th scope="col">Stay</th>
            <th scope="col">Housekeeping</th>
            <th scope="col">Leaving</th>
            <th scope="col" className={r.num}>Folio</th>
            <th scope="col">Live</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <tr
              key={room.id}
              data-room-row={room.number}
              data-clean={room.clean.status}
              aria-current={room.number === selected ? 'true' : undefined}
            >
              <th scope="row">
                <Link href={linkFor[room.number]!} scroll={false} className={`${r.rowLink} tabular`} aria-label={describe(room)}>
                  {room.number}
                </Link>
                <span className={r.rowSub}>{room.floorName}</span>
              </th>
              <td>
                {room.stay ? (
                  <span className={r.rowGuest}>
                    {room.stay.guestName}
                    {room.stay.isVip ? <span className={r.vip}>VIP</span> : null}
                  </span>
                ) : <span className={r.muted}>{room.roomTypeName ?? '—'}</span>}
              </td>
              <td><Pill status={occupancyOf(room)} small /></td>
              <td><Pill status={CLEAN[room.clean.status]} small /></td>
              <td className="tabular">{room.stay ? room.stay.dueOut : <span className={r.muted}>—</span>}</td>
              <td className={`${r.num} tabular`} data-owes={room.stay?.owes ? 'true' : undefined}>
                {room.stay ? room.stay.balance ?? 'nothing yet' : ''}
              </td>
              <td className={r.rowLive}>{room.live.map((l) => l.short).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase();
}

/**
 * One room, and everything that can be done to it.
 *
 * In house: tabs for the stay, its bill and what has happened since they
 * arrived. Empty: the check-in form, open — opening an empty room's panel IS
 * the step that said "check someone in".
 */
export function RoomPanel({
  propertyId,
  room,
  closeHref,
  checkoutHours,
  permissions,
  deskHref,
  folio,
  activity,
  catalog,
  raiseKey,
}: {
  propertyId: string;
  room: RoomView;
  closeHref: string;
  checkoutHours: number[];
  permissions: DeskPermissions;
  /** The same room on the Front desk. */
  deskHref: string;
  /** The bill so far; null without `folio:read` or with nothing on it. */
  folio: FolioView | null;
  activity: ActivityItem[];
  /** What a guest who rings down can be given (empty without `stay:update`). */
  catalog: CatalogOption[];
  /** Minted per render, so a double tap raises one request (#8). */
  raiseKey: string;
}) {
  const stay = room.stay;
  const where = [room.roomTypeName, room.floorName].filter(Boolean).join(' · ');

  return (
    <div className={r.panel} data-room-panel={room.number}>
      <header className={r.panelHead}>
        {stay ? (
          <span className={r.avatar} aria-hidden="true">{initials(stay.guestName)}</span>
        ) : (
          <span className={`${r.roomBadge} tabular`} aria-hidden="true">{room.number}</span>
        )}
        <span className={r.panelHeadText}>
          {stay ? (
            // Straight to what the desk needs when a guest rings down about a
            // charge, or when something has gone wrong.
            <Link href={`/admin/guests/${stay.guestId}`} className={r.panelName}>{stay.guestName}</Link>
          ) : (
            <span className={r.panelName}>Room <span className="tabular">{room.number}</span> is empty</span>
          )}
          <span className={r.panelSub}>
            {stay ? <>Room <span className="tabular">{room.number}</span>{where ? ` · ${where}` : ''}</> : where || 'Room'}
          </span>
        </span>
        <Link href={closeHref} scroll={false} className={r.close} aria-label="Close">
          <X size={18} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </header>

      {stay ? (
        <Tabs
          tabs={[
            { key: 'stay', label: 'Stay', body: <StayTab propertyId={propertyId} room={room} checkoutHours={checkoutHours} permissions={permissions} deskHref={deskHref} catalog={catalog} raiseKey={raiseKey} /> },
            ...(permissions.seeBill ? [{ key: 'folio', label: 'Folio', body: <FolioTab stayId={stay.id} folio={folio} /> }] : []),
            { key: 'activity', label: 'Activity', body: <ActivityTab items={activity} /> },
          ]}
        />
      ) : (
        <div className={r.panelBody}>
          <EmptyRoom propertyId={propertyId} room={room} checkoutHours={checkoutHours} permissions={permissions} />
        </div>
      )}
    </div>
  );
}

function Tabs({ tabs }: { tabs: Array<{ key: string; label: string; body: React.ReactNode }> }) {
  const [current, setCurrent] = useState(tabs[0]!.key);
  const id = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : -1;
    if (to < 0) return;
    event.preventDefault();
    const next = tabs[to]!.key;
    setCurrent(next);
    refs.current[next]?.focus();
  };

  return (
    <>
      <div role="tablist" aria-label="Room" className={r.tabs}>
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            ref={(el) => { refs.current[tab.key] = el; }}
            type="button"
            role="tab"
            id={`${id}-${tab.key}-tab`}
            aria-controls={`${id}-${tab.key}`}
            aria-selected={current === tab.key}
            tabIndex={current === tab.key ? 0 : -1}
            className={r.tab}
            onClick={() => setCurrent(tab.key)}
            onKeyDown={(event) => move(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${id}-${tab.key}`}
          aria-labelledby={`${id}-${tab.key}-tab`}
          hidden={current !== tab.key}
          className={r.panelBody}
        >
          {tab.body}
        </div>
      ))}
    </>
  );
}

function StayTab({ propertyId, room, checkoutHours, permissions, deskHref, catalog, raiseKey }: {
  propertyId: string; room: RoomView; checkoutHours: number[]; permissions: DeskPermissions;
  deskHref: string; catalog: CatalogOption[]; raiseKey: string;
}) {
  const stay = room.stay!;
  const [open, setOpen] = useState<'move' | 'raise' | null>(null);
  const stickerId = useId();
  const toggle = (which: 'move' | 'raise') => setOpen((now) => (now === which ? null : which));
  const mayRaise = permissions.updateStay && catalog.length > 0;

  return (
    <>
      <div className={r.chipRow}>
        <Pill status={occupancyOf(room)} />
        <Pill status={CLEAN[room.clean.status]} />
        {stay.isVip ? <span className={ui.pill} data-tone="accent"><Crown size={12} strokeWidth={1.75} aria-hidden="true" />VIP</span> : null}
        {stay.owes ? <span className={ui.pill} data-tone="warn">Owes <span className="tabular">{stay.balance}</span></span> : null}
      </div>

      <dl className={r.facts}>
        <dt>Arrived</dt>
        <dd>{stay.arrived ? <>{stay.arrived.day}, <span className="tabular">{stay.arrived.time}</span></> : '—'}</dd>
        <dt>Leaving</dt>
        <dd data-late={stay.late ? 'true' : undefined}>
          {stay.leaving.day}, <span className="tabular">{stay.leaving.time}</span>
          {stay.late
            ? ' · past their time'
            : stay.nightsLeft > 0 ? ` · ${stay.nightsLeft} ${stay.nightsLeft === 1 ? 'night' : 'nights'} left` : ' · today'}
        </dd>
        {stay.guestPhone ? (<><dt>Phone</dt><dd className="tabular">{stay.guestPhone}</dd></>) : null}
        {/* What the desk has written down about them — the allergy, the
            anniversary, the complaint last time. Shown where it is used. */}
        {stay.notes ? (<><dt>Notes</dt><dd>{stay.notes}</dd></>) : null}
      </dl>

      {room.live.length ? (
        <div className={r.group}>
          <h3 className={ui.lbl}>Live in this room</h3>
          <ul className={r.liveList}>
            {room.live.map((item) => (
              <li key={item.key} className={r.liveRow}>
                <span className={r.liveWhat}>
                  {item.label}
                  {item.ref ? <span className={`${r.liveRef} tabular`}>{item.ref}</span> : null}
                </span>
                {item.tone === 'neutral'
                  ? <span className={r.liveWho}>{item.status}</span>
                  : (
                    <span className={ui.pill} data-tone={item.tone}>
                      {item.tone === 'crit' ? <AlarmClock size={12} strokeWidth={1.75} aria-hidden="true" /> : null}
                      {item.status}
                    </span>
                  )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className={r.folioLine}>
        <span className={r.folioLabel}>{stay.owes ? 'Balance on the folio' : 'Folio'}</span>
        {/* "nothing yet" rather than ₹0: a guest who has bought nothing and
            one who has paid up look different to a desk. */}
        <span className={`${r.folioValue} tabular`} data-owes={stay.owes ? 'true' : undefined}>
          {stay.balance === null ? 'nothing yet' : stay.owes ? stay.balance : `${stay.balance} · settled`}
        </span>
      </div>

      <div className={r.actions}>
        {permissions.updateStay ? (
          <button type="button" className={ui.btn} aria-expanded={open === 'move'} onClick={() => toggle('move')}>
            Move checkout
          </button>
        ) : null}
        {mayRaise ? (
          <button type="button" className={ui.btn} aria-expanded={open === 'raise'} onClick={() => toggle('raise')}>
            Raise request
          </button>
        ) : null}
        {room.qr ? (
          <button
            type="button"
            className={ui.btn}
            onClick={() => {
              const target = document.getElementById(stickerId);
              target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              target?.focus({ preventScroll: true });
            }}
          >
            <QrCode size={16} strokeWidth={1.5} aria-hidden="true" /> QR sticker
          </button>
        ) : null}
        {/* Owing anything, checking out is the bill screen's job: review,
            settle, close (D-095). Square, it is one tap here. */}
        {permissions.checkOut ? (
          stay.owes
            ? <Link href={`/admin/checkouts/${stay.id}`} className={`${ui.btn} ${ui.primary}`}>Check out</Link>
            : <CheckOut propertyId={propertyId} stayId={stay.id} />
        ) : null}
      </div>
      {permissions.checkOut ? (
        <p className={ui.hint}>
          {stay.owes
            ? `${stay.balance} is still on the bill. Check out takes you to it, to settle first.`
            : `Check out frees ${room.number} and ends every session on the guest’s phone.`}
        </p>
      ) : null}

      {open === 'move' && permissions.updateStay ? (
        <section className={r.drawer} aria-label="Move their checkout">
          <h3 className={r.drawerTitle}>Move their checkout</h3>
          <ChangeCheckout propertyId={propertyId} stay={stay} checkoutHours={checkoutHours} />
        </section>
      ) : null}
      {open === 'raise' && mayRaise ? (
        <section className={r.drawer} aria-label="They rang the desk">
          <h3 className={r.drawerTitle}>They rang the desk</h3>
          <RaiseRequest propertyId={propertyId} room={room} stayId={stay.id} catalog={catalog} raiseKey={raiseKey} />
        </section>
      ) : null}

      <RoomState propertyId={propertyId} room={room} permissions={permissions} />

      <div className={r.group}>
        <h3 className={ui.lbl}>At the desk</h3>
        <div className={r.deskLinks}>
          {permissions.vouch ? <Vouch propertyId={propertyId} stayId={stay.id} roomNumber={room.number} /> : null}
          <Link href={deskHref} className={r.textLink}>
            Orders and requests on the Front desk <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          </Link>
          {permissions.seeBill ? (
            <Link href={`/admin/checkouts/${stay.id}`} className={r.textLink}>
              The bill — add a charge or take a payment <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>

      {room.qr ? (
        <section className={r.group} id={stickerId} tabIndex={-1} aria-labelledby={`${stickerId}-h`}>
          <h3 id={`${stickerId}-h`} className={ui.lbl}>The sticker on the nightstand</h3>
          <GuestLink
            propertyId={propertyId}
            roomId={room.id}
            roomNumber={room.number}
            publicCode={room.qr.publicCode}
            url={room.qr.url}
            mayReprint={permissions.reprintQr}
            occupied
          />
        </section>
      ) : null}
    </>
  );
}

function FolioTab({ stayId, folio }: { stayId: string; folio: FolioView | null }) {
  if (!folio || (folio.sections.length === 0 && folio.payments.length === 0)) {
    return (
      <>
        <p className={r.quiet}>Nothing on the bill yet.</p>
        <Link href={`/admin/checkouts/${stayId}`} className={ui.btn}>Add a charge on the bill</Link>
      </>
    );
  }
  const owes = folio.balanceMinor > 0;
  return (
    <>
      <div className={r.folioSections}>
        {folio.sections.map((section) => (
          <div key={section.key} className={r.folioSection}>
            <p className={r.folioSectionHead}>
              <span>{section.title} <span className={r.muted}>{section.count} {section.count === 1 ? 'item' : 'items'}</span></span>
              <span className="tabular">{section.total}</span>
            </p>
            <ul className={r.folioLines}>
              {section.lines.map((line) => (
                <li key={line.id} data-credit={line.isCredit ? 'true' : undefined}>
                  <span className={r.folioDesc}>{line.description}<span className={r.folioSub}>{line.sub}</span></span>
                  <span className="tabular">{line.amount}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {folio.payments.length ? (
          <div className={r.folioSection}>
            <p className={r.folioSectionHead}><span>Payments</span></p>
            <ul className={r.folioLines}>
              {folio.payments.map((p) => (
                <li key={p.id} data-credit={p.isRefund ? undefined : 'true'}>
                  <span className={r.folioDesc}>{p.description}<span className={r.folioSub}>{p.date}</span></span>
                  <span className="tabular">{p.isRefund ? `+${p.amount}` : `−${p.amount}`}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className={r.folioLine}>
        <span className={r.folioLabel}>{owes ? 'Balance due' : folio.balanceMinor < 0 ? 'Owed back to the guest' : folio.settled ? 'Settled' : 'Nothing to pay'}</span>
        <span className={`${r.folioValue} tabular`} data-owes={owes ? 'true' : undefined}>{folio.balance}</span>
      </div>
      <Link href={`/admin/checkouts/${stayId}`} className={`${ui.btn} ${owes ? ui.primary : ''}`}>
        {owes ? 'Take payment on the bill' : 'The whole bill'}
      </Link>
    </>
  );
}

function ActivityTab({ items }: { items: ActivityItem[] }) {
  if (!items.length) return <p className={r.quiet}>Nothing recorded since they arrived.</p>;
  return (
    <ol className={r.activity}>
      {items.map((item) => (
        <li key={item.key}>
          <span className={r.activityWhen}>{item.day}, <span className="tabular">{item.time}</span></span>
          <span className={r.activityText}>{item.text}</span>
          <span className={r.activityWho}>{item.who}</span>
        </li>
      ))}
    </ol>
  );
}

function EmptyRoom({ propertyId, room, checkoutHours, permissions }: {
  propertyId: string; room: RoomView; checkoutHours: number[]; permissions: DeskPermissions;
}) {
  const stickerId = useId();
  return (
    <>
      <div className={r.chipRow}>
        <Pill status={occupancyOf(room)} />
        <Pill status={CLEAN[room.clean.status]} />
      </div>

      {room.clean.status === 'OUT_OF_ORDER' ? (
        <p className={r.callout} data-tone="crit">
          <Wrench size={16} strokeWidth={1.5} aria-hidden="true" />
          <span>Out of order{room.clean.note ? `: ${room.clean.note}` : ''}. Nobody can be checked in until it is back in order.</span>
        </p>
      ) : null}

      {permissions.checkIn && room.clean.status !== 'OUT_OF_ORDER' ? (
        <section className={r.drawer} aria-labelledby={`${stickerId}-in`}>
          <h3 id={`${stickerId}-in`} className={r.drawerTitle}>Check someone in</h3>
          {/* Said, not blocked: a desk at 2am with one room left will put
              a guest in it and send housekeeping straight up. */}
          {room.clean.status === 'DIRTY' ? (
            <p className={r.callout} data-tone="warn">
              <Brush size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>Not made up since the last guest. Send housekeeping up before they arrive.</span>
            </p>
          ) : null}
          <CheckIn propertyId={propertyId} room={room} checkoutHours={checkoutHours} />
        </section>
      ) : null}

      <RoomState propertyId={propertyId} room={room} permissions={permissions} />

      {/* The sticker's own link — a desk reprints stickers for empty rooms
          more often than full ones. */}
      {room.qr ? (
        <section className={r.group} aria-labelledby={`${stickerId}-h`}>
          <h3 id={`${stickerId}-h`} className={ui.lbl}>The sticker on the nightstand</h3>
          <GuestLink
            propertyId={propertyId}
            roomId={room.id}
            roomNumber={room.number}
            publicCode={room.qr.publicCode}
            url={room.qr.url}
            mayReprint={permissions.reprintQr}
            occupied={false}
          />
        </section>
      ) : null}
    </>
  );
}

/**
 * The housekeeping half of the room (D-096): the moves the person looking may
 * make. Each button is one state; out of order asks why.
 */
function RoomState({ propertyId, room, permissions }: { propertyId: string; room: RoomView; permissions: DeskPermissions }) {
  const status = room.clean.status;
  const moves: Array<{ to: RoomView['clean']['status']; label: string; allowed: boolean }> = [
    { to: 'CLEAN', label: status === 'OUT_OF_ORDER' ? 'Back in order, clean' : 'Mark clean', allowed: status !== 'CLEAN' && (status === 'OUT_OF_ORDER' ? permissions.outOfOrder : permissions.clean) },
    { to: 'INSPECTED', label: 'Inspected', allowed: status === 'CLEAN' && permissions.inspect },
    { to: 'DIRTY', label: 'Needs making up', allowed: (status === 'CLEAN' || status === 'INSPECTED') && permissions.clean },
  ];
  const visible = moves.filter((m) => m.allowed);
  const mayTakeOut = permissions.outOfOrder && status !== 'OUT_OF_ORDER' && !room.stay;
  if (!visible.length && !mayTakeOut) return null;
  return (
    <div className={r.group} data-room-state={status}>
      <h3 className={ui.lbl}>Housekeeping</h3>
      {visible.length ? (
        <div className={r.stateButtons}>
          {visible.map((m) => <StateButton key={m.to} propertyId={propertyId} roomId={room.id} to={m.to} label={m.label} />)}
        </div>
      ) : null}
      {mayTakeOut ? <OutOfOrder propertyId={propertyId} roomId={room.id} /> : null}
    </div>
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
      {state.error ? <span className={ui.error} role="alert">{state.error}</span> : null}
    </form>
  );
}

function OutOfOrder({ propertyId, roomId }: { propertyId: string; roomId: string }) {
  const [state, action] = useActionState<DeskState, FormData>(setRoomState, {});
  return (
    <details className={r.disclosure}>
      <summary className={r.disclosureHead}>Take it out of order</summary>
      <form action={action} className={`${ui.form} ${r.disclosureBody}`}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="roomId" value={roomId} />
        <input type="hidden" name="status" value="OUT_OF_ORDER" />
        <label className={ui.field}>
          <span className={ui.label}>What is wrong</span>
          <input name="note" className={ui.input} maxLength={160} required placeholder="AC not cooling — engineer booked" />
          <span className={ui.hint}>Nobody can be checked in until it is back in order.</span>
        </label>
        {state.error ? <p className={ui.error} role="alert">{state.error}</p> : null}
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
    <form action={action} className={ui.form}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="stayId" value={stay.id} />
      <div className={ui.grid2}>
        <label className={ui.field}>
          <span className={ui.label}>Date</span>
          <input name="date" type="date" className={ui.input} defaultValue={stay.checkoutDate} required />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>Out at</span>
          <select name="checkoutHour" className={ui.input} defaultValue={stay.checkoutHour}>
            {hours.map((hour) => (
              <option key={hour} value={hour}>{hour === 12 ? 'noon' : hour > 12 ? `${hour - 12}pm` : `${hour}am`}</option>
            ))}
          </select>
        </label>
      </div>
      <p className={ui.hint}>Staying on, or leaving early. Their phone works until the new time; add the extra nights on the bill.</p>
      {state.error ? <p className={ui.error} role="alert">{state.error}</p> : null}
      {state.done ? <p className={ui.done} role="status">{state.done}</p> : null}
      <SubmitButton label="Move the checkout" primary />
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
    <form action={action} className={ui.form}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="stayId" value={stayId} />
      <input type="hidden" name="roomId" value={room.id} />
      {/* Fresh after each one goes through, so a second request is a second
          request and a double tap is still one. */}
      <input type="hidden" name="idempotencyKey" value={state.done ? `${raiseKey.slice(0, 24)}${Date.now().toString(16).slice(-12).padStart(12, '0')}` : raiseKey} />
      <div className={ui.grid2}>
        <label className={`${ui.field} ${chosen?.allowsQuantity ? '' : ui.wide}`}>
          <span className={ui.label}>What they asked for</span>
          <select name="requestTypeId" className={ui.input} value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
            <option value="" disabled>Choose</option>
            {catalog.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        {chosen?.allowsQuantity ? (
          <label className={ui.field}>
            <span className={ui.label}>How many</span>
            <input name="quantity" type="number" min={1} max={chosen.maxQuantity} defaultValue={1} className={`${ui.input} tabular`} />
          </label>
        ) : null}
        <label className={`${ui.field} ${ui.wide}`}>
          <span className={ui.label}>Note</span>
          <input name="note" className={ui.input} maxLength={300} placeholder="Leave them outside the door" />
        </label>
      </div>
      {state.error ? <p className={ui.error} role="alert">{state.error}</p> : null}
      {state.done ? <p className={ui.done} role="status">{state.done}</p> : null}
      <SubmitButton label={`Raise it for ${room.number}`} primary />
    </form>
  );
}

function CheckIn({ propertyId, room, checkoutHours }: { propertyId: string; room: RoomView; checkoutHours: number[] }) {
  const [state, action] = useActionState<DeskState, FormData>(checkInGuest, {});

  return (
    <form action={action} className={ui.form}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="roomId" value={room.id} />

      <div className={ui.grid2}>
        <label className={`${ui.field} ${ui.wide}`}>
          <span className={ui.label}>Name</span>
          <input name="fullName" className={ui.input} required maxLength={160} autoComplete="off" />
        </label>

        <label className={`${ui.field} ${ui.wide}`}>
          <span className={ui.label}>Phone</span>
          <input name="phone" className={`${ui.input} tabular`} inputMode="tel" maxLength={32} placeholder="+91…" />
          {/* The identity key (EXTENSION-POINTS §2), and what the guest answers
              the one verification prompt with (D-012). */}
          <span className={ui.hint}>How a returning guest is recognised, and what they verify with.</span>
        </label>

        <label className={ui.field}>
          <span className={ui.label}>Nights</span>
          <input name="nights" type="number" min={1} max={60} defaultValue={1} className={`${ui.input} tabular`} required />
        </label>

        <label className={ui.field}>
          <span className={ui.label}>Out at</span>
          <select name="checkoutHour" defaultValue={11} className={ui.input}>
            {checkoutHours.map((hour) => (
              <option key={hour} value={hour}>{hour === 12 ? 'noon' : hour > 12 ? `${hour - 12}pm` : `${hour}am`}</option>
            ))}
          </select>
        </label>
      </div>

      {state.error ? <p className={ui.error} role="alert">{state.error}</p> : null}
      {state.done ? <p className={ui.done} role="status">{state.done}</p> : null}

      <SubmitButton label={`Check in to ${room.number}`} primary />
    </form>
  );
}

function CheckOut({ propertyId, stayId }: { propertyId: string; stayId: string }) {
  const [state, action] = useActionState<DeskState, FormData>(checkOutGuest, {});
  return (
    <form action={action} className={r.checkOut}>
      <input type="hidden" name="propertyId" value={propertyId} />
      <input type="hidden" name="stayId" value={stayId} />
      <SubmitButton label="Check out" primary />
      {state.error ? <span className={ui.error} role="alert">{state.error}</span> : null}
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
function Vouch({ propertyId, stayId, roomNumber }: { propertyId: string; stayId: string; roomNumber: string }) {
  const [state, action] = useActionState<DeskState, FormData>(vouchForRoom, {});

  return (
    <details className={r.disclosure}>
      <summary className={r.disclosureHead}>Vouch</summary>
      <form action={action} className={`${ui.form} ${r.disclosureBody}`}>
        <input type="hidden" name="propertyId" value={propertyId} />
        <input type="hidden" name="stayId" value={stayId} />
        <label className={ui.field}>
          <span className={ui.label}>How you know it is them</span>
          <input name="reason" className={ui.input} maxLength={200} placeholder="Confirmed passport at the desk" />
          <span className={ui.hint}>
            Room {roomNumber} can then charge to the room without being asked.
            They still answer the question themselves to see their bill.
          </span>
        </label>
        {state.error ? <p className={ui.error} role="alert">{state.error}</p> : null}
        {state.done ? <p className={ui.done} role="status">{state.done}</p> : null}
        <SubmitButton label="Vouch for them" />
      </form>
    </details>
  );
}

function SubmitButton({ label, primary = false }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`${ui.btn} ${primary ? ui.primary : ''}`} disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}
