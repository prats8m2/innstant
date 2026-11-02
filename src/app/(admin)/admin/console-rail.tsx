'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import styles from './admin.module.css';

/**
 * The frame's interactive half: the sidebar, the top bar's menu button, and
 * the drawer the sidebar becomes on a narrow screen.
 *
 * ─── Why a drawer below 1024px ─────────────────────────────────────────────
 *
 * Below 960px the rail used to lie down into a strip that scrolled sideways.
 * On a 390px phone that showed four of twelve destinations, with nothing to
 * say there were eight more, and it scrolled away with the page. So below
 * 1024px the sidebar folds away behind a menu button at the start of the top
 * bar and opens as a drawer under it: the same list a desk sees, group
 * titles and all.
 *
 * 1024px rather than 960px: an iPad in portrait (768–834px) had the strip,
 * and at 1024px the desk already gives up its side panel (desk.module.css),
 * so a 248px sidebar beside it was taking width the table needed.
 *
 * ─── Why the server renders the contents ───────────────────────────────────
 *
 * The groups are filtered by permission and the bell reads the database, so
 * both stay server components and arrive here as nodes. This component only
 * owns `open`. The bell is rendered exactly once, in the top bar, because it
 * holds a live stream and a second copy would hold a second one.
 *
 * Presentation only: nothing here decides what anybody may open.
 */

/** Must match the `max-width: 1023px` query in admin.module.css. */
const RAIL_QUERY = '(min-width: 1024px)';

export function ConsoleRail({
  rail,
  topBar,
  children,
}: {
  /** The property, the search field, the nav groups and the person. */
  rail: React.ReactNode;
  /** The breadcrumb and the top bar's controls. */
  topBar: React.ReactNode;
  /** The page. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const railId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLElement>(null);

  // Arriving somewhere closes it. Covers a link inside the drawer, the
  // browser's back button, and a ?tab= change, which is the same pathname.
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => setOpen(false), [pathname, search]);

  useEffect(() => {
    if (!open) return;

    // The page behind does not scroll under a finger that meant the drawer.
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';

    // Without preventScroll the drawer scrolls to the link mid-slide and
    // opens with the property card cut off the top.
    railRef.current?.querySelector<HTMLElement>('nav a[href]')?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    // Widening the window past the breakpoint shows the sidebar anyway;
    // leaving `open` set would keep the page locked with no way to unlock it.
    const wide = window.matchMedia(RAIL_QUERY);
    const onWide = () => { if (wide.matches) setOpen(false); };

    document.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      root.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  return (
    <>
      <aside ref={railRef} id={railId} className={styles.rail} data-open={open}>
        {rail}
      </aside>

      {/* A tap outside closes it. Not focusable: Escape and the button are
          the keyboard's way out, and a second close control in the tab order
          is noise. */}
      <div
        className={styles.railScrim}
        data-open={open}
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />

      <div className={styles.canvas}>
        <header className={styles.topBar}>
          <button
            ref={toggleRef}
            type="button"
            className={styles.railToggle}
            aria-expanded={open}
            aria-controls={railId}
            aria-label={open ? 'Close the menu' : 'Open the menu'}
            onClick={() => setOpen((value) => !value)}
          >
            {open
              ? <X size={20} strokeWidth={1.5} aria-hidden="true" />
              : <Menu size={20} strokeWidth={1.5} aria-hidden="true" />}
          </button>
          {topBar}
        </header>
        <main className={styles.main}>{children}</main>
      </div>
    </>
  );
}
