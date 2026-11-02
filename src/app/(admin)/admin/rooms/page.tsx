import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { DoorOpen, LayoutGrid, List } from 'lucide-react';
import { withTenant, readEventHistory } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty } from '@/modules/identity';
import { listRoomsWithOccupancy, listCheckoutRequests } from '@/modules/stay';
import { roomCleanStates, cleanStateOf } from '@/modules/housekeeping';
import { getRequestCatalog, getOpenRequests } from '@/modules/requests';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { kitchenTickets, ordersOnBill } from '@/modules/ordering';
import { getFolioForStay, buildDeskBill, type OrderBreakdown } from '@/modules/billing';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { formatClock, formatCheckoutShort, formatFolioDate, localTimeAt, nightsUntil, toClock } from '@/lib/clock';
import { RoomRack, RoomPanel, type RoomView, type LiveItem, type FolioView, type ActivityItem } from './room-board';
import { RoomAside } from './room-aside';
import r from './rooms.module.css';
import ui from './controls.module.css';

/**
 * The front desk: every room, who is in it, and the two buttons that change
 * that.
 *
 * `createStay()` has been the only door a stay can be born through since P0
 * (#4) and its only callers were the seeder and the integration tests — so
 * check-in happened wherever it happened, and `stay:check_in` was a permission
 * nothing used. Check-OUT did not exist at all: `stay_status` has had
 * CHECKED_OUT since 0000 and nothing ever set it, which meant #10's promise
 * that "session tokens are revoked at checkout" held only because no checkout
 * had ever happened.
 *
 * Grouped by floor, in key-rack order, as a grid of tiles (or a list); a
 * room's actions open in a panel beside the rack at `?room=<number>` (D-094),
 * which is a full-screen sheet on a phone. Direction A's board is
 * `design/reference/direction-a/ConsoleRooms.dc.html`.
 */
export const dynamic = 'force-dynamic';

/**
 * Which rooms the rack shows. Links with `?show=`, like the desk's views
 * (D-061): the choice survives a reload and can be sent to somebody. All is
 * the default, because the rack is the one screen that lists every key.
 *
 * The board's "Arriving" is not here: there are no reservations to arrive
 * (booking is out of scope), so it would always say nought.
 */
const SHOWS = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'In house' },
  { key: 'out', label: 'Leaving today' },
  // D-096: what the desk can sell, and what housekeeping has to do.
  { key: 'ready', label: 'Ready to sell' },
  { key: 'dirty', label: 'To make up' },
  { key: 'ooo', label: 'Out of order' },
] as const;
type Show = (typeof SHOWS)[number]['key'];

const ORDER_WORD: Record<string, { word: string; tone: LiveItem['tone'] }> = {
  PLACED: { word: 'Waiting on the kitchen', tone: 'warn' },
  ACCEPTED: { word: 'Accepted', tone: 'info' },
  PREPARING: { word: 'Cooking', tone: 'info' },
  READY: { word: 'At the pass', tone: 'info' },
  OUT_FOR_DELIVERY: { word: 'On the way up', tone: 'accent' },
};

const ROOM_STATE_WORD: Record<string, string> = {
  CLEAN: 'clean', DIRTY: 'to make up', INSPECTED: 'inspected', OUT_OF_ORDER: 'out of order',
};

export default async function RoomsAdmin({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; room?: string; view?: string }>;
}) {
  const params = await searchParams;
  const requested = params.show;
  const show: Show = SHOWS.some((s) => s.key === requested) ? (requested as Show) : 'all';
  const layout: 'grid' | 'list' = params.view === 'list' ? 'list' : 'grid';
  const access = await adminAccess('stay:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  /**
   * `qr:read` is its own permission (FRONT_DESK and PROPERTY_ADMIN hold it). A
   * public code is the one thing on this screen that works from outside the
   * building — anyone holding it can reach the room's guest surface — so it is
   * not fetched at all for an account that may not see it.
   */
  const maySeeQr = can(session, propertyId, 'qr:read');
  const mayUpdateStay = can(session, propertyId, 'stay:update');
  const maySeeRequests = can(session, propertyId, 'request:read');
  const maySeeOrders = can(session, propertyId, 'order:read');
  const maySeeBill = can(session, propertyId, 'folio:read');

  const { property, occupancy, cleanStates, catalog, requests, tickets, lateAsks } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const outlet = maySeeOrders ? await getInRoomDiningOutletConfig(tx, propertyId) : null;
      return {
        property: await findProperty(tx, propertyId),
        occupancy: await listRoomsWithOccupancy(tx, { propertyId, withQrCodes: maySeeQr }),
        cleanStates: await roomCleanStates(tx, { propertyId }),
        // What a guest who rings down can be given, for the desk's form.
        catalog: mayUpdateStay ? await getRequestCatalog(tx, { propertyId }) : [],
        // What is live in each room — the same reads the Front desk makes,
        // skipped for an account that cannot open the screen behind them.
        requests: maySeeRequests ? await getOpenRequests(tx, { propertyId }) : [],
        tickets: outlet ? await kitchenTickets(tx, { outletId: outlet.id }) : [],
        lateAsks: await listCheckoutRequests(tx, { propertyId, statuses: ['REQUESTED'] }),
      };
    },
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const now = new Date();
  const clock = (at: Date) => formatClock(toClock(localTimeAt(at, timeZone).minutes));
  // "Mon, 2 Nov · 2:10pm" — the panel's arrival and departure.
  const dayAndTime = (at: Date) => {
    const day = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone }).format(at);
    return { day, time: clock(at) };
  };

  /**
   * Where a guest's phone should reach us.
   *
   * `APP_URL` and NOT anything derived from this request: `output: 'standalone'`
   * binds 0.0.0.0, so a URL built from `request.url` behind Railway's proxy is
   * an internal hostname — the same trap that made redirects relative. When it
   * is unset the client falls back to its own `window.location.origin`, which is
   * the origin the admin is actually on and is right whenever the two surfaces
   * share a domain.
   */
  const guestLinkBase = process.env.APP_URL?.replace(/\/+$/, '') ?? null;

  /**
   * What is live in each room, keyed by number. D-079: a visit order has no
   * room and belongs on no room's tile.
   */
  const liveIn = new Map<string, LiveItem[]>();
  const push = (room: string, item: LiveItem) => liveIn.set(room, [...(liveIn.get(room) ?? []), item]);
  for (const ticket of tickets) {
    if (!ticket.roomNumber) continue;
    const word = ORDER_WORD[ticket.status] ?? { word: ticket.status.toLowerCase().replace(/_/g, ' '), tone: 'neutral' as const };
    const dishes = ticket.lines.map((l) => l.name);
    push(ticket.roomNumber, {
      key: `o-${ticket.id}`,
      label: dishes.length ? `${dishes.slice(0, 2).join(', ')}${dishes.length > 2 ? ` +${dishes.length - 2}` : ''}` : 'Order',
      ref: ticket.orderNumber,
      status: word.word,
      tone: word.tone,
      short: `Order ${word.word.toLowerCase()}`,
    });
  }
  for (const request of requests) {
    const what = request.lines.map((l) => (l.quantity > 1 ? `${l.label} ×${l.quantity}` : l.label)).join(', ') || 'Request';
    push(request.roomNumber, {
      key: `r-${request.id}`,
      label: what,
      ref: request.requestNumber,
      status: request.breached ? 'Late' : request.assignedStaffName ?? 'Nobody has it',
      tone: request.breached ? 'crit' : request.assignedStaffName ? 'neutral' : 'warn',
      short: request.breached ? 'Request late' : `${what} on the way`,
    });
  }
  for (const ask of lateAsks) {
    push(ask.roomNumber, {
      key: `c-${ask.id}`,
      label: `Late checkout to ${formatCheckoutShort(ask.requestedCheckoutAt, timeZone)}`,
      ref: null,
      status: 'Needs an answer',
      tone: 'warn',
      short: 'Late checkout asked',
    });
  }

  const rooms: RoomView[] = occupancy.map((room) => {
    const leavingAt = room.stay ? dayAndTime(room.stay.scheduledCheckoutAt) : null;
    const arrivedAt = room.stay?.checkedInAt ? dayAndTime(room.stay.checkedInAt) : null;
    return {
      id: room.id,
      number: room.number,
      floorName: room.floorName,
      roomTypeName: room.roomTypeName,
      qr: room.qr
        ? {
          publicCode: room.qr.publicCode,
          // The absolute link, built here so every row agrees and nothing has to
          // reassemble it in the browser.
          url: guestLinkBase ? `${guestLinkBase}/r/${room.qr.publicCode}` : null,
        }
        : null,
      clean: (() => {
        const state = cleanStateOf(cleanStates, room.id);
        return { status: state.status, note: state.note };
      })(),
      live: liveIn.get(room.number) ?? [],
      stay: room.stay
        ? {
          id: room.stay.id,
          guestId: room.stay.guestId,
          guestName: room.stay.guestName,
          guestPhone: room.stay.guestPhone,
          isVip: room.stay.isVip,
          notes: room.stay.staffNotes,
          arrived: arrivedAt,
          leaving: leavingAt!,
          // The change-checkout form starts at today's date and hour, in the
          // property's own time.
          checkoutDate: localTimeAt(room.stay.scheduledCheckoutAt, timeZone).date ?? '',
          checkoutHour: Math.floor(localTimeAt(room.stay.scheduledCheckoutAt, timeZone).minutes / 60),
          // The column form: a full weekday either truncates here or takes the
          // width the guest's name needs.
          dueOut: formatCheckoutShort(room.stay.scheduledCheckoutAt, timeZone),
          // Zero means today, which is the number a desk is actually working from.
          nightsLeft: nightsUntil(now, room.stay.scheduledCheckoutAt, timeZone),
          // Still in the room after their time: the one row a desk most needs.
          late: room.stay.scheduledCheckoutAt.getTime() < now.getTime(),
          // Null is "nothing has ever been charged", which is not the same as ₹0
          // and must not read as it.
          balance: room.stay.balanceMinor === null
            ? null
            : formatMoney(money(room.stay.balanceMinor, room.stay.currency)),
          owes: (room.stay.balanceMinor ?? 0) > 0,
        }
        : null,
    };
  });

  const occupied = rooms.filter((room) => room.stay).length;
  // Sellable: empty, made up (or inspected), and not out of order.
  const isReady = (room: RoomView) => !room.stay && (room.clean.status === 'CLEAN' || room.clean.status === 'INSPECTED');
  const matches: Record<Show, (room: RoomView) => boolean> = {
    all: () => true,
    in: (room) => !!room.stay,
    out: (room) => room.stay?.nightsLeft === 0,
    ready: isReady,
    dirty: (room) => room.clean.status === 'DIRTY',
    ooo: (room) => room.clean.status === 'OUT_OF_ORDER',
  };
  const shown = rooms.filter(matches[show]);
  const counts = Object.fromEntries(SHOWS.map((s) => [s.key, rooms.filter(matches[s.key]).length])) as Record<Show, number>;
  const floorCount = new Set(rooms.map((room) => room.floorName)).size;

  /**
   * The open room, by NUMBER (`?room=214`): what a desk says out loud, and a
   * URL one person can send another. It can be any room, not only one the
   * filter shows — a link to an empty room stays good after check-in.
   */
  const selected = params.room ? rooms.find((room) => room.number === params.room) ?? null : null;
  const query = (next: { show?: Show; view?: 'grid' | 'list'; room?: string | null }) => {
    const q = new URLSearchParams();
    const s = next.show ?? show;
    const v = next.view ?? layout;
    if (s !== 'all') q.set('show', s);
    if (v !== 'grid') q.set('view', v);
    const room = next.room === undefined ? null : next.room;
    if (room) q.set('room', room);
    const text = q.toString();
    return text ? `/admin/rooms?${text}` : '/admin/rooms';
  };
  const base = query({});
  const linkFor = Object.fromEntries(shown.map((room) => [room.number, query({ room: room.number })]));

  const mayCheckIn = can(session, propertyId, 'stay:check_in');
  // Walk-in: the first room that can be sold, then any empty room that is not
  // out of order. Its panel IS the check-in form.
  const walkIn = mayCheckIn
    ? rooms.find(isReady) ?? rooms.find((room) => !room.stay && room.clean.status !== 'OUT_OF_ORDER') ?? null
    : null;

  // The hours a desk actually picks between, offered rather than hardcoded into
  // the action — there is no property-level standard checkout hour in the
  // schema, and inventing one in a form would be a business value in the wrong
  // place.
  const checkoutHours = [10, 11, 12, 14];

  /**
   * The selected room's bill and history — read only for the one room open,
   * with the same calls the checkout screen makes, so the panel's Folio tab
   * and the bill cannot disagree.
   */
  const detail = selected?.stay
    ? await withTenant({ tenantId: session.tenantId, propertyId }, async (tx) => {
      const stay = selected.stay!;
      const folio = maySeeBill ? await getFolioForStay(tx, stay.id) : null;
      const orderIds = (folio?.lines ?? []).filter((l) => l.source === 'ORDER' && l.sourceRefId).map((l) => l.sourceRefId!);
      return {
        folio,
        orders: folio ? await ordersOnBill(tx, { propertyId, orderIds }) : new Map(),
        stayEvents: await readEventHistory(tx, 'stay', stay.id),
        roomEvents: await readEventHistory(tx, 'room', selected.id),
      };
    })
    : null;

  let folioView: FolioView | null = null;
  if (detail?.folio) {
    const currency = (detail.folio.currency ?? 'INR') as CurrencyCode;
    const fmt = (minor: number) => formatMoney(money(minor, currency));
    const bill = buildDeskBill({ lines: detail.folio.lines }, detail.orders as ReadonlyMap<string, OrderBreakdown>);
    folioView = {
      sections: bill.sections.map((section) => ({
        key: section.key,
        title: section.title,
        count: section.lines.length,
        total: fmt(section.totalMinor),
        lines: section.lines.map((line) => ({
          id: line.id,
          description: line.description,
          sub: [formatFolioDate(line.createdAt, timeZone), line.detail].filter(Boolean).join(' · '),
          amount: fmt(line.amountMinor),
          isCredit: line.amountMinor < 0,
        })),
      })),
      payments: bill.payments.map((p) => ({
        id: p.id,
        description: p.description,
        date: formatFolioDate(p.createdAt, timeZone),
        amount: fmt(Math.abs(p.amountMinor)),
        isRefund: p.isRefund,
      })),
      charges: fmt(bill.chargesMinor),
      balance: fmt(Math.abs(bill.balanceMinor)),
      balanceMinor: bill.balanceMinor,
      settled: detail.folio.status === 'SETTLED',
    };
  }

  /**
   * What happened to this stay and this room since they arrived, newest
   * first, from the event log (#7). The log names who acted by kind only.
   */
  let activity: ActivityItem[] = [];
  if (detail && selected?.stay) {
    const since = occupancy.find((o) => o.id === selected.id)?.stay?.checkedInAt ?? null;
    const at = (value: unknown) => new Date(value as string | Date);
    const who = (kind: unknown) => ({ STAFF: 'Staff', SYSTEM: 'Automatic', GUEST: 'Guest', CUSTOMER: 'Guest' }[String(kind)] ?? 'Staff');
    const describe = (row: Record<string, unknown>): string | null => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      switch (row.event_type) {
        case 'stay.created': return 'Checked in';
        case 'stay.checked_out': return 'Checked out';
        case 'stay.checkout_changed':
          return typeof payload.to === 'string'
            ? `Checkout moved to ${formatCheckoutShort(new Date(payload.to), timeZone)}`
            : 'Checkout moved';
        case 'guest_session.vouched': return 'Vouched for at the desk';
        case 'room.status_changed':
          return `Room marked ${ROOM_STATE_WORD[String(row.to_status)] ?? String(row.to_status).toLowerCase()}`
            + (typeof payload.note === 'string' ? ` — ${payload.note}` : '');
        case 'qr.regenerated': return 'New sticker issued';
        default: return null;
      }
    };
    activity = [...detail.stayEvents, ...detail.roomEvents]
      .filter((row) => !since || at(row.occurred_at).getTime() >= since.getTime() - 60_000)
      .map((row) => ({ row, text: describe(row) }))
      .filter((item): item is { row: Record<string, unknown>; text: string } => item.text !== null)
      .sort((a, b) => at(b.row.occurred_at).getTime() - at(a.row.occurred_at).getTime())
      .slice(0, 30)
      .map(({ row, text }, index) => {
        const when = dayAndTime(at(row.occurred_at));
        return { key: `${index}-${String(row.event_type)}`, text, day: when.day, time: when.time, who: who(row.actor_kind) };
      });
  }

  const summary = [
    `${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} on ${floorCount} ${floorCount === 1 ? 'floor' : 'floors'}`,
    `${occupied} in house`,
    counts.dirty ? `${counts.dirty} to make up` : null,
    counts.out ? `${counts.out} leaving today` : null,
  ].filter(Boolean).join(' · ');

  const filters = SHOWS.map((s) => ({
    key: s.key,
    label: s.label,
    count: counts[s.key],
    href: query({ show: s.key }),
    current: show === s.key,
  }));
  const emptyText = shown.length === 0
    ? {
      out: 'Nobody is due out today.', in: 'Nobody is in house.', ready: 'No empty room is ready to sell.',
      dirty: 'Every room is made up.', ooo: 'No room is out of order.', all: 'There are no rooms.',
    }[show]
    : null;

  return (
    <div className={r.page} data-panel={selected ? 'open' : undefined}>
      <div className={r.rackColumn}>
        <header className={r.head}>
          <div className={r.headText}>
            <h1 className={r.title}>Rooms</h1>
            <p className={r.summary}>{summary}</p>
          </div>
          <div className={r.headActions}>
            {walkIn ? (
              <Link href={query({ room: walkIn.number })} scroll={false} className={`${ui.btn} ${ui.primary}`}>
                <DoorOpen size={16} strokeWidth={1.5} aria-hidden="true" /> Walk-in check-in
              </Link>
            ) : null}
            <div role="group" aria-label="View" className={r.viewToggle}>
              <Link href={query({ view: 'grid', room: selected?.number ?? null })} scroll={false} className={r.viewOption} aria-current={layout === 'grid' ? 'true' : undefined}>
                <LayoutGrid size={14} strokeWidth={1.5} aria-hidden="true" /> Grid
              </Link>
              <Link href={query({ view: 'list', room: selected?.number ?? null })} scroll={false} className={r.viewOption} aria-current={layout === 'list' ? 'true' : undefined}>
                <List size={14} strokeWidth={1.5} aria-hidden="true" /> List
              </Link>
            </div>
          </div>
        </header>

        <RoomRack
          rooms={shown}
          layout={layout}
          linkFor={linkFor}
          selected={selected?.number ?? null}
          filters={filters}
          empty={emptyText ? { text: emptyText, allHref: query({ show: 'all' }) } : null}
        />

        <p className={r.footnote}>
          Checking someone out frees the room, ends every session on their phone
          (#10), records what was still on the bill, and marks the room to be made
          up. A guest who owes anything is checked out from their bill, where the
          payment is taken.
        </p>
      </div>

      {selected ? (
        <RoomAside label={`Room ${selected.number}`} closeHref={base}>
          <RoomPanel
            propertyId={propertyId}
            room={selected}
            closeHref={base}
            checkoutHours={checkoutHours}
            deskHref={`/admin/desk?filter=all&room=${selected.id}`}
            folio={folioView}
            activity={activity}
            permissions={{
              checkIn: mayCheckIn,
              checkOut: can(session, propertyId, 'stay:check_out'),
              vouch: can(session, propertyId, 'guest:vouch'),
              // Its own permission since S5, with nothing calling it until now.
              reprintQr: maySeeQr && can(session, propertyId, 'qr:regenerate'),
              clean: can(session, propertyId, 'request:advance'),
              inspect: can(session, propertyId, 'request:verify'),
              outOfOrder: can(session, propertyId, 'room:manage'),
              updateStay: mayUpdateStay,
              seeBill: maySeeBill,
            }}
            catalog={catalog.map((type) => ({
              id: type.id,
              label: type.priceMinor > 0 ? `${type.name} · ${formatMoney(money(type.priceMinor, type.currency))}` : type.name,
              allowsQuantity: type.allowsQuantity,
              maxQuantity: type.maxQuantity,
            }))}
            raiseKey={randomUUID()}
          />
        </RoomAside>
      ) : null}
    </div>
  );
}
