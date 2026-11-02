import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { withTenant } from '@/db';
import { resolveVisitSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getOrderForContext, trackView, trackEta, contextForSession } from '@/modules/ordering';
import { getPropertyProfile, dialable } from '@/modules/identity';
// The room flow's tracking screen, imported rather than copied: an order moves
// through the same states whichever link placed it.
import { OrderTracking } from '../../../../r/[qrCode]/order/[orderId]/tracking';

/**
 * Tracking a property-link order. D-079.
 *
 * The visit-side twin of `/r/[qrCode]/order/[orderId]`, rendering the same
 * `OrderTracking` screen (Direction A's `GuestTracking` board) and its
 * `LiveOrder` client — the SSE nudge is scoped by order id.
 *
 * Three things differ, and all three are the absence of a room: the back button
 * goes to the menu rather than to an activity list that does not exist here,
 * the heading names the table or the delivery, and the folio sentence is
 * replaced by where the money actually changes hands. The timeline itself is
 * worded for the destination (D-080) — "Coming to your table", "Ready for you".
 *
 * No `loading.tsx` beside this file, on purpose — D-099.
 */
export const dynamic = 'force-dynamic';

export default async function VisitOrderScreen({
  params,
}: {
  params: Promise<{ code: string; orderId: string }>;
}) {
  const { code, orderId } = await params;
  const store = await cookies();
  const session = await resolveVisitSession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/p/${encodeURIComponent(code)}`);

  const { order, profile } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => ({
      order: await getOrderForContext(tx, { context: contextForSession(session), orderId }),
      profile: await getPropertyProfile(tx, session.propertyId),
    }),
  );

  // An order id from the next table is a 404, not someone else's dinner —
  // `getOrderForContext` scopes to this visit, and the id travels in a URL.
  if (!order) notFound();

  const base = `/p/${encodeURIComponent(code)}`;
  const phone = profile?.guestInfo.contactPhone ? dialable(profile.guestInfo.contactPhone).tel : null;

  /**
   * Where this is going, read from the SESSION rather than from the order's
   * `destination_label`: the label is the kitchen's copy ("Delivery · 12 MG
   * Road"). This is the customer's own screen, and what they need back is
   * confirmation that it went to the right place.
   */
  const destination = session.tableLabel
    ? `Order to ${session.tableLabel}`
    : session.fulfilment === 'DELIVERY' ? 'Order for delivery' : 'Order for collection';

  return (
    <OrderTracking
      order={order}
      // D-080 — the timeline in the words this destination deserves.
      view={trackView(order.status, order, order.haltReason, session.fulfilment)}
      eta={trackEta(order.status, order.promisedByAt, order)}
      fulfilment={session.fulfilment}
      timeZone={profile?.timezone ?? 'Asia/Kolkata'}
      now={new Date()}
      title={destination}
      // To the MENU. A property link has no activity list and no room home
      // behind it — the menu is the only place back.
      back={{ href: `${base}/menu`, label: 'Back to the menu' }}
      totalLabel="Total"
      // D-079: a visit has no folio, so the order's own total is the record
      // of what is owed.
      payNote={session.fulfilment === 'DELIVERY' ? 'Pay the rider when it arrives.' : 'Pay at the counter.'}
      phone={phone}
      next={{ href: `${base}/menu`, label: 'Order something else' }}
    />
  );
}
