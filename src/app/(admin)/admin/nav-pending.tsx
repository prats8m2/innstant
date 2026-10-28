'use client';

import { useLinkStatus } from 'next/link';
import { Loader2 } from 'lucide-react';
import styles from './admin.module.css';

/**
 * A menu item's "I heard you" while its page loads.
 *
 * The console's pages are rendered on the server, and until the next one
 * arrives the screen does not change. On a fast click that is instant. On a
 * slow one (a cold server, a slow database round trip, or the dev server
 * compiling a page for the first time) a click looked like it had done
 * nothing, so people clicked again, and again. Rendered INSIDE the Link, so
 * `useLinkStatus` reports that link's own navigation.
 *
 * It waits a moment before showing (CSS), so a quick navigation does not
 * flash a spinner at anyone.
 */
export function NavPending() {
  const { pending } = useLinkStatus();
  return (
    <Loader2
      className={styles.navPending}
      data-pending={pending || undefined}
      size={14}
      strokeWidth={2}
      aria-hidden="true"
    />
  );
}
