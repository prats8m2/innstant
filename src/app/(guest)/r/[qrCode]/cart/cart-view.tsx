import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { Cart } from '@/modules/ordering';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import styles from './cart.module.css';

/**
 * The order, before it is an order — the pieces both carts draw.
 *
 * Direction A makes the cart a page (GuestCart.dc.html): a bar with the way
 * back and "Your order", the lines as "1 × Laal maas" with the price on the
 * right and the choices beneath, the totals, and how it will be paid. The
 * room's cart and the property link's (D-079) differ only in what follows
 * the totals — a room charge with its one verification prompt, or a name and
 * a number — so the parts above that are drawn here, once.
 *
 * No hooks: everything here renders on the server.
 */
export function CartShell({
  menuHref,
  where,
  children,
}: {
  menuHref: string;
  /** "To room 214", "To Table 4", "For collection". */
  where: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className={styles.shell}>
      <header className={styles.head}>
        <Link href={menuHref} className={styles.back} aria-label="Back to the menu">
          <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <h1 className={styles.title}>Your order</h1>
        <p className={styles.where}>{where}</p>
      </header>
      {children}
    </main>
  );
}

/** The Components board's empty state: an arch, a sentence, a way back. */
export function CartEmpty({ menuHref }: { menuHref: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyArch} aria-hidden="true" />
      <p className={styles.emptyTitle}>Nothing in the order yet.</p>
      <Link href={menuHref} className={styles.emptyLink}>Back to the menu</Link>
    </div>
  );
}

export function CartLines({
  cart,
  controls,
}: {
  cart: Cart;
  /** The stepper for a line, bound to its flow's action. */
  controls: (line: Cart['lines'][number]) => React.ReactNode;
}) {
  return (
    <ul className={styles.lines}>
      {cart.lines.map((line) => {
        // "Nothing" under an optional group is a real choice and it is
        // stored — it just says nothing worth reading.
        const mods = line.modifiers.filter((m) => !m.isNoOp).map((m) => m.name);
        return (
          <li key={line.id} className={styles.line} data-unavailable={!line.isAvailable}>
            <p className={styles.lineName}>
              <span className={`${styles.lineQty} tabular`}>{line.quantity} ×</span>{' '}
              {line.name}
            </p>
            <span className={`${styles.lineTotal} tabular`}>
              {line.isAvailable
                ? formatMoney(money(line.lineTotalMinor, cart.currency))
                : 'Not charged'}
            </span>

            {mods.length ? <p className={styles.lineMods}>{mods.join(' · ')}</p> : null}
            {line.notes ? <p className={styles.lineNote}>Note: “{line.notes}”</p> : null}
            {!line.isAvailable ? (
              <p className={styles.lineGone}>
                The kitchen has taken this off tonight. It is not charged.
              </p>
            ) : null}

            <div className={styles.lineControls}>{controls(line)}</div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The sums, in a <dl>. Each figure is the domain's (`getCart()` prices the
 * cart); this screen formats and never adds.
 */
export function CartTotals({
  cart,
  taxRateBps,
}: {
  cart: Cart;
  /** The outlet's rate, so the tax line says what it is ("Tax 5%"). */
  taxRateBps: number | null;
}) {
  const { totals } = cart;
  const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

  return (
    <dl className={styles.totals}>
      <div className={styles.row}>
        <dt>Subtotal</dt>
        <dd className="tabular">{formatMoney(totals.subtotal)}</dd>
      </div>
      {totals.serviceCharge.amountMinor > 0 ? (
        <div className={styles.row}>
          <dt>
            Service{' '}
            <span className="tabular">
              {(totals.serviceCharge.amountMinor / totals.subtotal.amountMinor * 100).toFixed(0)}%
            </span>
          </dt>
          <dd className="tabular">{formatMoney(totals.serviceCharge)}</dd>
        </div>
      ) : null}
      {totals.tax.amountMinor > 0 ? (
        <div className={styles.row}>
          <dt>
            Tax{taxRateBps ? <> <span className="tabular">{pct(taxRateBps)}</span></> : null}
          </dt>
          <dd className="tabular">{formatMoney(totals.tax)}</dd>
        </div>
      ) : null}
      {totals.deliveryFee.amountMinor > 0 ? (
        <div className={styles.row}>
          <dt>Delivery</dt>
          <dd className="tabular">{formatMoney(totals.deliveryFee)}</dd>
        </div>
      ) : null}
      <div className={`${styles.row} ${styles.grand}`}>
        <dt>Total</dt>
        <dd className="tabular">{formatMoney(totals.total)}</dd>
      </div>
    </dl>
  );
}

/**
 * What a guest needs to know before pressing send that is not a sum: a dish
 * that came off the menu, or an order under the outlet's minimum.
 *
 * `placeOrder()` has always refused below the minimum — it is the money path
 * and that is where the rule belongs. Saying so BEFORE the tap is what stops
 * a guest learning a rule at the worst moment.
 */
export function CartNotices({
  cart,
  minimumOrderMinor,
  currency,
}: {
  cart: Cart;
  minimumOrderMinor: number;
  currency: CurrencyCode;
}) {
  const unavailable = cart.lines.filter((l) => !l.isAvailable).length;
  const shortfall = shortfallMinor(cart, minimumOrderMinor);
  return (
    <>
      {unavailable ? (
        <p className={styles.notice} role="status">
          {unavailable === 1
            ? 'One dish came off the menu while you were choosing. It is not in the total.'
            : `${unavailable} dishes came off the menu while you were choosing. They are not in the total.`}
        </p>
      ) : null}
      {shortfall > 0 ? (
        <p className={styles.notice} role="status">
          Orders start at{' '}
          <span className="tabular">{formatMoney(money(minimumOrderMinor, currency))}</span>
          {' '}— <span className="tabular">{formatMoney(money(shortfall, currency))}</span> to go.
        </p>
      ) : null}
    </>
  );
}

export function shortfallMinor(cart: Cart | null, minimumOrderMinor: number): number {
  return Math.max(0, minimumOrderMinor - (cart?.totals.subtotal.amountMinor ?? 0));
}

/**
 * How it will be paid. On the board this is a choice of two; today there is
 * one way per flow — the room's folio, or the counter — so it is drawn as the
 * selected option, with what it means beneath, rather than as a choice
 * between one thing.
 */
export function PaymentNote({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  detail: string;
}) {
  return (
    <div className={styles.payment}>
      <span className={styles.paymentIcon} aria-hidden="true">{icon}</span>
      <span className={styles.paymentText}>
        <span className={styles.paymentTitle}>{title}</span>
        <span className={styles.paymentDetail}>{detail}</span>
      </span>
    </div>
  );
}
