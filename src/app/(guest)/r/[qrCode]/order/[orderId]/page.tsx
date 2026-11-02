import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getOrderForContext, trackView, trackEta, contextForSession } from '@/modules/ordering';
import { getPropertyProfile, dialable } from '@/modules/identity';
import { OrderTracking } from './tracking';

/**
 * Tracking an order — Direction A's `GuestTracking` board.
 *
 * Everything on it comes from the order's own SNAPSHOT columns (#6), never from
 * a join back to the menu, so it reads correctly tomorrow after the chef has
 * renamed the dish. What changes live is the timeline, and that arrives as a
 * nudge over SSE which this server component then re-reads (see LiveOrder).
 *
 * No `loading.tsx` beside this file, on purpose — D-099. A live screen with
 * one stopped committing its refreshes.
 *
 * The screen itself is `OrderTracking`, shared with the property-link flow;
 * this page decides only what is true of a ROOM: where back goes, the room
 * number, and that the money is on the folio.
 */
export const dynamic = 'force-dynamic';

export default async function OrderScreen({
  params,
}: {
  params: Promise<{ qrCode: string; orderId: string }>;
}) {
  const { qrCode, orderId } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const { order, profile } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => ({
      order: await getOrderForContext(tx, { context: contextForSession(session), orderId }),
      profile: await getPropertyProfile(tx, session.propertyId),
    }),
  );

  // An order id from the room next door is a 404, not someone else's dinner.
  if (!order) notFound();

  const base = `/r/${encodeURIComponent(qrCode)}`;
  const phone = profile?.guestInfo.contactPhone ? dialable(profile.guestInfo.contactPhone).tel : null;

  return (
    <OrderTracking
      order={order}
      view={trackView(order.status, order, order.haltReason)}
      eta={trackEta(order.status, order.promisedByAt, order)}
      fulfilment="IN_ROOM"
      // The PROPERTY's timezone, never the server's (CLAUDE.md "Dates").
      timeZone={profile?.timezone ?? 'Asia/Kolkata'}
      now={new Date()}
      title={`Order to room ${session.roomNumber}`}
      // To the LIST, not the room home. Back from one order is "my orders";
      // the room home is one tap on from there.
      back={{ href: `${base}/activity`, label: 'Back to your requests' }}
      totalLabel={`Charged to room ${session.roomNumber}`}
      payNote="Nothing was charged to a card. It is on your folio, settled at checkout."
      phone={phone}
      next={{ href: `${base}/menu`, label: 'Order something else' }}
    />
  );
}
