'use client';

import { useLiveRefresh } from '@/components/live-refresh';
import styles from '../service.module.css';

/**
 * "Someone is on the way" without a reload.
 *
 * Only opened while the request is live: once it is done or called off there is
 * nothing left to hear, and a phone on a nightstand should not hold a connection
 * all night to be told so.
 */
export function LiveRequest({ requestId, live }: { requestId: string; live: boolean }) {
  return live ? <Feed requestId={requestId} /> : null;
}

/** Separate, because the hook cannot be called conditionally and the condition
 *  is the point. */
function Feed({ requestId }: { requestId: string }) {
  const { connected } = useLiveRefresh({
    streamUrl: `/api/guest/request-stream?requestId=${encodeURIComponent(requestId)}`,
    eventName: 'request',
  });

  return (
    <p className={styles.liveLine} data-connected={connected}>
      <span className={styles.liveDot} aria-hidden="true" />
      {connected ? 'Updating as it moves' : 'Reconnecting'}
    </p>
  );
}
