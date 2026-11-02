import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../../guard';
import { can, findProperty } from '@/modules/identity';
import { getStayAtDesk, listCheckoutRequests } from '@/modules/stay';
import { getFolioForStay, buildDeskBill, type OrderBreakdown } from '@/modules/billing';
import { ordersOnBill, kitchenTickets } from '@/modules/ordering';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { getOpenRequests } from '@/modules/requests';
import { formatMoney, money } from '@/lib/money';
import { formatClock, formatFolioDate, localTimeAt, nightsUntil, toClock } from '@/lib/clock';
import { CheckoutDesk, type CheckoutView } from './checkout-desk';
import styles from '../../admin.module.css';

/**
 * Checking one guest out (D-095): the whole bill, and everything between it
 * and an empty room.
 *
 * A senior manager's checkout is one screen, not four. What the guest owes,
 * itemised the way they read a bill (room, food and drink with its service
 * charge and GST, amenities, late checkout, other charges, taxes, discounts),
 * what they have paid and how, and one balance. Before the button: anything
 * still on its way to the room, and a late checkout nobody has answered.
 * Beside it: add a charge (room nights, minibar), take the money in as many
 * payments and methods as it arrives in, take something off with a reason,
 * give money back — and a printable invoice.
 *
 * Every string is formatted here, on the server (#5).
 */
export const dynamic = 'force-dynamic';

export default async function CheckoutStay({ params }: { params: Promise<{ stayId: string }> }) {
  const access = await adminAccess('stay:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;
  const { stayId } = await params;

  const mayFolio = can(session, propertyId, 'folio:read');
  const data = await withTenant({ tenantId: session.tenantId, propertyId }, async (tx) => {
    const stay = /^[0-9a-f-]{36}$/i.test(stayId) ? await getStayAtDesk(tx, { propertyId, stayId }) : null;
    if (!stay) return null;
    const property = await findProperty(tx, propertyId);
    const folio = mayFolio ? await getFolioForStay(tx, stay.id) : null;
    const orderIds = (folio?.lines ?? []).filter((l) => l.source === 'ORDER' && l.sourceRefId).map((l) => l.sourceRefId!);
    const outlet = can(session, propertyId, 'order:read') ? await getInRoomDiningOutletConfig(tx, propertyId) : null;
    return {
      stay,
      property,
      folio,
      orders: await ordersOnBill(tx, { propertyId, orderIds }),
      tickets: outlet && stay.status === 'CHECKED_IN' ? await kitchenTickets(tx, { outletId: outlet.id }) : [],
      requests: can(session, propertyId, 'request:read') && stay.status === 'CHECKED_IN'
        ? await getOpenRequests(tx, { propertyId }) : [],
      lateAsks: await listCheckoutRequests(tx, { propertyId, statuses: ['REQUESTED'] }),
    };
  });

  if (!data) {
    return (
      <>
        <h1 className={styles.title}>Checkout</h1>
        <p className={styles.sectionEmpty}>That stay is not at this property. <Link href="/admin/checkouts">Back to Leaving</Link></p>
      </>
    );
  }

  const { stay, folio } = data;
  const timeZone = data.property?.timezone ?? 'Asia/Kolkata';
  const currency = (folio?.currency ?? 'INR') as 'INR';
  const fmt = (minor: number) => formatMoney(money(minor, currency));
  // "5 Nov, 11am" — a bill needs the date, not only the weekday.
  const when = (at: Date) => `${formatFolioDate(at, timeZone)}, ${formatClock(toClock(localTimeAt(at, timeZone).minutes))}`;
  const bill = buildDeskBill({ lines: folio?.lines ?? [] }, data.orders as ReadonlyMap<string, OrderBreakdown>);

  const leaving = stay.status === 'CHECKED_IN';
  const arrived = stay.checkedInAt ?? stay.scheduledCheckoutAt;
  // Nights actually stayed, in the property's days — what a desk multiplies a
  // room rate by. Up to NOW for somebody checking out (an early departure
  // pays for the nights they had, not the ones they booked), and up to when
  // they left for somebody already gone. Never fewer than one.
  const nights = Math.max(1, nightsUntil(arrived, leaving ? new Date() : stay.checkedOutAt ?? stay.scheduledCheckoutAt, timeZone));

  const openOrders = data.tickets.filter((t) => t.roomNumber === stay.roomNumber);
  const openRequests = data.requests.filter((r) => r.roomNumber === stay.roomNumber);
  const lateAsk = data.lateAsks.find((r) => r.roomNumber === stay.roomNumber) ?? null;

  const view: CheckoutView = {
    propertyId,
    stayId: stay.id,
    status: leaving ? 'in' : 'out',
    guest: {
      id: stay.guestId,
      name: stay.guestName,
      phone: stay.guestPhone,
      email: stay.guestEmail,
      isVip: stay.isVip,
      notes: stay.staffNotes,
    },
    room: { number: stay.roomNumber, floor: stay.floorName, type: stay.roomTypeName },
    arrived: stay.checkedInAt ? when(stay.checkedInAt) : '—',
    due: when(stay.scheduledCheckoutAt),
    left: stay.checkedOutAt ? when(stay.checkedOutAt) : null,
    nights,
    guests: `${stay.adults} adult${stay.adults === 1 ? '' : 's'}${stay.children ? `, ${stay.children} child${stay.children === 1 ? '' : 'ren'}` : ''}`,
    hasBill: folio !== null,
    settled: folio?.status === 'SETTLED',
    sections: bill.sections.map((section) => ({
      key: section.key,
      title: section.title,
      total: fmt(section.totalMinor),
      lines: section.lines.map((line) => ({
        id: line.id,
        date: formatFolioDate(line.createdAt, timeZone),
        description: line.description,
        detail: line.detail,
        amount: fmt(line.amountMinor),
        isCredit: line.amountMinor < 0,
        correctable: line.correctable,
      })),
    })),
    payments: bill.payments.map((p) => ({
      id: p.id,
      date: formatFolioDate(p.createdAt, timeZone),
      description: p.description,
      amount: fmt(Math.abs(p.amountMinor)),
      isRefund: p.isRefund,
    })),
    totals: {
      charges: fmt(bill.chargesMinor),
      tax: bill.taxMinor ? fmt(bill.taxMinor) : null,
      serviceCharge: bill.serviceChargeMinor ? fmt(bill.serviceChargeMinor) : null,
      paid: fmt(bill.paidMinor),
      balance: fmt(Math.abs(bill.balanceMinor)),
      balanceMinor: bill.balanceMinor,
      // The payment form starts at what is owed, in rupees: taking all of it
      // is the common case.
      balanceInput: bill.balanceMinor > 0 ? (bill.balanceMinor / 100).toFixed(bill.balanceMinor % 100 ? 2 : 0) : '',
      owedBackInput: bill.balanceMinor < 0 ? (-bill.balanceMinor / 100).toFixed(-bill.balanceMinor % 100 ? 2 : 0) : '',
    },
    warnings: [
      ...openOrders.map((t) => `Order ${t.orderNumber} is still ${t.status.toLowerCase().replace(/_/g, ' ')} — it will be added when it is delivered.`),
      ...openRequests.map((r) => `${r.lines.map((l) => l.label).join(', ') || r.requestNumber} is still open.`),
      ...(lateAsk ? [`They asked for a late checkout (${when(lateAsk.requestedCheckoutAt)}) and nobody has answered.`] : []),
    ],
    permissions: {
      charge: can(session, propertyId, 'folio:post_charge'),
      settle: can(session, propertyId, 'folio:settle'),
      adjust: can(session, propertyId, 'folio:adjust'),
      refund: can(session, propertyId, 'payment:refund'),
      checkOut: can(session, propertyId, 'stay:check_out'),
      seeGuest: can(session, propertyId, 'guest:read'),
      seeBill: mayFolio,
    },
    // Minted per render, so a double tap on a slow desk takes the money once (#8).
    paymentKey: randomUUID(),
    refundKey: randomUUID(),
  };

  return <CheckoutDesk view={view} />;
}
