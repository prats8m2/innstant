import type { Metadata, Viewport } from 'next';
import {
  publicSans, redHatMono, marcellus, mukta, dmMono, instrumentSerif, figtree,
} from './fonts';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Innstant — guest services for hotels',
  description:
    'One QR code on the nightstand. Room service, amenities, checkout and the ' +
    'neighbourhood — with a console, a kitchen screen and a runner app behind it.',
};

// Guest routes are mobile-only and must not be zoom-locked — an accessibility
// requirement, see CLAUDE.md "UI".
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /**
   * The STAFF theme's ground. The guest routes export their own `viewport`
   * (see `(guest)/layout.tsx`) because their theme is the other one and a
   * guest's phone must not flash paper-white before an indigo page paints —
   * that flash is the first thing they see at 9:40pm.
   */
  themeColor: '#F3F4F2',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={[
        publicSans.variable, redHatMono.variable,
        marcellus.variable, mukta.variable, dmMono.variable,
        instrumentSerif.variable, figtree.variable,
      ].join(' ')}>
      {/* Browser extensions write attributes onto <body> before React hydrates
          (ColorZilla adds `cz-shortcut-listen`, password managers add their
          own), and React reports the mismatch as a hydration error on every
          page. This ignores attribute differences on <body> ITSELF only; a
          real mismatch anywhere inside the app is still reported. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
