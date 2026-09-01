'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLiveRefresh } from '@/components/live-refresh';
import { markAlertsSeen } from '@/components/notification-actions';
import styles from './notification-bell.module.css';

/**
 * The in-app channel, on screen (D-028's asterisk, closed).
 *
 * `notifications` rows have always been written before anything was sent; until
 * now nothing sent them, so a duty manager who was not staring at the floor
 * board was not actually interrupted by a breach. This is the delivery.
 *
 * ─── Why the strings arrive as props ───────────────────────────────────────
 *
 * A row is a template name and a payload, never a sentence. `renderNotification()`
 * turns the two into one on the SERVER, and this component is handed the result.
 * That is not only tidiness: a client component that imported a `modules/*`
 * index would drag `pg` into the browser bundle and break the build in a way
 * nothing but `pnpm build` catches.
 *
 * ─── Why `<details>` and not a state-driven popover ────────────────────────
 *
 * Escape closes it, the summary is a real button in the tab order, and the
 * open/closed state survives `router.refresh()` — which matters, because this
 * thing refreshes itself whenever an alert lands, and a panel that snapped shut
 * as the alert arrived would be exactly the wrong behaviour.
 */
export interface BellItem {
  id: string;
  title: string;
  body: string;
  href: string | null;
  /** ISO. A Date crossing into a client component arrives as a string anyway. */
  at: string;
  seen: boolean;
}

export function NotificationBell({
  propertyId,
  items,
  unseen,
}: {
  propertyId: string;
  items: BellItem[];
  unseen: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useLiveRefresh({
    streamUrl: `/api/notifications/stream?propertyId=${encodeURIComponent(propertyId)}`,
    eventName: 'notification',
  });

  const dismiss = () => {
    setError(null);
    start(async () => {
      const result = await markAlertsSeen(propertyId);
      if (result.error) {
        setError(result.error);
        return;
      }
      // Not `revalidatePath` in the action: the bell is on several routes and
      // this refreshes whichever one it is actually on.
      router.refresh();
    });
  };

  return (
    <details className={styles.bell}>
      <summary className={styles.trigger} aria-label={label(unseen)}>
        <BellGlyph />
        {unseen > 0 ? (
          <span className={`${styles.badge} tabular`} aria-hidden="true">{unseen}</span>
        ) : null}
      </summary>

      <div className={styles.panel} role="group" aria-label="Alerts">
        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>Alerts</span>
          {unseen > 0 ? (
            <button
              type="button"
              className={styles.markSeen}
              onClick={dismiss}
              disabled={pending}
            >
              {pending ? 'Marking…' : 'Mark all seen'}
            </button>
          ) : null}
        </div>

        {error ? <p className={styles.error} role="alert">{error}</p> : null}

        {items.length === 0 ? (
          <p className={styles.empty}>Nothing waiting for you.</p>
        ) : (
          <ul className={styles.list}>
            {items.map((item) => (
              <li key={item.id} className={styles.item} data-seen={item.seen}>
                <Row item={item} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function Row({ item }: { item: BellItem }) {
  const body = (
    <>
      <span className={styles.itemTitle}>{item.title}</span>
      <span className={styles.itemBody}>{item.body}</span>
      <Ago at={item.at} />
    </>
  );

  return item.href
    ? <Link href={item.href} className={styles.itemLink}>{body}</Link>
    : <span className={styles.itemLink}>{body}</span>;
}

/**
 * How long ago, on a coarse timer.
 *
 * Relative rather than a clock time on purpose: the alternative is rendering in
 * the property's timezone (CLAUDE.md), and a bell is read in the same minute it
 * lights up — "4 minutes ago" is what is being asked, and it needs no timezone
 * to be right.
 */
function Ago({ at }: { at: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(tick);
  }, []);

  const minutes = Math.max(0, Math.round((now - new Date(at).getTime()) / 60_000));

  return (
    <span className={styles.itemWhen}>
      {minutes < 1
        ? 'just now'
        : minutes < 60
          ? `${minutes} min ago`
          : `${Math.round(minutes / 60)} h ago`}
    </span>
  );
}

function label(unseen: number): string {
  if (unseen === 0) return 'Alerts, none unseen';
  return unseen === 1 ? 'Alerts, 1 unseen' : `Alerts, ${unseen} unseen`;
}

/** Inline so there is no asset to host and no icon dependency for one glyph. */
function BellGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M12 3a5 5 0 0 0-5 5v3.6l-1.4 2.8A1 1 0 0 0 6.5 16h11a1 1 0 0 0 .9-1.6L17 11.6V8a5 5 0 0 0-5-5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 19a2 2 0 0 0 4 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
