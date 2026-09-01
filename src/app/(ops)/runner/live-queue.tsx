'use client';

import { useLiveRefresh } from '@/components/live-refresh';
import styles from './runner.module.css';

/**
 * The live half of the runner queue.
 *
 * Subscribes to the kitchen's own stream: same permission (`order:read`), same
 * outlet filter, and a runner needs to hear exactly the events a cook does — a
 * tray is plated, or someone else took one. A separate route would be the same
 * authorize-and-filter pair written twice (D-026).
 */
export function LiveQueue({ propertyId }: { propertyId: string }) {
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
