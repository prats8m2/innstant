import type { Metadata, Viewport } from 'next';
import { marcellus, mukta, dmMono } from './fonts';
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
  // Matches the export's ground colour so the browser chrome does not flash
  // white before first paint on a phone.
  themeColor: '#0A1220',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${marcellus.variable} ${mukta.variable} ${dmMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
