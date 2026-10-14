import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Loading } from '@/components/ui';
import { useLinkOpener } from '@/lib/open-link';

/**
 * `/p/{code}` — a property link, arriving as a deep link. D-081.
 *
 * ─── Why this file has to exist ────────────────────────────────────────────
 *
 * Expo Router owns the launch URL. A tap on `innstant.in/p/the-kesari-table-4`
 * is routed to `/p/the-kesari-table-4` BEFORE any screen mounts — so the
 * hand-rolled `Linking.getInitialURL()` that used to live in `index.tsx` never
 * ran for a cold launch: `index.tsx` is `/`, and `/` is not where the router
 * went. Without a route file here the router has nowhere to go and renders its
 * white "Unmatched Route" page.
 *
 * That would have been hit by every single person who arrives the way this
 * product intends them to, because the entire distribution is QR codes and
 * sent links.
 */
export default function PropertyLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const open = useLinkOpener();

  useEffect(() => { void open(code); }, [code, open]);

  return <Loading label="Opening the menu" />;
}
