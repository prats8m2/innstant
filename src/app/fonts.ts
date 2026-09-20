import localFont from 'next/font/local';

/**
 * Self-hosted, per design/README.md. No Google Fonts CDN call: hotel wifi is
 * the target network, and a render-blocking request to fonts.gstatic.com is
 * exactly the thing that makes a menu feel slow at 9:40pm. Both design exports
 * link the CDN; those are design documents, not a deployment.
 *
 * All seven are SIL OFL 1.1 — see src/app/fonts/LICENSE.md.
 *
 * ─── Two families, because there are two design systems ────────────────────
 *
 * The product runs two themes on purpose (D-050). The STAFF console is Public
 * Sans and Red Hat Mono on paper; the GUEST app is Marcellus, Mukta and DM Mono
 * on indigo. They are not variants of one another — a guest is being hosted and
 * a cook is being informed, and the type is most of the difference.
 *
 * All of them are declared on `<html>` so either theme can reach either
 * family; `theme.css` decides which is `--font-display`, `--font-body` and
 * `--font-mono` in each scope. Nothing downloads a face the page does not use:
 * `next/font` emits a preload only for the families actually rendered.
 */

/* ── The staff console. Two variable faces, one file each. ───────────────── */

export const publicSans = localFont({
  src: [{ path: './fonts/public-sans-var.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-public-sans',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

export const redHatMono = localFont({
  src: [{ path: './fonts/red-hat-mono-var.woff2', weight: '300 700', style: 'normal' }],
  variable: '--font-red-hat-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});

/* ── The guest app. Static weights, as the export ships them. ─────────────── */

export const marcellus = localFont({
  src: [{ path: './fonts/marcellus-400.woff2', weight: '400', style: 'normal' }],
  variable: '--font-marcellus',
  display: 'swap',
  fallback: ['Georgia', 'serif'],
});

export const mukta = localFont({
  src: [
    { path: './fonts/mukta-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/mukta-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/mukta-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/mukta-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-mukta',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

export const dmMono = localFont({
  src: [
    { path: './fonts/dm-mono-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/dm-mono-500.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-dm-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});

/* ── The marketing site. A third system, and deliberately not either of the
      other two. ───────────────────────────────────────────────────────────── */

/**
 * The site is selling the product to somebody who has never seen it, on a
 * laptop, in daylight. That is a different job from hosting a guest at 9:40pm,
 * and a different job again from telling a cook what to put on a pass — so it
 * gets its own pair rather than borrowing one of theirs.
 *
 * Self-hosted like the other five, for the same reason given above: the CDN
 * link in the design export is a design document, not a deployment. The `latin`
 * subset only — the site is in English, and the latin-ext file is five kilobytes
 * of accents nothing on it renders.
 */
export const instrumentSerif = localFont({
  src: [{ path: './fonts/instrument-serif-400.woff2', weight: '400', style: 'normal' }],
  variable: '--font-instrument-serif',
  display: 'swap',
  fallback: ['Georgia', 'serif'],
});

export const figtree = localFont({
  src: [{ path: './fonts/figtree-var.woff2', weight: '300 900', style: 'normal' }],
  variable: '--font-figtree',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});
