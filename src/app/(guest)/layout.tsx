import type { Viewport } from 'next';
import styles from './guest.module.css';

/**
 * The guest app's skin.
 *
 * One job: put `data-theme="kesari"` around everything under `/r/…` so the
 * indigo palette, the saffron accent and Marcellus/Mukta/DM Mono apply (D-050,
 * and the block of the same name in theme.css). The staff console keeps the
 * paper-and-teal that `:root` carries.
 *
 * ─── Why a layout and not a class on each page ─────────────────────────────
 *
 * Because it has to cover the parts of the screen no page draws. `body` is
 * painted from `:root`, which is the console's paper; a guest page that only
 * themed its own content would show a white band under a short screen and a
 * white flash on every navigation. The wrapper is the full viewport and paints
 * the ground itself.
 *
 * It also gives the route group its own `viewport`, which is the only way to
 * stop a phone's browser chrome rendering the console's colour around a guest
 * page — the first thing somebody sees when they scan a sticker at 9:40pm.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches --paper-deep inside [data-theme='kesari'] — the deeper indigo the
  // document sits on, not --paper, which is the app's own ground: the browser
  // paints its chrome around the whole page, and that is what shows when a
  // short screen is over-scrolled. Duplicated by necessity, because the browser
  // reads this BEFORE any stylesheet; theme-discipline.test.ts keeps them in
  // step.
  themeColor: '#0A1220',
};

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="kesari" className={styles.ground}>
      {children}
    </div>
  );
}
