import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getOrderForStay } from '@/modules/ordering';
import { findProperty } from '@/modules/identity';
import { formatMoney, money } from '@/lib/money';
import styles from './order.module.css';

/**
 * The order is with the kitchen.
 *
 * Everything on this screen comes from the order's own SNAPSHOT columns (#6),
 * never from a join back to the menu — so it still reads correctly tomorrow,
 * after the chef has renamed the dish and changed its price. That is the
 * difference between a receipt and a report.
 *
 * Live status arrives with SSE (P1, still to come). Until then this is the
 * confirmation: the number to quote, what was sent, and where the charge went.
 */
export const dynamic = 'force-dynamic';

export default async function OrderScreen({
  params,
}: {
  params: Promise<{ qrCode: string; orderId: string }>;
}) {
  const { qrCode, orderId } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const { order, property } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => ({
      order: await getOrderForStay(tx, { stayId: session.stayId, orderId }),
      property: await findProperty(tx, session.propertyId),
    }),
  );

  // An order id from the room next door is a 404, not someone else's dinner.
  if (!order) notFound();

  const base = `/r/${encodeURIComponent(qrCode)}`;
  // The PROPERTY's timezone, never the server's (CLAUDE.md "Dates"). A guest
  // in Udaipur must not read a promise time computed in another region.
  const promised = order.promisedByAt
    ? new Intl.DateTimeFormat('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: property?.timezone ?? 'Asia/Kolkata',
      }).format(order.promisedByAt)
    : null;

  return (
    <main className={styles.shell}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Order {order.orderNumber}</p>
        <h1 className={styles.title}>It is with the kitchen</h1>
        {promised ? (
          <p className={styles.promise}>
            Expected in room {session.roomNumber} by <span className="tabular">{promised}</span>.
          </p>
        ) : null}
      </header>

      <ul className={styles.lines}>
        {order.lines.map((line) => (
          <li key={line.id} className={styles.line}>
            <span className={`${styles.quantity} tabular`}>{line.quantity}×</span>
            <span className={styles.lineBody}>
              <span className={styles.lineName}>{line.name}</span>
              {line.modifiers.length ? (
                <span className={styles.lineMods}>
                  {line.modifiers.map((m) => m.name).join(' · ')}
                </span>
              ) : null}
              {line.notes ? <span className={styles.lineNote}>“{line.notes}”</span> : null}
            </span>
            <span className={`${styles.lineTotal} tabular`}>
              {formatMoney(money(line.lineTotalMinor, order.currency))}
            </span>
          </li>
        ))}
      </ul>

      <dl className={styles.totals}>
        <div className={styles.row}>
          <dt>Subtotal</dt>
          <dd className="tabular">{formatMoney(money(order.subtotalMinor, order.currency))}</dd>
        </div>
        {order.serviceChargeMinor > 0 ? (
          <div className={styles.row}>
            <dt>Service</dt>
            <dd className="tabular">
              {formatMoney(money(order.serviceChargeMinor, order.currency))}
            </dd>
          </div>
        ) : null}
        {order.taxMinor > 0 ? (
          <div className={styles.row}>
            <dt>Tax</dt>
            <dd className="tabular">{formatMoney(money(order.taxMinor, order.currency))}</dd>
          </div>
        ) : null}
        <div className={`${styles.row} ${styles.grand}`}>
          <dt>On your folio</dt>
          <dd className="tabular">{formatMoney(money(order.totalMinor, order.currency))}</dd>
        </div>
      </dl>

      <p className={styles.folioNote}>
        Nothing was charged to a card. It is on room {session.roomNumber}, settled at checkout.
      </p>

      <nav className={styles.actions}>
        <Link href={`${base}/menu`} className={styles.secondary}>Order something else</Link>
        <Link href={`${base}/home`} className={styles.secondary}>Back to the room</Link>
      </nav>
    </main>
  );
}
