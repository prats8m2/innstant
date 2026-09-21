import Image from 'next/image';
import lockupLight from '@/app/images/innstant-lockup-light.png';
import lockupDark from '@/app/images/innstant-lockup-dark.png';
import markDark from '@/app/images/innstant-mark-dark.png';
import styles from './innstant-logo.module.css';

/**
 * The logo, from the supplied artwork.
 *
 * ─── It used to be drawn, and that was a stopgap ───────────────────────────
 *
 * Every earlier version of this file was an SVG traced by eye: two arcs, two
 * circles, and the wordmark set in Figtree with a gold chevron over the A. It
 * was never right, and it could not have been — the real mark sets "InnSTÂNT"
 * in mixed case with a four-point sparkle after the T, and no amount of tuning
 * arc radii was going to arrive there. The whole construction is gone.
 *
 * ─── Two files, because the artwork is two files ───────────────────────────
 *
 * The artwork ships as a light lockup (navy ink) and a dark one (white ink),
 * and each is only legible on the ground it was drawn for. `tone` picks; there
 * is no automatic choice, because a component cannot know what is behind it and
 * guessing wrong makes the logo vanish.
 *
 * ─── Why they are not the originals ────────────────────────────────────────
 *
 * The supplied PNGs are 3482×1184 and 3.6/5MB, with OPAQUE backgrounds — white
 * behind one, a navy gradient behind the other. Used directly, each draws a
 * rectangle: white on the site's warm #F3F4F1, a lighter navy box on the
 * #101E33 panels. `scripts/prepare-logo.ts` keys the background to alpha, trims
 * to the artwork and resizes; the originals stay in `src/app/images/` as the
 * source of truth. Run `pnpm logo:build` after replacing them.
 *
 * Static imports rather than `public/` URLs so that Next has the intrinsic
 * dimensions at build time — no layout shift while the header paints, and no
 * width/height to keep in step by hand.
 */

export type LogoTone = 'light' | 'dark';

/** Set from the real files, so a height always yields the right width. */
const LOCKUP_RATIO = lockupLight.width / lockupLight.height;
const MARK_RATIO = markDark.width / markDark.height;

/**
 * The full lockup: monogram and word.
 *
 * `size` is the HEIGHT in px, which is what a header actually cares about — the
 * width follows from the artwork's own aspect. The previous component took a
 * size that meant the mark's width, which made every call site a guess.
 */
export function InnstantLogo({
  size = 30,
  tone = 'light',
  className,
  priority = false,
}: {
  size?: number;
  tone?: LogoTone;
  className?: string;
  /** Set on the one above the fold, so it is not lazy-loaded. */
  priority?: boolean;
}) {
  return (
    <Image
      src={tone === 'dark' ? lockupDark : lockupLight}
      alt="Innstant"
      height={size}
      width={Math.round(size * LOCKUP_RATIO)}
      className={`${styles.lockup} ${className ?? ''}`}
      priority={priority}
    />
  );
}

/**
 * The monogram alone — the S and its two dots, no word.
 *
 * Only the dark cut exists, because the only thing that uses it is the oversized
 * watermark behind the site's closing panel, which is navy. `size` is the
 * height here too.
 */
export function InnstantMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src={markDark}
      alt=""
      aria-hidden="true"
      height={size}
      width={Math.round(size * MARK_RATIO)}
      className={className}
    />
  );
}
