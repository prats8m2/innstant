import type { Metadata, Viewport } from 'next';
import { publicSans, redHatMono, marcellus, mukta, dmMono } from './fonts';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Hotel guest services',
  description: 'Guest services platform',
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
      ].join(' ')}>
      <body>{children}</body>
    </html>
  );
}
