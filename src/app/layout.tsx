import type { Metadata, Viewport } from 'next';
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
