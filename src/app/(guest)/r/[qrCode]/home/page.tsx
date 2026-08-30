import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { formatMoney, money } from '@/lib/money';

/**
 * The room home — the post-scan landing.
 *
 * Placeholder markup. S2a/S2b produce the design tokens and P1 builds the real
 * screen from them; `design/reference/kesari-guest-app.html` is the picture to
 * match, not markup to copy.
 *
 * What is NOT a placeholder is the access model: this renders for an anonymous
 * REQUEST-tier session with nothing in the way (#9).
 */
export const dynamic = 'force-dynamic';

export default async function RoomHome({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  // Cookie missing or stale (checked out, expired, revoked) — send them back
  // through the link, which will issue a fresh session or 404.
  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  return (
    <main>
      <h1>Room {session.roomNumber}</h1>
      <p data-testid="tier">
        {session.accessTier}
        {session.isAnonymous ? ' · not verified' : ' · verified'}
      </p>
      <p>
        Browse the menu, ask for anything, or call someone up — no sign-in.
        Prices look like {formatMoney(money(115_000, 'INR'))}.
      </p>
    </main>
  );
}
