'use client';

import { useLiveRefresh } from '@/components/live-refresh';
import styles from './order.module.css';

/**
 * The live half of the tracking screen.
 *
 * The stream is only opened while the order is still moving. Once the tray is
 * at the door there is nothing left to hear, and a phone on a nightstand should
 * not hold a connection all night to be told so — so this renders nothing at
 * all rather than a dead indicator.
 */
export function LiveOrder({ orderId, live }: { orderId: string; live: boolean }) {
  return live ? <Feed orderId={orderId} /> : null;
}

/**
 * A separate component because the hook cannot be called conditionally, and the
 * condition is the point: `live` decides whether a stream exists.
 */
function Feed({ orderId }: { orderId: string }) {
  const { connected } = useLiveRefresh({
    streamUrl: `/api/guest/order-stream?orderId=${encodeURIComponent(orderId)}`,
  });

  return (
    <p className={styles.live} data-connected={connected}>
      <span className={styles.liveDot} aria-hidden="true" />
      {connected ? 'Updating as it moves' : 'Reconnecting'}
    </p>
  );
}
