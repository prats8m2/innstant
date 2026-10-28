'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import styles from './admin.module.css';

/**
 * The rail's interactive half: the menu button, and the drawer it opens.
 *
 * ─── Why a drawer below 1024px, and not the strip it replaced ──────────────
 *
 * Below 960px the rail used to lie down into a strip that scrolled sideways.
 * On a 390px phone that showed four of twelve destinations, with nothing to
 * say there were eight more, and it was not sticky, so it scrolled away with
 * the page. On a phone the console was effectively four screens.
 *
 * Now the rail's head becomes a sticky top bar (menu, property, bell) and the
 * groups open as a drawer under it, the same list the desktop rail shows,
 * group titles and all. One navigation at every width, folded away when there
 * is no room for it.
 *
 * 1024px rather than 960px: an iPad in portrait (768–834px) had the strip, and
 * at 1024px the desk already gives up its side panel (desk.module.css), so a
 * 216px rail beside it was taking width the table needed.
 *
 * ─── Why the server renders the contents ───────────────────────────────────
 *
 * The groups are filtered by permission and the bell reads the database, so
 * both stay server components and arrive here as nodes. This component only
 * owns `open`. The bell is rendered exactly once, in the head, because it
 * holds a live stream and a second copy would hold a second one.
 *
 * Presentation only, like the rail itself: nothing here decides what anybody
 * may open.
 */

/** Must match the `max-width: 1023px` query in admin.module.css. */
const RAIL_QUERY = '(min-width: 1024px)';

export function ConsoleRail({
  head,
  bell,
  children,
}: {
  /** The property name and the "Ops console" line. */
  head: React.ReactNode;
  bell: React.ReactNode;
  /** The nav groups and the rail's foot. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

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

    bodyRef.current?.querySelector<HTMLElement>('a[href]')?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      toggleRef.current?.focus();
    };
    // Widening the window past the breakpoint shows the rail anyway; leaving
    // `open` set would keep the page locked with no visible way to unlock it.
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
    <aside className={styles.rail}>
      <div className={styles.railHead}>
        <button
          ref={toggleRef}
          type="button"
          className={styles.railToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? 'Close the menu' : 'Open the menu'}
          onClick={() => setOpen((value) => !value)}
        >
          {open
            ? <X size={22} strokeWidth={1.75} aria-hidden="true" />
            : <Menu size={22} strokeWidth={1.75} aria-hidden="true" />}
        </button>
        <div className={styles.railBrand}>{head}</div>
        {bell}
      </div>

      <div
        ref={bodyRef}
        id={bodyId}
        className={styles.railBody}
        data-open={open}
      >
        {children}
      </div>

      {/* A tap outside closes it. Not focusable: Escape and the button are
          the keyboard's way out, and a second close control in the tab order
          is noise. */}
      <div
        className={styles.railScrim}
        data-open={open}
        aria-hidden="true"
        onClick={() => setOpen(false)}
      />
    </aside>
  );
}
