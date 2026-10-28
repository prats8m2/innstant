'use client';

import { useEffect, useId, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import styles from './admin.module.css';

/**
 * A panel that slides over the right of a console page: editing something
 * without leaving the list it belongs to.
 *
 * Opened and closed by the URL (`?dish=…` on the menu studio), never by
 * client state, like every other view in the console (D-061): it survives a
 * reload, can be sent to somebody, and the browser's back button closes it.
 * Escape, the close button and a click outside all go to `closeHref`.
 *
 * A modal dialog while it is open: focus moves into it, the page behind does
 * not scroll under it, and it says what it is to a screen reader.
 */
export function SidePanel({
  title,
  subtitle,
  closeHref,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Where closing goes: the page underneath, without the panel's param. */
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    panelRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') router.push(closeHref, { scroll: false });
    };
    document.addEventListener('keydown', onKey);
    return () => {
      root.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [closeHref, router]);

  return (
    <div className={styles.sidePanelLayer}>
      <Link
        href={closeHref}
        scroll={false}
        className={styles.sidePanelScrim}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={styles.sidePanel}
      >
        <header className={styles.sidePanelHead}>
          <div>
            <h2 id={headingId} className={styles.sidePanelTitle}>{title}</h2>
            {subtitle ? <p className={styles.sidePanelSub}>{subtitle}</p> : null}
          </div>
          <Link href={closeHref} scroll={false} className={styles.sidePanelClose} aria-label="Close">
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </header>
        <div className={styles.sidePanelBody}>{children}</div>
      </div>
    </div>
  );
}
