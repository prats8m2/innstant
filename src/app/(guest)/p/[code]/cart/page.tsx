import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { withTenant } from '@/db';
import { resolveVisitSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getOutletConfig } from '@/modules/catalog';
import { findProperty } from '@/modules/identity';
import { getCart, contextForSession } from '@/modules/ordering';
import { localTimeAt } from '@/lib/clock';
import { formatMoney, type CurrencyCode } from '@/lib/money';
// The room flow's cart, imported rather than copied: the same page, with this
// flow's own actions bound in.
import {
  CartShell, CartEmpty, CartLines, CartTotals, CartNotices, shortfallMinor,
} from '../../../r/[qrCode]/cart/cart-view';
import { LineControls } from '../../../r/[qrCode]/cart/line-controls';
import styles from '../../../r/[qrCode]/cart/cart.module.css';
import { CheckoutForm } from './checkout-form';
import { updateLineQuantity } from './actions';

/**
 * The order, for a property link. D-079.
 *
 * The same page as the room flow's — same view, same lines, same totals — with one difference that matters and is the whole of this feature:
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
        taxRateBps: outlet.taxRateBps,
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
  const menuHref = `${base}/menu`;

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
    <CartShell menuHref={menuHref} where={where}>
      {!cart || cart.lines.length === 0 ? (
        <CartEmpty menuHref={menuHref} />
      ) : (
        <>
          <CartLines
            cart={cart}
            controls={(line) => (
              <LineControls
                action={updateLineQuantity}
                scope={{ name: 'code', value: code }}
                cartItemId={line.id}
                quantity={line.quantity}
                name={line.name}
              />
            )}
          />

          <div className={styles.summary}>
            <CartTotals cart={cart} taxRateBps={loaded!.taxRateBps} />
            <CartNotices
              cart={cart}
              minimumOrderMinor={loaded!.minimumOrderMinor}
              currency={loaded!.currency}
            />
            <CheckoutForm
              code={code}
              idempotencyKey={idempotencyKey}
              total={formatMoney(cart.totals.total)}
              where={where}
              canChooseFulfilment={canChooseFulfilment}
              fulfilment={session.fulfilment}
              belowMinimum={shortfallMinor(cart, loaded!.minimumOrderMinor) > 0}
            />
          </div>
        </>
      )}
    </CartShell>
  );
}
