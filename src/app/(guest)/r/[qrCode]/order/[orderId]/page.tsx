import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getOrderForStay, trackView, trackEta } from '@/modules/ordering';
import { findProperty } from '@/modules/identity';
import { formatMoney, money } from '@/lib/money';
import { LiveOrder } from './live-order';
import styles from './order.module.css';

/**
 * Tracking an order — the reference's `track` screen.
 *
 * Everything on it comes from the order's own SNAPSHOT columns (#6), never from
 * a join back to the menu, so it reads correctly tomorrow after the chef has
 * renamed the dish. What changes live is the timeline, and that arrives as a
 * nudge over SSE which this server component then re-reads (see LiveOrder).
 *
 * It is a server-rendered page with a client component bolted on rather than a
 * client-rendered screen, which means it is also the confirmation: with
 * JavaScript off, a guest still gets a correct timeline, a promise time and
 * their order — just not the movement.
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
  const view = trackView(order.status, order, order.haltReason);
  const eta = trackEta(order.status, order.promisedByAt, order);

  // The PROPERTY's timezone, never the server's (CLAUDE.md "Dates"). A guest in
  // Udaipur must not read a promise time computed in another region.
  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const clock = new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  });
  /**
   * `9:41pm`, not `9:41 PM`. The reference's own formatter closes the gap and
   * lowercases the meridiem, and it matters more than it looks: the promise is
   * set in Marcellus at 38px, and the space is wide enough there to push a
   * range onto a second line on a 390px screen.
   */
  const at = (value: Date | null) =>
    (value ? clock.format(value).replace(/\s?([ap])\.?m\.?/i, (_, p: string) => `${p.toLowerCase()}m`) : '');

  const lineCount = order.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          ←
        </Link>
        <h1 className={styles.barTitle}>Order to room {session.roomNumber}</h1>
        <span className={`${styles.barRef} tabular`}>{order.orderNumber}</span>
      </header>

      {eta ? (
        <section className={styles.hero}>
          <span className={styles.sweep} aria-hidden="true" />
          <p className={styles.heroLabel}>{eta.label}</p>
          <p className={`${styles.heroTime} tabular`}>
            {eta.to ? `${at(eta.from)} – ${at(eta.to)}` : at(eta.from)}
          </p>
          <p className={styles.heroNote}>
            {view.live
              ? 'The kitchen narrows this as it goes. Leave the screen open or come back to it.'
              : 'Left with you in room ' + session.roomNumber + '.'}
          </p>
        </section>
      ) : null}

      {view.halt ? (
        <section className={styles.halt} role="status">
          <h2 className={styles.haltTitle}>{view.halt.title}</h2>
          {view.halt.reason ? (
            <p className={styles.haltReason}>“{view.halt.reason}”</p>
          ) : null}
          <p className={styles.haltDetail}>{view.halt.detail}</p>
        </section>
      ) : null}

      {view.steps ? (
        <>
          {/* The one thing a screen reader needs from an animated timeline: what
              state the order is in now. The steps themselves are a list. */}
          <p className="sr-only" role="status">
            {view.steps.find((step) => step.state === 'active')?.title ?? 'Order sent'}
          </p>

          <ol className={styles.steps}>
            {view.steps.map((step) => (
              <li key={step.key} className={styles.step} data-state={step.state}>
                <span className={styles.rail} aria-hidden="true">
                  <span className={styles.dotWrap}>
                    <span className={styles.halo} />
                    <span className={styles.dot} />
                  </span>
                  <span className={styles.line} />
                </span>
                <span className={styles.stepBody}>
                  <span className={styles.stepHead}>
                    <span className={styles.stepTitle}>{step.title}</span>
                    <span className={`${styles.stepTime} tabular`}>{at(step.at)}</span>
                  </span>
                  <span className={styles.stepSub}>{step.sub}</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}

      <LiveOrder orderId={order.id} live={view.live} />

      {/*
        A <details>, not a toggle in state. The reference draws this as a
        collapsible summary; a native element makes it work with JavaScript off
        and gives a screen reader the disclosure semantics for free.
      */}
      <details className={styles.summary}>
        <summary className={styles.summaryHead}>
          <span className={styles.summaryTitle}>Your order</span>
          <span className={`${styles.summaryMeta} tabular`}>
            {lineCount} {lineCount === 1 ? 'item' : 'items'} ·{' '}
            {formatMoney(money(order.totalMinor, order.currency))}
          </span>
        </summary>

        <div className={styles.summaryBody}>
          <ul className={styles.lines}>
            {order.lines.map((line) => (
              <li key={line.id} className={styles.summaryLine}>
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
              <dd className="tabular">
                {formatMoney(money(order.subtotalMinor, order.currency))}
              </dd>
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
              <dt>Charged to room {session.roomNumber}</dt>
              <dd className="tabular">{formatMoney(money(order.totalMinor, order.currency))}</dd>
            </div>
          </dl>

          <p className={styles.folioNote}>
            Nothing was charged to a card. It is on your folio, settled at checkout.
          </p>
        </div>
      </details>

      <nav className={styles.actions}>
        <Link href={`${base}/menu`} className={styles.secondary}>Order something else</Link>
        <Link href={`${base}/home`} className={styles.secondary}>Back to the room</Link>
      </nav>
    </main>
  );
}
