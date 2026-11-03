import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { mediaSrcSet } from '@/modules/media/paths';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { DEMO_NAME_COOKIE, DEMO_FLAG_COOKIE } from '@/modules/demo';
import { getPropertyProfile, dialable } from '@/modules/identity';
import { getStayAtDesk } from '@/modules/stay';
import { formatCheckoutShort, stayNights } from '@/lib/clock';
import { guestBranding } from '../../../_brand/brand-scope';
import { ArchMark } from '../../../_brand/arch-mark';
import styles from './welcome.module.css';

/**
 * Welcome — the first screen a phone sees of a stay, once.
 *
 * `design/reference/midnight/Welcome.dc.html`. The link (`../route.ts`) sends
 * a scan here only when it has just minted the session; a phone that already
 * holds one goes straight to the home. Nothing here asks anything of the
 * guest (#9, D-012): it says which room, how long, when they leave, and has
 * one button into the stay.
 *
 * The board's digital key is not built — there is no key behind it — so the
 * circle inside the arch holds the room number instead, and the subtitle says
 * the room is ready rather than that a key lives on this phone.
 *
 * No `loading.tsx`: it is one quick read, and the scan's own redirect is
 * already the wait.
 */
export const dynamic = 'force-dynamic';

export default async function Welcome({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  // Same guard as every room screen: no session, back through the link (#10).
  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  /** The website visitor's own name wins over the stay's (D-059), as on home. */
  const isDemo = store.get(DEMO_FLAG_COOKIE)?.value === '1';
  const demoName = isDemo ? (store.get(DEMO_NAME_COOKIE)?.value ?? null) : null;
  const callThem = demoName ?? session.guestFirstName;

  const { profile, stay } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => ({
      profile: await getPropertyProfile(tx, session.propertyId),
      stay: await getStayAtDesk(tx, { propertyId: session.propertyId, stayId: session.stayId }),
    }),
  );
  const branding = await guestBranding();

  const timeZone = profile?.timezone ?? 'Asia/Kolkata';
  const nights = stayNights(stay?.checkedInAt ?? new Date(), session.scheduledCheckoutAt, timeZone);
  /** "Sun 11am" — on the hotel's clock, never the server's. */
  const checkout = formatCheckoutShort(session.scheduledCheckoutAt, timeZone);
  // Only a number the hotel has given. Never an invented one.
  const deskPhone = profile?.guestInfo.contactPhone
    ? dialable(profile.guestInfo.contactPhone).tel
    : null;
  const name = profile?.name ?? 'Your stay';

  return (
    <main className={styles.shell}>
      <header className={styles.brand}>
        {branding.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- an upload, or a URL pasted before uploads (D-093)
          <img
            src={branding.logoUrl}
            srcSet={mediaSrcSet(branding.logoUrl)}
            sizes="200px"
            alt={name}
            className={styles.logo}
          />
        ) : (
          <>
            <ArchMark className={styles.brandMark} />
            <span className={styles.wordmark}>{name}</span>
          </>
        )}
      </header>

      {/* The doorway: the board's two arch lines and its lamplight, with the
          room in the circle where the board draws a key. */}
      <div className={styles.arch}>
        <span className={styles.archOuter} aria-hidden="true" />
        <span className={styles.archInner} aria-hidden="true" />
        <span className={styles.archGlow} aria-hidden="true" />
        <div className={styles.archContent}>
          <span className={styles.roomCircle} data-long={session.roomNumber.length > 4}>
            <span className="sr-only">Room </span>
            {session.roomNumber}
          </span>
          <span className={styles.roomLabel} aria-hidden="true">Room</span>
        </div>
      </div>

      <div className={styles.text}>
        <p className={styles.eyebrow}>You&rsquo;re checked in</p>
        <h1 className={styles.title}>
          {callThem ? (
            <>
              Welcome home,<br />
              <em className={styles.name}>{callThem}</em>
            </>
          ) : 'Welcome home'}
        </h1>
        <p className={styles.lede}>
          Your room is ready, and everything you need is on this phone.
        </p>
      </div>

      <dl className={styles.strip}>
        <div className={styles.cell}>
          <dt className={styles.cellLabel}>Room</dt>
          <dd className={styles.cellValue}>{session.roomNumber}</dd>
        </div>
        <div className={styles.cell}>
          <dt className={styles.cellLabel}>Nights</dt>
          <dd className={styles.cellValue}>{nights}</dd>
        </div>
        <div className={styles.cell}>
          <dt className={styles.cellLabel}>Check-out</dt>
          <dd className={styles.cellValue}>{checkout}</dd>
        </div>
      </dl>

      <div className={styles.spacer} />

      <Link href={`${base}/home`} className={styles.enter}>
        Enter your stay
        <ArrowRight size={18} strokeWidth={1.8} aria-hidden="true" />
      </Link>
      {deskPhone ? (
        <a href={`tel:${deskPhone}`} className={styles.desk}>Speak to the front desk</a>
      ) : null}
    </main>
  );
}
