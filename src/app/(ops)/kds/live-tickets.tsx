'use client';

import { useLiveRefresh } from '@/components/live-refresh';
import styles from './kds.module.css';

/**
 * The live half of the kitchen display.
 *
 * The transport is shared (`useLiveRefresh`); what stays here is what a cook
 * sees. `EventSource` reconnecting on its own is most of why this is SSE and
 * not a websocket — a tablet spends its evening on hotel wifi.
 */
export function LiveTickets({ propertyId }: { propertyId: string }) {
  const { connected } = useLiveRefresh({
    streamUrl: `/api/kds/stream?propertyId=${encodeURIComponent(propertyId)}`,
  });

  return (
    <span className={styles.live} data-connected={connected}>
      <span className={styles.liveDot} aria-hidden="true" />
      {connected ? 'Live' : 'Reconnecting'}
    </span>
  );
}
