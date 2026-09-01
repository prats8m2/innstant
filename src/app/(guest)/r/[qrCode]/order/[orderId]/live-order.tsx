'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './order.module.css';

/**
 * The live half of the tracking screen.
 *
 * Same shape as the kitchen's `LiveTickets`, and for the same reason: what
 * arrives over the wire is a nudge, and `router.refresh()` re-reads the
 * timeline on the server. The client merges no state, so a phone that spent ten
 * minutes in a lift is correct one refresh after it reconnects rather than
 * correct-looking and wrong.
 *
 * The stream is only opened while the order is still moving. Once the tray is
 * at the door there is nothing left to hear, and a phone on a nightstand should
 * not hold a connection all night to be told so.
 */
export function LiveOrder({ orderId, live }: { orderId: string; live: boolean }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  // A ref, not state: changing it must not re-render and tear the stream down.
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (!live) return;

    const source = new EventSource(
      `/api/guest/order-stream?orderId=${encodeURIComponent(orderId)}`,
    );

    source.addEventListener('ready', () => {
      setConnected(true);
      // Sent only once the database is LISTENing, so this read covers anything
      // that moved while the stream was opening.
      router.refresh();
    });

    source.addEventListener('order', () => {
      // Coalesced: a kitchen bumping accept → preparing in one breath is one
      // re-render, not two. 250ms is well under what reads as a delay.
      if (pending.current !== null) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        router.refresh();
      }, 250);
    });

    source.onerror = () => {
      // EventSource retries on its own; this only tells the truth on screen.
      setConnected(false);
    };

    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
      source.close();
    };
  }, [orderId, live, router]);

  if (!live) return null;

  return (
    <p className={styles.live} data-connected={connected}>
      <span className={styles.liveDot} aria-hidden="true" />
      {connected ? 'Updating as it moves' : 'Reconnecting'}
    </p>
  );
}
