'use client';

import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import styles from './site.module.css';

/**
 * The site's motion, such as it is.
 *
 * ─── Why an observer and not a scroll timeline ─────────────────────────────
 *
 * CSS `animation-timeline: view()` would do all of this with no JavaScript at
 * all, and it is the right answer in a year or two. Today it ships in Chromium
 * and not in Firefox, which would mean a page that animates for some visitors
 * and sits still for others — on a site whose whole job is to look considered.
 * An IntersectionObserver behaves the same everywhere.
 *
 * ─── The failure mode this is built around ─────────────────────────────────
 *
 * A reveal animation starts its element at `opacity: 0`. If the script that
 * clears it never runs, the page is blank — the worst possible outcome for a
 * marketing site, and a real one: extensions block scripts, and hydration
 * fails. So the hidden state is expressed as `data-reveal="out"`, and
 * `(site)/layout.tsx` carries a `<noscript>` rule that forces every one of
 * them visible. No script, no hiding.
 *
 * Reduced motion needs nothing here. `theme.css` answers that preference once
 * for the whole product by collapsing every duration to 1ms, so a reveal still
 * happens — it just happens instantly, which is the correct behaviour rather
 * than a degraded one.
 */

/** Start a little before the element's top edge clears the fold. */
const ROOT_MARGIN = '0px 0px -12% 0px';

export function Reveal({
  as: Tag = 'div',
  children,
  className,
  /** Milliseconds, for staggering a row of cards. */
  delay = 0,
  ...rest
}: {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  delay?: number;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No observer (a very old browser, a test runner): show it and stop.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShown(true);
          // Once only. A section that fades out again as you scroll back up
          // reads as a glitch, not as polish.
          observer.disconnect();
        }
      },
      { rootMargin: ROOT_MARGIN, threshold: 0.05 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={className}
      data-reveal={shown ? 'in' : 'out'}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * The header, which gains a border and a shadow once the page has moved.
 *
 * At the top of a page it should be invisible furniture sitting on the hero;
 * over content it needs an edge or the text scrolls into it. A class toggle is
 * the whole mechanism.
 */
export function SiteHeader({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    // Passive: this must never be able to delay a scroll.
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={styles.nav} data-scrolled={scrolled}>
      {children}
    </header>
  );
}
