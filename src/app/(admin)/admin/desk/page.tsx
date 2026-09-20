import Link from 'next/link';
import { withTenant } from '@/db';
import { can, findProperty } from '@/modules/identity';
import { adminAccess, AdminDenied } from '../guard';
import { listRoomsWithOccupancy, listCheckoutRequests, effectiveFeeMinor } from '@/modules/stay';
import { getOpenRequests } from '@/modules/requests';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { kitchenTickets } from '@/modules/ordering';
import { getFolioForStay } from '@/modules/billing';
import { formatMoney } from '@/lib/money';
import {
  formatCheckoutShort, formatFolioDate, formatMinutes, nightsUntil, spellCount,
} from '@/lib/clock';
import { AdminShell } from '../admin-shell';
import { LiveConsole } from '../live-console';
import { DeskPanel } from './desk-panel';
import type { FolioLineView, LateCheckoutView, PanelPermissions } from './desk-panel';
import styles from './desk.module.css';

/**
 * The front desk, as one screen.
 *
 * ─── Why this exists next to `/admin/rooms` rather than replacing it ───────
 *
 * They answer different questions. `/admin/rooms` is the key rack: every room
 * on every floor, and the two buttons that check somebody in or out. This is
 * the DESK — one room at a time, with everything open against it in one place:
 * what they have ordered, what they have asked for, what they owe, and the one
 * decision waiting on a human.
 *
 * The console had that information spread across four screens, and answering
 * "what is going on in 214" meant opening all four and holding the answer in
 * your head while the guest was on the phone.
 *
 * ─── Why selection lives in the URL ────────────────────────────────────────
 *
 * `?room=` and `?view=`, not React state. Three reasons, in order of how much
 * they cost when you get it wrong:
 *
 *   1. The folio for the selected stay is a QUERY. Client-side selection means
 *      either fetching 34 folios nobody asked for, or a loading spinner in the
 *      panel every time somebody clicks a row.
 *   2. A desk refreshes this screen all morning. State in the URL survives it.
 *   3. "Look at 214" is a thing one person says to another across a desk, and
 *      a URL is how you say it.
 */
export const dynamic = 'force-dynamic';

type Search = Promise<{ view?: string; room?: string; filter?: string }>;

const VIEWS = [
  { key: 'rooms', label: 'Rooms' },
  { key: 'requests', label: 'Requests' },
  { key: 'orders', label: 'Orders' },
] as const;

/**
 * `needs` is FIRST and it is the default.
 *
 * The desk opened on All, which at this property means thirty vacant rooms
 * before the four that have anything happening in them. A front desk does not
 * come to this screen to read 001–104; they come because a phone rang, and the
 * rooms with an open order, an open request or a decision waiting are the only
 * rows that can answer it.
 *
 * The others stay one tap away, and the empty state says so — a filter that can
 * legitimately be empty has to offer the way out of itself.
 */
const FILTERS = [
  { key: 'needs', label: 'Needs you' },
  { key: 'occupied', label: 'In house' },
  { key: 'leaving', label: 'Leaving today' },
  { key: 'vacant', label: 'Vacant' },
  { key: 'all', label: 'All' },
] as const;

export default async function FrontDesk({ searchParams }: { searchParams: Search }) {
  const access = await adminAccess('stay:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const params = await searchParams;
  const view = VIEWS.find((v) => v.key === params.view)?.key ?? 'rooms';
  const filter = FILTERS.find((f) => f.key === params.filter)?.key ?? 'needs';

  const maySeeRequests = can(session, propertyId, 'request:read');
  const maySeeOrders = can(session, propertyId, 'order:read');

  const { property, rooms, requests, tickets, checkouts } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const outlet = maySeeOrders ? await getInRoomDiningOutletConfig(tx, propertyId) : null;
      return {
        property: await findProperty(tx, propertyId),
        rooms: await listRoomsWithOccupancy(tx, { propertyId }),
        // Each of these is the same call the screen behind it already makes,
        // and is skipped entirely for an account that cannot open that screen.
        requests: maySeeRequests ? await getOpenRequests(tx, { propertyId }) : [],
        tickets: outlet ? await kitchenTickets(tx, { outletId: outlet.id }) : [],
        checkouts: await listCheckoutRequests(tx, { propertyId }),
      };
    },
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const now = new Date();

  /**
   * What is open against each room, for the "Open now" column.
   *
   * Built once as a map rather than filtered per row: three arrays scanned for
   * each of 34 rooms is 102 passes to draw one column.
   */
  const openBy = new Map<string, { orders: number; requests: number; decision: boolean }>();
  const bump = (room: string, key: 'orders' | 'requests') => {
    const found = openBy.get(room) ?? { orders: 0, requests: 0, decision: false };
    found[key] += 1;
    openBy.set(room, found);
  };
  for (const ticket of tickets) bump(ticket.roomNumber, 'orders');
  for (const request of requests) bump(request.roomNumber, 'requests');
  for (const checkout of checkouts) {
    const found = openBy.get(checkout.roomNumber)
      ?? { orders: 0, requests: 0, decision: false };
    found.decision = true;
    openBy.set(checkout.roomNumber, found);
  }

  /**
   * Which room the panel is showing.
   *
   * Falling back to the first room that NEEDS something rather than the first
   * room on the first floor: a desk opening this screen cold is looking for
   * what wants them, and 101 is almost never it.
   */
  const selected = rooms.find((room) => room.id === params.room)
    ?? rooms.find((room) => openBy.get(room.number)?.decision)
    ?? rooms.find((room) => openBy.has(room.number))
    ?? rooms.find((room) => room.stay)
    ?? rooms[0]
    ?? null;

  const folio = selected?.stay
    ? await withTenant(
      { tenantId: session.tenantId, propertyId },
      (tx) => getFolioForStay(tx, selected.stay!.id),
    )
    : null;

  const lateCheckout = selected
    ? checkouts.find((c) => c.roomNumber === selected.number) ?? null
    : null;

  const visibleRooms = rooms.filter((room) => {
    if (filter === 'needs') return openBy.has(room.number);
    if (filter === 'occupied') return !!room.stay;
    if (filter === 'vacant') return !room.stay;
    if (filter === 'leaving') {
      return !!room.stay && nightsUntil(now, room.stay.scheduledCheckoutAt, timeZone) === 0;
    }
    return true;
  });

  const inHouse = rooms.filter((room) => room.stay).length;

  const href = (next: Partial<{ view: string; room: string; filter: string }>) => {
    const query = new URLSearchParams();
    const merged = { view, room: selected?.id ?? '', filter, ...next };
    if (merged.view !== 'rooms') query.set('view', merged.view);
    if (merged.filter !== 'needs') query.set('filter', merged.filter);
    if (merged.room) query.set('room', merged.room);
    const search = query.toString();
    return search ? `/admin/desk?${search}` : '/admin/desk';
  };

  const panelPermissions: PanelPermissions = {
    decide: can(session, propertyId, 'checkout_request:approve'),
    overrideFee: can(session, propertyId, 'checkout_request:override_fee'),
    checkOut: can(session, propertyId, 'stay:check_out'),
    seeGuest: can(session, propertyId, 'guest:read'),
  };

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
      current="desk"
    >
      <div className={styles.desk}>
        <header className={styles.head}>
          <h1 className={styles.title}>Front desk</h1>
          <p className={styles.subtitle}>
            {spellCount(rooms.length)} {rooms.length === 1 ? 'room' : 'rooms'} · {inHouse} in house
          </p>
          {/* The desk leaves this open all shift. Without it the screen is only
              right at the moment somebody reloads it. */}
          <LiveConsole
            propertyId={propertyId}
            orders={maySeeOrders}
            requests={maySeeRequests}
          />
          <nav className={styles.views} aria-label="What to list">
            {VIEWS.map((option) => {
              const off = (option.key === 'requests' && !maySeeRequests)
                || (option.key === 'orders' && !maySeeOrders);
              if (off) return null;
              return (
                <Link
                  key={option.key}
                  href={href({ view: option.key })}
                  className={styles.view}
                  aria-current={option.key === view ? 'page' : undefined}
                >
                  {option.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <div className={styles.body}>
          <div className={styles.list}>
            {view === 'rooms' ? (
              <>
                <div className={styles.filters}>
                  {FILTERS.map((option) => (
                    <Link
                      key={option.key}
                      href={href({ filter: option.key })}
                      className={styles.filter}
                      aria-current={option.key === filter ? 'page' : undefined}
                    >
                      {option.label}
                    </Link>
                  ))}
                </div>

                <div className={styles.table}>
                  <div className={`${styles.row} ${styles.tableHead}`}>
                    <span>Room</span><span>Guest</span><span>Status</span>
                    <span>Checkout</span><span>Open now</span>
                    <span className={styles.right}>Folio</span>
                  </div>

                  {visibleRooms.length ? visibleRooms.map((room) => {
                    const open = openBy.get(room.number);
                    const leaving = room.stay
                      && nightsUntil(now, room.stay.scheduledCheckoutAt, timeZone) === 0;
                    return (
                      <Link
                        key={room.id}
                        href={href({ room: room.id })}
                        className={`${styles.row} ${styles.roomRow}`}
                        aria-current={room.id === selected?.id ? 'true' : undefined}
                        data-state={room.stay ? (leaving ? 'leaving' : 'occupied') : 'vacant'}
                      >
                        <span className={`${styles.roomNumber} tabular`}>{room.number}</span>
                        {/* An empty room's GUEST is nobody. The status column
                            two cells right already says "Vacant"; repeating the
                            room type here put "Haveli room" down thirty rows
                            and buried the three names that matter. */}
                        <span className={styles.guest}>
                          {room.stay?.guestName ?? '—'}
                        </span>
                        <span className={styles.status}>
                          <span className={styles.dot} aria-hidden="true" />
                          {room.stay ? (leaving ? 'Leaving today' : 'In house') : 'Vacant'}
                        </span>
                        <span className={`${styles.when} tabular`}>
                          {room.stay
                            ? formatCheckoutShort(room.stay.scheduledCheckoutAt, timeZone)
                            : '—'}
                        </span>
                        <span className={styles.open} data-decision={open?.decision ?? false}>
                          {describeOpen(open)}
                        </span>
                        <span className={`${styles.folio} tabular`}>
                          {room.stay?.balanceMinor != null
                            ? formatMoney({
                              amountMinor: room.stay.balanceMinor,
                              currency: room.stay.currency,
                            })
                            : '—'}
                        </span>
                      </Link>
                    );
                  }) : (
                    <p className={styles.tableEmpty}>
                      {filter === 'needs' ? (
                        <>
                          Nothing open. The floor is quiet.{' '}
                          <Link href={href({ filter: 'all' })}>Show every room</Link>
                        </>
                      ) : 'No rooms match that filter.'}
                    </p>
                  )}
                </div>
              </>
            ) : null}

            {view === 'requests' && maySeeRequests ? (
              <div className={styles.table}>
                <div className={`${styles.row} ${styles.requestRow} ${styles.tableHead}`}>
                  <span>Room</span><span>Request</span><span>With</span><span>State</span>
                  <span className={styles.right}>Promise</span>
                </div>
                {requests.length ? requests.map((request) => (
                  <Link
                    key={request.id}
                    href={href({
                      room: rooms.find((r) => r.number === request.roomNumber)?.id ?? '',
                    })}
                    className={`${styles.row} ${styles.requestRow}`}
                    data-state={request.status === 'OPEN' ? 'unclaimed' : 'occupied'}
                  >
                    <span className={`${styles.roomNumber} tabular`}>{request.roomNumber}</span>
                    <span className={styles.guest}>
                      {request.lines.map((l) => l.label).join(', ') || request.requestNumber}
                    </span>
                    <span className={styles.when}>
                      {request.assignedStaffName ?? 'Unassigned'}
                    </span>
                    <span className={styles.status}>
                      <span className={styles.dot} aria-hidden="true" />
                      {titleCase(request.status)}
                    </span>
                    <span className={`${styles.promise} tabular`} data-late={request.breached}>
                      {describeSla(request.breached, request.secondsRemaining)}
                    </span>
                  </Link>
                )) : (
                  <p className={styles.tableEmpty}>Nothing open on any floor.</p>
                )}
              </div>
            ) : null}

            {view === 'orders' && maySeeOrders ? (
              <div className={styles.table}>
                <div className={`${styles.row} ${styles.orderRow} ${styles.tableHead}`}>
                  <span>Order</span><span>Room</span><span>Items</span>
                  <span className={styles.right}>State</span>
                </div>
                {tickets.length ? tickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={href({
                      room: rooms.find((r) => r.number === ticket.roomNumber)?.id ?? '',
                    })}
                    className={`${styles.row} ${styles.orderRow}`}
                  >
                    <span className={`${styles.when} tabular`}>{ticket.orderNumber}</span>
                    <span className={`${styles.roomNumber} tabular`}>{ticket.roomNumber}</span>
                    <span className={styles.guest}>
                      {ticket.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}
                    </span>
                    <span className={`${styles.status} ${styles.right}`}>
                      <span className={styles.dot} aria-hidden="true" />
                      {titleCase(ticket.status)}
                    </span>
                  </Link>
                )) : (
                  <p className={styles.tableEmpty}>No orders open in the kitchen.</p>
                )}
              </div>
            ) : null}
          </div>

          <DeskPanel
            propertyId={propertyId}
            room={selected ? {
              id: selected.id,
              number: selected.number,
              floorName: selected.floorName,
              roomTypeName: selected.roomTypeName,
            } : null}
            stay={selected?.stay ? {
              id: selected.stay.id,
              guestId: selected.stay.guestId,
              guestName: selected.stay.guestName,
              guestPhone: selected.stay.guestPhone,
              dueOut: formatCheckoutShort(selected.stay.scheduledCheckoutAt, timeZone),
              nightsLeft: nightsUntil(now, selected.stay.scheduledCheckoutAt, timeZone),
            } : null}
            live={selected ? [
              ...tickets
                .filter((t) => t.roomNumber === selected.number)
                .map((t) => ({
                  id: t.id,
                  title: `Order ${t.orderNumber}`,
                  meta: titleCase(t.status).toLowerCase(),
                  tone: 'accent' as const,
                })),
              ...requests
                .filter((r) => r.roomNumber === selected.number)
                .map((r) => ({
                  id: r.id,
                  title: r.lines.map((l) => l.label).join(', ') || r.requestNumber,
                  meta: describeSla(r.breached, r.secondsRemaining),
                  tone: r.breached ? ('critical' as const) : ('attention' as const),
                })),
            ] : []}
            lateCheckout={lateCheckout ? toLateCheckout(lateCheckout, timeZone) : null}
            folio={folio ? {
              /**
               * The most recent dozen, newest first.
               *
               * A four-night stay that has ordered dinner every night runs to
               * twenty lines, and the panel rendered all of them — which pushed
               * "Total so far" below the fold of a 900px screen. The number a
               * desk is asked for on the phone was the one thing they had to
               * scroll for. The rest stay on the guest profile, where reading a
               * whole bill is the point.
               */
              lines: folio.lines.slice(-12).reverse().map((line): FolioLineView => ({
                id: line.id,
                date: formatFolioDate(line.createdAt, timeZone),
                description: line.description,
                amount: formatMoney({
                  amountMinor: line.amountMinor,
                  currency: folio.currency as 'INR',
                }),
              })),
              total: formatMoney({
                amountMinor: folio.balanceMinor,
                currency: folio.currency as 'INR',
              }),
              /** How many older lines are not shown, so the panel never implies
               *  the total is the sum of what is on screen. */
              hidden: Math.max(0, folio.lines.length - 12),
              settled: folio.status !== 'OPEN',
            } : null}
            permissions={panelPermissions}
          />
        </div>
      </div>
    </AdminShell>
  );
}

/** "2 orders, 1 request, late checkout" — or an em dash. */
function describeOpen(
  open: { orders: number; requests: number; decision: boolean } | undefined,
): string {
  if (!open) return '—';
  const parts = [
    open.orders ? `${open.orders} order${open.orders > 1 ? 's' : ''}` : null,
    open.requests ? `${open.requests} request${open.requests > 1 ? 's' : ''}` : null,
    open.decision ? 'late checkout' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

/**
 * The promise, from the request's own countdown.
 *
 * `secondsRemaining` is computed against the clock by `getOpenRequests` and is
 * never stored — a breach is a function of time, not a column.
 */
function describeSla(breached: boolean, secondsRemaining: number | null): string {
  if (secondsRemaining === null) return '—';
  const span = formatMinutes(Math.abs(secondsRemaining) / 60);
  return breached ? `over by ${span}` : `${span} left`;
}

function toLateCheckout(
  request: Awaited<ReturnType<typeof listCheckoutRequests>>[number],
  timeZone: string,
): LateCheckoutView {
  const fee = effectiveFeeMinor(request);
  return {
    id: request.id,
    wants: formatCheckoutShort(request.requestedCheckoutAt, timeZone),
    dueOut: formatCheckoutShort(request.scheduledCheckoutAt, timeZone),
    askedAt: formatCheckoutShort(request.createdAt, timeZone),
    agreedFee: formatMoney({ amountMinor: request.feeMinor, currency: request.currency }),
    /** Zero is a waiver and has to read as one — not as "no fee configured". */
    effectiveFee: formatMoney({ amountMinor: fee, currency: request.currency }),
    isFree: fee === 0,
  };
}

/** `IN_PROGRESS` → `In progress`. */
function titleCase(value: string): string {
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
