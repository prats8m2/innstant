import localFont from 'next/font/local';

/**
 * Self-hosted, per design/README.md. No Google Fonts CDN call: hotel wifi is
 * the target network, and a render-blocking request to fonts.gstatic.com is
 * exactly the thing that makes a menu feel slow at 9:40pm.
 *
 * All three are SIL OFL 1.1 — see design/fonts/LICENSE.md. Extracted from the
 * design export by `pnpm design:decode`.
 */
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
