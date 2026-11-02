import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty } from '@/modules/identity';
import { listCheckoutRequests, listDeparturesToday, listUnpaidDepartures } from '@/modules/stay';
import { collectionsToday } from '@/modules/billing';
import { getOpenRequests } from '@/modules/requests';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { kitchenTickets } from '@/modules/ordering';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { formatCheckoutDay, formatClock, formatFolioDate, localTimeAt, toClock } from '@/lib/clock';
import { CheckoutQueue, type DeskRequestView } from './checkout-queue';
import { DueOut, LeftToday, type DueView, type LeftView } from './departures';
import { Collections, LeftOwing, type CollectionView, type OwingView } from './money';
import l from './leaving.module.css';
import styles from '../admin.module.css';

/**
 * Today's departures, and the late checkouts waiting on the desk (D-094).
 *
 * The late-checkout queue still comes first: oldest first, and it empties. A
 * guest who asked at 9am for 2pm needs an answer well before 2pm. Below it is
 * the rest of a desk's morning — who is due out (overdue first to the eye),
 * what they still owe, what is still on its way to their room, and who has
 * already gone with something left on the bill. That screen used to be only
 * the queue, which on most mornings is empty while six rooms are leaving.
 *
 * Approving is not a note in a diary — it moves `stays.scheduled_checkout_at`,
 * posts the fee to the folio and pushes out every live session on the stay, all
 * in one transaction (`decideCheckoutRequest`). This screen is the only way to
 * do any of that.
 */
export const dynamic = 'force-dynamic';

export default async function CheckoutsAdmin() {
  const access = await adminAccess('stay:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const maySeeRequests = can(session, propertyId, 'request:read');
  const maySeeOrders = can(session, propertyId, 'order:read');
  const maySeeMoney = can(session, propertyId, 'folio:read');

  const { property, open, decided, departures, requests, tickets, collections, owing } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const property = await findProperty(tx, propertyId);
      const outlet = maySeeOrders ? await getInRoomDiningOutletConfig(tx, propertyId) : null;
      return {
        property,
        // Who is going today, and who has gone (D-094) — the rest of this
        // screen. It used to be only the late-checkout queue, which on most
        // mornings is empty while six rooms are due out.
        departures: await listDeparturesToday(tx, { propertyId, timeZone: property?.timezone ?? 'Asia/Kolkata' }),
        // D-097: the drawer, and who left owing — for whoever may see money.
        collections: maySeeMoney ? await collectionsToday(tx, { propertyId, timeZone: property?.timezone ?? 'Asia/Kolkata' }) : null,
        owing: maySeeMoney ? await listUnpaidDepartures(tx, { propertyId }) : [],
        // What is still on its way to a room that is leaving: a tray in the
        // lift is a reason to wait before checking them out.
        requests: maySeeRequests ? await getOpenRequests(tx, { propertyId }) : [],
        tickets: outlet ? await kitchenTickets(tx, { outletId: outlet.id }) : [],
        open: await listCheckoutRequests(tx, { propertyId, statuses: ['REQUESTED'] }),
        // Today's answers, so the desk can see what it just did — and so a guest
        // ringing down about a decline can be answered without a database query.
        decided: await listCheckoutRequests(tx, {
          propertyId, statuses: ['APPROVED', 'DECLINED'],
        }),
      };
    },
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';

  const view = (rows: typeof open): DeskRequestView[] => rows.map((row) => {
    const fee = row.overriddenFeeMinor ?? row.feeMinor;
    return {
      id: row.id,
      roomNumber: row.roomNumber,
      guestName: row.guestName,
      status: row.status,
      wants: formatCheckoutDay(row.requestedCheckoutAt, timeZone),
      dueOut: formatCheckoutDay(row.scheduledCheckoutAt, timeZone),
      agreed: row.feeMinor === 0
        ? 'No charge'
        : formatMoney(money(row.feeMinor, row.currency as CurrencyCode)),
      // Only when it differs — "₹2,500 → ₹2,500" is noise on a busy desk.
      charged: row.overriddenFeeMinor !== null && row.overriddenFeeMinor !== row.feeMinor
        ? formatMoney(money(fee, row.currency as CurrencyCode))
        : null,
      isFree: row.feeMinor === 0,
      declineReason: row.declineReason,
    };
  });

  const now = new Date();
  const clock = (at: Date) => formatClock(toClock(localTimeAt(at, timeZone).minutes));
  const amount = (minor: number | null, currency: CurrencyCode) =>
    minor === null ? null : formatMoney(money(minor, currency));

  const openIn = new Map<string, { orders: number; requests: number }>();
  for (const ticket of tickets) {
    if (!ticket.roomNumber) continue;
    const found = openIn.get(ticket.roomNumber) ?? { orders: 0, requests: 0 };
    found.orders += 1;
    openIn.set(ticket.roomNumber, found);
  }
  for (const request of requests) {
    const found = openIn.get(request.roomNumber) ?? { orders: 0, requests: 0 };
    found.requests += 1;
    openIn.set(request.roomNumber, found);
  }
  const describeOpen = (room: string) => {
    const found = openIn.get(room);
    if (!found) return null;
    return [
      found.orders ? `${found.orders} order${found.orders > 1 ? 's' : ''}` : null,
      found.requests ? `${found.requests} request${found.requests > 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(', ') || null;
  };

  const due: DueView[] = departures.due.map((row) => ({
    stayId: row.stayId,
    guestId: row.guestId,
    guestName: row.guestName,
    roomNumber: row.roomNumber,
    floorName: row.floorName,
    time: clock(row.scheduledCheckoutAt),
    overdue: row.scheduledCheckoutAt.getTime() < now.getTime(),
    balance: amount(row.balanceMinor, row.currency),
    owes: (row.balanceMinor ?? 0) > 0,
    open: describeOpen(row.roomNumber),
  }));
  const left: LeftView[] = departures.left.map((row) => ({
    stayId: row.stayId,
    guestId: row.guestId,
    guestName: row.guestName,
    roomNumber: row.roomNumber,
    leftAt: row.checkedOutAt ? clock(row.checkedOutAt) : '—',
    balance: amount(row.balanceMinor, row.currency),
    owes: (row.balanceMinor ?? 0) > 0,
  }));

  const METHOD: Record<string, string> = { CARD: 'Card', UPI: 'UPI', CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', OTHER: 'Other' };
  const collectionsView: { rows: CollectionView[]; total: string; refunded: string | null } | null = collections
    ? {
      rows: collections.rows.map((c) => ({
        method: METHOD[c.method] ?? c.method,
        taken: formatMoney(money(c.takenMinor, collections.currency)),
        payments: c.payments,
      })),
      total: formatMoney(money(collections.rows.reduce((sum, c) => sum + c.takenMinor - c.refundedMinor, 0), collections.currency)),
      refunded: collections.rows.some((c) => c.refundedMinor)
        ? formatMoney(money(collections.rows.reduce((sum, c) => sum + c.refundedMinor, 0), collections.currency))
        : null,
    }
    : null;
  const owingView: OwingView[] = owing.map((o) => ({
    stayId: o.stayId,
    guestName: o.guestName,
    guestPhone: o.guestPhone,
    roomNumber: o.roomNumber,
    left: formatFolioDate(o.checkedOutAt, timeZone),
    daysAgo: Math.max(0, Math.floor((Date.now() - o.checkedOutAt.getTime()) / 86_400_000)),
    amount: formatMoney(money(o.balanceMinor, o.currency)),
    reason: o.reason,
  }));

  const overdue = due.filter((row) => row.overdue).length;
  // What is still owed by everybody leaving today — the number a desk is
  // asked for at the end of a morning, and the one a missed payment hides in.
  const owedMinor = [...departures.due, ...departures.left]
    .reduce((sum, row) => sum + Math.max(0, row.balanceMinor ?? 0), 0);
  const owedCurrency = (departures.due[0] ?? departures.left[0])?.currency ?? 'INR';

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Leaving</h1>
          <p className={styles.lede}>
            {due.length === 0 && open.length === 0
              ? 'Nobody else is due out today, and nothing is waiting.'
              : [
                due.length ? `${due.length} due out today` : null,
                open.length ? `${open.length} waiting on an answer` : null,
              ].filter(Boolean).join(' · ') + '.'}
          </p>
        </div>
      </header>

      <ul className={l.stats} aria-label="Today">
        <li className={l.stat}>
          <span className={l.statLabel}>Due out</span>
          <span className={`${l.statValue} tabular`}>{due.length}</span>
          <span className={l.statSub}>still in the room</span>
        </li>
        <li className={l.stat} data-tone={overdue ? 'critical' : undefined}>
          <span className={l.statLabel}>Overdue</span>
          <span className={`${l.statValue} tabular`}>{overdue}</span>
          <span className={l.statSub}>past their time</span>
        </li>
        <li className={l.stat}>
          <span className={l.statLabel}>Left today</span>
          <span className={`${l.statValue} tabular`}>{left.length}</span>
          <span className={l.statSub}>checked out</span>
        </li>
        <li className={l.stat} data-tone={owedMinor > 0 ? 'attention' : undefined}>
          <span className={l.statLabel}>Still owed</span>
          <span className={`${l.statValue} tabular`}>{formatMoney(money(owedMinor, owedCurrency))}</span>
          <span className={l.statSub}>by today&rsquo;s departures</span>
        </li>
      </ul>

      {/* The queue's box only when somebody IS waiting. */}
      {open.length ? (
      <CheckoutQueue
        part="waiting"
        propertyId={propertyId}
        open={view(open)}
        decided={view(decided)}
        mayDecide={can(session, propertyId, 'checkout_request:approve')}
        mayOverride={can(session, propertyId, 'checkout_request:override_fee')}
      />
      ) : (
        // One quiet line rather than an empty box: the desk still sees the
        // queue is empty (and that approving one just emptied it), without
        // an empty panel pushing today's departures down.
        <p className={l.queueEmpty}>Nobody is waiting on an answer.</p>
      )}

      <DueOut
        rows={due}
        mayCheckOut={can(session, propertyId, 'stay:check_out')}
        maySeeGuest={can(session, propertyId, 'guest:read')}
      />

      <LeftToday rows={left} maySeeGuest={can(session, propertyId, 'guest:read')} />

      {collectionsView ? <Collections {...collectionsView} /> : null}

      <LeftOwing rows={owingView} />

      <CheckoutQueue
        part="answered"
        propertyId={propertyId}
        open={view(open)}
        decided={view(decided)}
        mayDecide={can(session, propertyId, 'checkout_request:approve')}
        mayOverride={can(session, propertyId, 'checkout_request:override_fee')}
      />

      <p className={styles.footnote}>
        Approving moves the guest&rsquo;s checkout, puts the fee on their folio and
        keeps their phone working until the new time — all at once, so none of the
        three can be true without the others. Declining charges nothing: the fee
        is only ever posted on a yes.
      </p>
    </>
  );
}
