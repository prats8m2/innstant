import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { BedDouble } from 'lucide-react';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { findProperty, getPropertyProfile, dialable } from '@/modules/identity';
import { localTimeAt } from '@/lib/clock';
import { getCart, contextForSession } from '@/modules/ordering';
import { formatMoney, type CurrencyCode } from '@/lib/money';
import {
  CartShell, CartEmpty, CartLines, CartTotals, CartNotices, PaymentNote, shortfallMinor,
} from './cart-view';
import { LineControls } from './line-controls';
import { SendOrder } from './send-order';
import { updateLineQuantity } from './actions';
import styles from './cart.module.css';

/**
 * The order, before it is an order.
 *
 * ─── A page, as Direction A draws it ──────────────────────────────────────
 *
 * GuestCart.dc.html makes the cart a page of its own — the bar with the way
 * back, the lines, the totals and how it is paid — and keeps the bottom sheet
 * for the one thing that interrupts it: the verification prompt at the first
 * charge to the room (D-012, CLAUDE.md #9). It is a real route, so the back
 * button leaves it, and it renders and edits with JavaScript off. The parts
 * it shares with the property link's cart are in `cart-view.tsx`.
 */
export const dynamic = 'force-dynamic';

export default async function CartScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  const loaded = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      const outlet = await getInRoomDiningOutletConfig(tx, session.propertyId);
      if (!outlet) return null;
      // The property's clock, for the dish schedules — a breakfast dish sitting
      // in a cart at dinner is not orderable, and this screen must say so
      // rather than let the send fail.
      const property = await findProperty(tx, session.propertyId);
      const at = localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata');

      return {
        minimumOrderMinor: outlet.minimumOrderMinor,
        taxRateBps: outlet.taxRateBps,
        // The desk's number, for "Not your phone? Call the desk" in the
        // prompt. Only when the hotel has given one — never invented.
        deskPhone: await getPropertyProfile(tx, session.propertyId)
          .then((p) => (p?.guestInfo.contactPhone ? dialable(p.guestInfo.contactPhone).tel : null)),
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

  // One key per render of this screen. Every tap of the button that is on the
  // page right now sends this same value, which is what makes a double-tap
  // idempotent rather than a second dinner (#8).
  const idempotencyKey = crypto.randomUUID();

  return (
    <CartShell
      menuHref={menuHref}
      where={<>To room <span className="tabular">{session.roomNumber}</span></>}
    >
      {!cart || cart.lines.length === 0 ? (
        <CartEmpty menuHref={menuHref} />
      ) : (
        <>
          <CartLines
            cart={cart}
            controls={(line) => (
              <LineControls
                action={updateLineQuantity}
                scope={{ name: 'qrCode', value: qrCode }}
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
            <PaymentNote
              icon={<BedDouble size={20} strokeWidth={1.5} />}
              title={<>Charge to room <span className="tabular">{session.roomNumber}</span></>}
              detail="It goes on your folio. Nothing is charged to a card."
            />
          </div>

          <SendOrder
            qrCode={qrCode}
            idempotencyKey={idempotencyKey}
            total={formatMoney(cart.totals.total)}
            roomNumber={session.roomNumber}
            deskPhone={loaded!.deskPhone}
            belowMinimum={shortfallMinor(cart, loaded!.minimumOrderMinor) > 0}
          />
        </>
      )}
    </CartShell>
  );
}
