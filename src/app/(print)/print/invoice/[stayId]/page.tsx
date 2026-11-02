import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '@/app/(admin)/admin/guard';
import { getPropertyProfile } from '@/modules/identity';
import { getStayAtDesk } from '@/modules/stay';
import { getFolioForStay, buildDeskBill, type OrderBreakdown } from '@/modules/billing';
import { ordersOnBill } from '@/modules/ordering';
import { formatMoney, money } from '@/lib/money';
import { formatClock, formatFolioDate, localTimeAt, nightsUntil, toClock } from '@/lib/clock';
import { PrintButton } from './print-button';
import p from './invoice.module.css';

/**
 * The guest's invoice, for printing or saving as a PDF (D-095).
 *
 * Outside the console's layout on purpose — a printed bill with the console's
 * rail down its left edge is not a bill — but behind the same session and
 * `folio:read`, because it is somebody's bill. Built from the same
 * `buildDeskBill()` as the checkout screen, so the paper and the screen can
 * never disagree about a total.
 *
 * The invoice number is the folio's, shortened: stable across reprints, and
 * one bill per stay.
 */
export const dynamic = 'force-dynamic';

export default async function Invoice({ params }: { params: Promise<{ stayId: string }> }) {
  const access = await adminAccess('folio:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;
  const { stayId } = await params;

  const data = await withTenant({ tenantId: session.tenantId, propertyId }, async (tx) => {
    const stay = /^[0-9a-f-]{36}$/i.test(stayId) ? await getStayAtDesk(tx, { propertyId, stayId }) : null;
    if (!stay) return null;
    const folio = await getFolioForStay(tx, stay.id);
    const orderIds = (folio?.lines ?? []).filter((l) => l.source === 'ORDER' && l.sourceRefId).map((l) => l.sourceRefId!);
    return {
      stay,
      folio,
      property: await getPropertyProfile(tx, propertyId),
      orders: await ordersOnBill(tx, { propertyId, orderIds }),
    };
  });

  if (!data) return <main className={p.page}><p>That stay is not at this property.</p></main>;

  const { stay, folio, property } = data;
  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const currency = (folio?.currency ?? 'INR') as 'INR';
  const fmt = (minor: number) => formatMoney(money(minor, currency));
  const when = (at: Date) => `${formatFolioDate(at, timeZone)}, ${formatClock(toClock(localTimeAt(at, timeZone).minutes))}`;
  const bill = buildDeskBill({ lines: folio?.lines ?? [] }, data.orders as ReadonlyMap<string, OrderBreakdown>);
  const arrived = stay.checkedInAt ?? stay.scheduledCheckoutAt;
  // Nights stayed so far, or in all once they have gone (see the checkout screen).
  const nights = Math.max(1, nightsUntil(arrived, stay.checkedOutAt ?? new Date(), timeZone));
  const info = property?.guestInfo;
  const number = folio ? `INV-${folio.id.slice(0, 8).toUpperCase()}` : '—';

  return (
    <main className={p.page}>
      <div className={p.toolbar}>
        <PrintButton />
      </div>

      <article className={p.invoice} data-invoice={number}>
        <header className={p.head}>
          <div>
            <h1 className={p.hotel}>{property?.name ?? 'The hotel'}</h1>
            <p className={p.contact}>
              {[info?.addressLine, info?.city].filter(Boolean).join(', ')}
              {info?.contactPhone ? <><br />{info.contactPhone}</> : null}
              {info?.contactEmail ? <><br />{info.contactEmail}</> : null}
            </p>
          </div>
          <div className={p.meta}>
            <p className={p.docTitle}>{folio?.status === 'SETTLED' ? 'Invoice · paid' : 'Invoice'}</p>
            <dl>
              <dt>Number</dt><dd className="tabular">{number}</dd>
              <dt>Issued</dt><dd>{when(new Date())}</dd>
            </dl>
          </div>
        </header>

        <section className={p.parties}>
          <div>
            <h2 className={p.label}>Guest</h2>
            <p>{stay.guestName}{stay.guestPhone ? <><br />{stay.guestPhone}</> : null}{stay.guestEmail ? <><br />{stay.guestEmail}</> : null}</p>
          </div>
          <div>
            <h2 className={p.label}>Stay</h2>
            <p>
              Room {stay.roomNumber}{stay.roomTypeName ? ` · ${stay.roomTypeName}` : ''}<br />
              {stay.checkedInAt ? when(stay.checkedInAt) : '—'} → {when(stay.checkedOutAt ?? stay.scheduledCheckoutAt)}<br />
              {nights} night{nights === 1 ? '' : 's'}
            </p>
          </div>
        </section>

        <table className={p.table}>
          <thead>
            <tr><th>Date</th><th>Description</th><th className={p.num}>Amount</th></tr>
          </thead>
          {bill.sections.map((section) => (
            <tbody key={section.key}>
              <tr className={p.group}><th colSpan={2}>{section.title}</th><th className={`${p.num} tabular`}>{fmt(section.totalMinor)}</th></tr>
              {section.lines.map((line) => (
                <tr key={line.id}>
                  <td className="tabular">{formatFolioDate(line.createdAt, timeZone)}</td>
                  <td>{line.description}{line.detail ? <span className={p.detail}> — {line.detail}</span> : null}</td>
                  <td className={`${p.num} tabular`}>{fmt(line.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>

        <section className={p.summary}>
          <dl>
            <dt>Total charges</dt><dd className="tabular">{fmt(bill.chargesMinor)}</dd>
            {bill.serviceChargeMinor ? (<><dt className={p.inner}>includes service charge</dt><dd className={`${p.inner} tabular`}>{fmt(bill.serviceChargeMinor)}</dd></>) : null}
            {bill.taxMinor ? (<><dt className={p.inner}>includes GST</dt><dd className={`${p.inner} tabular`}>{fmt(bill.taxMinor)}</dd></>) : null}
            {bill.payments.map((payment) => (
              <span key={payment.id} className={p.payRow}>
                <dt>{payment.isRefund ? 'Refunded' : 'Paid'} · {payment.description} · {formatFolioDate(payment.createdAt, timeZone)}</dt>
                <dd className="tabular">{payment.isRefund ? '+' : '−'}{fmt(Math.abs(payment.amountMinor))}</dd>
              </span>
            ))}
            <dt className={p.balance}>{bill.balanceMinor > 0 ? 'Balance due' : bill.balanceMinor < 0 ? 'Owed to the guest' : 'Balance'}</dt>
            <dd className={`${p.balance} tabular`}>{fmt(Math.abs(bill.balanceMinor))}</dd>
          </dl>
        </section>

        <footer className={p.foot}>Thank you for staying with us.</footer>
      </article>
    </main>
  );
}
