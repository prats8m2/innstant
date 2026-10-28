import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveVisitSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getOutletConfig } from '@/modules/catalog';
import { findProperty } from '@/modules/identity';
import { getCart, contextForSession } from '@/modules/ordering';
import { localTimeAt } from '@/lib/clock';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { LineControls } from './line-controls';
import { CheckoutForm } from './checkout-form';
import styles from '../../../r/[qrCode]/cart/cart.module.css';
import { DishImage } from '../../../dish-image';

/**
 * The order sheet, for a property link. D-079.
 *
 * The same sheet as the room flow's — same stylesheet, same lines, same
 * totals — with one difference that matters and is the whole of this feature:
 * the footer asks who this is and where it goes, because there is no room to
 * put it on and no folio to settle later.
 *
 * `Charged to room 214` becomes a total and a destination. "Nothing is charged
 * to a card. It goes on your folio" becomes "you pay at the counter", which is
 * true and is the thing a customer most needs to know before tapping send.
 */
export const dynamic = 'force-dynamic';

export default async function VisitCartScreen({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const store = await cookies();
  const session = await resolveVisitSession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/p/${encodeURIComponent(code)}`);

  const base = `/p/${encodeURIComponent(code)}`;

  const loaded = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      // The outlet this LINK points at, by id. Not the in-room dining one — a
      // restaurant running on this product may have no in-room outlet at all.
      const outlet = await getOutletConfig(tx, {
        propertyId: session.propertyId,
        outletId: session.outletId,
      });
      if (!outlet) return null;

      // The property's clock, for the dish schedules — a breakfast dish sitting
      // in a cart at dinner is not orderable, and this screen must say so
      // rather than let the send fail.
      const property = await findProperty(tx, session.propertyId);
      const at = localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata');

      return {
        minimumOrderMinor: outlet.minimumOrderMinor,
        currency: outlet.currency as CurrencyCode,
        cart: await getCart(tx, {
          propertyId: session.propertyId,
          context: contextForSession(session),
          at,
          outlet: {
            outletId: outlet.id,
            currency: outlet.currency as CurrencyCode,
            taxRateBps: outlet.taxRateBps,
            serviceChargeBps: outlet.serviceChargeBps,
            deliveryFeeMinor: outlet.deliveryFeeMinor,
          },
        }),
      };
    },
  );

  const cart = loaded?.cart ?? null;
  const lines = cart?.lines ?? [];
  const unavailable = lines.filter((l) => !l.isAvailable);

  // `placeOrder()` refuses below the minimum — it is the money path and that is
  // where the rule belongs. Saying so BEFORE the tap is what stops a customer
  // learning a rule at the worst moment.
  const shortfallMinor = loaded
    ? Math.max(0, loaded.minimumOrderMinor - (cart?.totals.subtotal.amountMinor ?? 0))
    : 0;

  // One key per render. Every tap of the button that is on the page right now
  // carries this same value, which is what makes a double-tap one order (#8).
  const idempotencyKey = crypto.randomUUID();

  /**
   * Whether there is a question to ask about fulfilment at all.
   *
   * A dine-in visit came from a table tent: the table is on the link, and
   * offering "delivery" to somebody sitting in the dining room is an invitation
   * to a mistake. Only a link with no answer of its own asks.
   */
  const canChooseFulfilment = session.fulfilment !== 'DINE_IN';

  const where = session.tableLabel
    ? `To ${session.tableLabel}`
    : session.fulfilment === 'DELIVERY' ? 'For delivery' : 'For collection';

  return (
    <main className={styles.shell}>
      {/* Tapping outside closes the sheet — a link, so it works without JS. */}
      <Link href={`${base}/menu`} className={styles.scrim} aria-label="Back to the menu" />

      <section className={styles.sheet} aria-labelledby="cart-heading">
        <div className={styles.handle} aria-hidden="true" />

        <header className={styles.head}>
          <h1 id="cart-heading" className={styles.title}>Your order</h1>
          <p className={styles.room}>{where}</p>
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
                  <span className={styles.thumb} aria-hidden="true">
                    <DishImage src={line.imageUrl} />
                  </span>
                  <div className={styles.lineBody}>
                    <p className={styles.lineName}>{line.name}</p>
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
                      code={code}
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
                  <dt>Total</dt>
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

              {shortfallMinor > 0 ? (
                <p className={styles.warning} role="status">
                  Orders start at{' '}
                  {formatMoney(money(loaded!.minimumOrderMinor, loaded!.currency))}
                  {' '}— {formatMoney(money(shortfallMinor, loaded!.currency))} to go.
                </p>
              ) : null}

              <CheckoutForm
                code={code}
                idempotencyKey={idempotencyKey}
                total={formatMoney(cart!.totals.total)}
                where={where}
                canChooseFulfilment={canChooseFulfilment}
                fulfilment={session.fulfilment}
                belowMinimum={shortfallMinor > 0}
              />
            </footer>
          </>
        )}
      </section>
    </main>
  );
}
