import type { Viewport } from 'next';
import styles from './site.module.css';

/**
 * The marketing site's own theme scope.
 *
 * Same shape as `(guest)/layout.tsx` and for the same reason: the theme is an
 * attribute on a wrapper, and every colour under it recomputes from that
 * subtree's primitives. See the note at the top of `theme.css` — an alias whose
 * value contains `var()` resolves on the element it is DECLARED on, which is
 * why `[data-theme='innstant']` is in the shared derived block rather than
 * carrying its own copies.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The site's ground, so a phone's chrome matches the page rather than
  // flashing the console's paper-white first.
  themeColor: '#F3F4F1',
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="innstant" className={styles.root}>
      {/*
        The safety net under the scroll reveals.

        Every revealed element renders at `opacity: 0` and is cleared by an
        IntersectionObserver (see `motion.tsx`). If that script never runs, the
        page is blank — which is the worst failure a marketing site can have,
        and not a hypothetical one: extensions block scripts and hydration
        fails. This forces all of them visible when there is no JavaScript to
        clear them.
      */}
      <noscript>
        <style>
          {`[data-reveal='out'] { opacity: 1 !important; transform: none !important; }`}
        </style>
      </noscript>
      {children}
    </div>
  );
}
