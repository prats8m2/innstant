'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveRefresh } from '@/components/live-refresh';
import styles from './order.module.css';

/**
 * The live half of the tracking screen.
 *
 * The stream is only opened while the order is still moving. Once the tray is
 * at the door there is nothing left to hear, and a phone on a nightstand should
 * not hold a connection all night to be told so — so this renders nothing at
 * all rather than a dead indicator.
 *
 * `lateAt` is the moment the promise stops holding. Nothing on the stream
 * announces it — no status changes when a kitchen runs behind — so without a
 * timer a screen left open would go on showing a window that had already
 * passed. One re-read at that instant flips the page to "running behind".
 */
export function LiveOrder({
  orderId,
  live,
  lateAt = null,
}: {
  orderId: string;
  live: boolean;
  lateAt?: string | null;
}) {
  return live ? <Feed orderId={orderId} lateAt={lateAt} /> : null;
}

/**
 * A separate component because the hook cannot be called conditionally, and the
 * condition is the point: `live` decides whether a stream exists.
 */
function Feed({ orderId, lateAt }: { orderId: string; lateAt: string | null }) {
  const router = useRouter();
  const { connected } = useLiveRefresh({
    streamUrl: `/api/guest/order-stream?orderId=${encodeURIComponent(orderId)}`,
    eventName: 'order',
  });

  useEffect(() => {
    if (!lateAt) return;
    const wait = new Date(lateAt).getTime() - Date.now();
    // A browser timer tops out at ~24.8 days; a promise is minutes away, and
    // anything already past is the server's to have rendered as late.
    if (wait <= 0 || wait > 2 ** 31 - 1) return;
    const timer = window.setTimeout(() => router.refresh(), wait + 1_000);
    return () => window.clearTimeout(timer);
  }, [lateAt, router]);

  return (
    <p className={styles.live} data-connected={connected}>
      <span className={styles.liveDot} aria-hidden="true" />
      {connected ? 'Updating as it moves' : 'Reconnecting'}
    </p>
  );
}
