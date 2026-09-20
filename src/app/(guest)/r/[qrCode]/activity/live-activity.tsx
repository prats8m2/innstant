'use client';

import { useLiveRefresh } from '@/components/live-refresh';
import styles from './activity.module.css';

/**
 * The live half of the activity list.
 *
 * TWO streams, because the two things on this screen move for different
 * reasons and are announced on different Postgres channels — the kitchen
 * bumping a ticket and a housekeeper picking up a request are not the same
 * event. Each is stay-scoped: `orderId` and `requestId` are optional
 * narrowings on those routes, and `stayId` comes from the session either way.
 *
 * Both hooks call `router.refresh()`, so whichever fires first re-reads the
 * whole list — the screen does not need to know which kind of thing changed.
 *
 * Rendered by the page only while something is actually open. A history screen
 * holding two connections all night to hear about Tuesday is a battery cost
 * with no payoff.
 */
export function LiveActivity({ propertyId }: { propertyId: string }) {
  // propertyId is not a filter — the server reads the stay from the cookie —
  // but it keeps the URLs distinct per property so a browser that has been in
  // two hotels does not reuse a cached connection.
  const orders = useLiveRefresh({
    streamUrl: `/api/guest/order-stream?propertyId=${encodeURIComponent(propertyId)}`,
    eventName: 'order',
  });
  const requests = useLiveRefresh({
    streamUrl: `/api/guest/request-stream?propertyId=${encodeURIComponent(propertyId)}`,
    eventName: 'request',
  });

  // Connected means BOTH: saying "updating" while half the screen is deaf is
  // the kind of reassurance that gets found out.
  const connected = orders.connected && requests.connected;

  return (
    <p className={styles.live} data-connected={connected}>
      <span className={styles.liveDot} aria-hidden="true" />
      {connected ? 'Updating as they move' : 'Reconnecting'}
    </p>
  );
}
