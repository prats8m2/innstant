import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { getCart } from '@/modules/ordering';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { LineControls } from './line-controls';
import styles from './cart.module.css';

/**
 * The order, before it is an order.
 *
 * ─── A route, drawn as the reference's sheet ───────────────────────────────
 *
 * The design opens the cart as a bottom sheet over the menu. This is a real
 * route that looks like that sheet — scrim, rounded top, spring on entry —
 * rather than client state on the menu screen, for three reasons that matter
 * more than the mechanism: the back button closes it, the URL is shareable
 * with the front desk, and it renders and edits with JavaScript off.
 *
 * The drag-to-dismiss handle is drawn because the shape reads wrong without it,
 * and the scrim behind it is a link back to the menu — so the gesture people
 * actually use (tap outside) works, and the one that needs a pointer library
 * does not pretend to.
 */
export const dynamic = 'force-dynamic';

export default async function CartScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  const cart = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      const outlet = await getInRoomDiningOutletConfig(tx, session.propertyId);
      if (!outlet) return null;
      return getCart(tx, {
        propertyId: session.propertyId,
        stayId: session.stayId,
        outlet: {
          outletId: outlet.id,
          currency: outlet.currency as CurrencyCode,
          taxRateBps: outlet.taxRateBps,
          serviceChargeBps: outlet.serviceChargeBps,
          deliveryFeeMinor: outlet.deliveryFeeMinor,
        },
      });
    },
  );

  const lines = cart?.lines ?? [];
  const unavailable = lines.filter((l) => !l.isAvailable);

  return (
    <main className={styles.shell}>
      {/* Tapping outside closes the sheet — a link, so it works without JS. */}
      <Link href={`${base}/menu`} className={styles.scrim} aria-label="Back to the menu" />

      <section className={styles.sheet} aria-labelledby="cart-heading">
        <div className={styles.handle} aria-hidden="true" />

        <header className={styles.head}>
          <h1 id="cart-heading" className={styles.title}>Your order</h1>
          <p className={styles.room}>To room {session.roomNumber}</p>
        </header>

        {lines.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyLine}>Nothing in the order yet.</p>
            <Link href={`${base}/menu`} className={styles.emptyLink}>Back to the menu</Link>
          </div>
        ) : (
          <>
            <ul className={styles.lines}>
              {lines.map((line) => (
                <li key={line.id} className={styles.line} data-unavailable={!line.isAvailable}>
                  <span className={styles.thumb} aria-hidden="true" />
                  <div className={styles.lineBody}>
                    <p className={styles.lineName}>{line.name}</p>
                    {/* "Nothing" under an optional group is a real choice and
                        it is stored — it just says nothing worth reading. */}
                    {line.modifiers.some((m) => !m.isNoOp) ? (
                      <p className={styles.lineMods}>
                        {line.modifiers.filter((m) => !m.isNoOp).map((m) => m.name).join(' · ')}
                      </p>
                    ) : null}
                    {line.notes ? <p className={styles.lineNote}>“{line.notes}”</p> : null}
                    {!line.isAvailable ? (
                      <p className={styles.lineGone}>
                        The kitchen has taken this off tonight. It is not charged.
                      </p>
                    ) : null}

                    <LineControls
                      qrCode={qrCode}
                      cartItemId={line.id}
                      quantity={line.quantity}
                      lineTotal={
                        line.isAvailable
                          ? formatMoney(money(line.lineTotalMinor, cart!.currency))
                          : null
                      }
                      name={line.name}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <footer className={styles.foot}>
              <dl className={styles.totals}>
                <div className={styles.row}>
                  <dt>Subtotal</dt>
                  <dd className="tabular">{formatMoney(cart!.totals.subtotal)}</dd>
                </div>
                {cart!.totals.serviceCharge.amountMinor > 0 ? (
                  <div className={styles.row}>
                    <dt>Service, {(cart!.totals.serviceCharge.amountMinor / cart!.totals.subtotal.amountMinor * 100).toFixed(0)}%</dt>
                    <dd className="tabular">{formatMoney(cart!.totals.serviceCharge)}</dd>
                  </div>
                ) : null}
                {cart!.totals.tax.amountMinor > 0 ? (
                  <div className={styles.row}>
                    <dt>Tax</dt>
                    <dd className="tabular">{formatMoney(cart!.totals.tax)}</dd>
                  </div>
                ) : null}
                {cart!.totals.deliveryFee.amountMinor > 0 ? (
                  <div className={styles.row}>
                    <dt>Delivery</dt>
                    <dd className="tabular">{formatMoney(cart!.totals.deliveryFee)}</dd>
                  </div>
                ) : null}
                <div className={`${styles.row} ${styles.grand}`}>
                  <dt>Charged to room {session.roomNumber}</dt>
                  <dd className="tabular">{formatMoney(cart!.totals.total)}</dd>
                </div>
              </dl>

              {unavailable.length ? (
                <p className={styles.warning} role="status">
                  {unavailable.length === 1
                    ? 'One dish came off the menu while you were choosing. It is not in the total.'
                    : `${unavailable.length} dishes came off the menu while you were choosing. They are not in the total.`}
                </p>
              ) : null}

              {/* The send button lands with order placement — see docs/STATUS.md.
                  A primary action that does nothing is worse than none. */}
              <p className={styles.folioNote}>
                Nothing is charged to a card. It goes on your folio.
              </p>
            </footer>
          </>
        )}
      </section>
    </main>
  );
}
