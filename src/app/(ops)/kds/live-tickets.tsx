'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './kds.module.css';

/**
 * The live half of the kitchen display.
 *
 * It renders one status dot and otherwise does nothing but call
 * `router.refresh()` when the server says an order moved. The board itself is
 * server-rendered, so what arrives over the wire is a nudge rather than state
 * the client has to merge — and a tablet that missed an hour of events still
 * shows a correct board after one refresh.
 *
 * `EventSource` reconnects on its own, which is most of why this is SSE and not
 * a websocket. The `retry:` the server sends sets how long it waits.
 */
export function LiveTickets({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  // A ref, not state: changing it must not re-render and tear down the stream.
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const source = new EventSource(`/api/kds/stream?propertyId=${encodeURIComponent(propertyId)}`);

    source.addEventListener('ready', () => {
      setConnected(true);
      // The server sends `ready` only once it is actually LISTENing, so this
      // load closes the gap between opening the stream and hearing about
      // anything that happened while it was opening.
      router.refresh();
    });

    source.addEventListener('order', () => {
      /**
       * Coalesced. A five-dish order bumped through four states in a burst
       * would otherwise be four full re-renders of a board a cook is reading.
       * 250ms is under the threshold where a kitchen would notice a delay and
       * well above the burst.
       */
      if (pending.current !== null) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        router.refresh();
      }, 250);
    });

    source.onerror = () => {
      // EventSource retries by itself; this only reflects the truth on screen.
      setConnected(false);
    };

    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
      source.close();
    };
  }, [propertyId, router]);

  return (
    <span className={styles.live} data-connected={connected}>
      <span className={styles.liveDot} aria-hidden="true" />
      {connected ? 'Live' : 'Reconnecting'}
    </span>
  );
}
