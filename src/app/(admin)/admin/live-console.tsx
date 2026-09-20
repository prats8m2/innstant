'use client';

import { useLiveRefresh } from '@/components/live-refresh';
import styles from './admin.module.css';

/**
 * The console's live half.
 *
 * ─── Why the desk was the last screen without this ─────────────────────────
 *
 * The kitchen display, the runner queue and the floor board have all streamed
 * since P1. The console never did, so the one screen a front desk leaves open
 * all shift was the one screen that lied: a guest orders dinner, the kitchen
 * accepts it, a housekeeper picks up a towel request, and the desk shows none
 * of it until somebody presses reload. A desk that has to reload to be right is
 * a desk that stops trusting the numbers.
 *
 * ─── Two streams, one refresh ──────────────────────────────────────────────
 *
 * Orders and requests are announced on different Postgres channels by different
 * modules, and both already have a staff route that authorises on the right
 * permission and filters to this property. Each hook calls `router.refresh()`,
 * so whichever fires first re-reads the whole server-rendered page — the screen
 * does not need to know which kind of thing moved.
 *
 * Both are opt-in per permission. A front desk without `order:read` subscribes
 * to requests only, and the indicator tells the truth about what it is hearing
 * rather than claiming a feed it does not have.
 */
export function LiveConsole({
  propertyId,
  orders,
  requests,
}: {
  propertyId: string;
  /** `order:read`. */
  orders: boolean;
  /** `request:read`. */
  requests: boolean;
}) {
  return (
    <span className={styles.live} data-connected={orders || requests ? undefined : 'off'}>
      {orders || requests
        ? <Feed propertyId={propertyId} orders={orders} requests={requests} />
        : null}
    </span>
  );
}

/**
 * The hooks cannot be called conditionally, so the decision about WHETHER to
 * stream is made one level up and this component only ever runs when at least
 * one of them is wanted. The `enabled` flag inside each is what turns the other
 * one off without changing the number of hooks.
 */
function Feed({
  propertyId,
  orders,
  requests,
}: {
  propertyId: string;
  orders: boolean;
  requests: boolean;
}) {
  const query = `?propertyId=${encodeURIComponent(propertyId)}`;

  const orderFeed = useLiveRefresh({
    streamUrl: orders ? `/api/kds/stream${query}` : null,
    eventName: 'order',
  });
  const requestFeed = useLiveRefresh({
    streamUrl: requests ? `/api/requests/stream${query}` : null,
    eventName: 'request',
  });

  // Connected means every feed this account is entitled to. Saying "live" while
  // half the screen is deaf is the kind of reassurance that gets found out.
  const connected = (!orders || orderFeed.connected) && (!requests || requestFeed.connected);

  return (
    <>
      <span className={styles.liveDot} aria-hidden="true" data-connected={connected} />
      {connected ? 'Live' : 'Reconnecting'}
    </>
  );
}
