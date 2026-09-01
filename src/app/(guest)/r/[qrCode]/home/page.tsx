import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getOutletHours, outletOpenState, describeOpenState,
} from '@/modules/catalog';
import { localTimeAt, formatClock } from '@/lib/clock';
import styles from './room-home.module.css';

/**
 * The room home — the post-scan landing.
 *
 * Rebuilt from `design/reference/` as real components; the export is a picture
 * to match, not markup to copy (design/README.md). Every value comes from
 * `src/styles/theme.css` — there is no hex, radius or duration in this file.
 *
 * Copy is taken verbatim from the export. "Seven places we vouch for" is the
 * design; a paraphrase is a different product.
 *
 * CLAUDE.md #9: this renders for an anonymous REQUEST-tier session with
 * nothing in the way. No login, no verification, no onboarding.
 */
export const dynamic = 'force-dynamic';

const ROWS = [
  { key: 'amenities', title: 'Amenities', sub: 'Towels · laundry · transfer' },
  { key: 'service', title: 'Call for service', sub: 'Someone comes up' },
  { key: 'stay', title: 'Your stay', sub: 'Out Thursday, 11am' },
  { key: 'nearby', title: 'Nearby', sub: 'Seven places we vouch for' },
] as const;

export default async function RoomHome({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  // Cookie missing or stale — checked out, expired, revoked. Send them back
  // through the link, which issues a fresh session or 404s (#10).
  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  /**
   * The property's own name and its own hours.
   *
   * Both were literals — "The Kesari" and "Kitchen open until 11:30pm" — from
   * S2, when there was no data to read. A second hotel would have been greeted
   * by the first one's name, and the closing time never matched the seeded rows
   * (07:00–01:00) it was supposedly describing.
   */
  const { property, kitchen } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      const found = await findProperty(tx, session.propertyId);
      const outlet = await getInRoomDiningOutlet(tx, session.propertyId);
      const timeZone = found?.timezone ?? 'Asia/Kolkata';

      return {
        property: found,
        kitchen: outlet
          ? describeOpenState(
              outletOpenState(
                await getOutletHours(tx, outlet.id),
                localTimeAt(new Date(), timeZone),
              ),
              formatClock,
            )
          : null,
      };
    },
  );

  /**
   * "until Thursday, 11am" — the reference's own words, from the stay rather
   * than from a literal. Rendered in the PROPERTY's timezone: a guest due out
   * at 11am in Udaipur must not read 5:30am because the server is in UTC.
   */
  const checkout = new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: property?.timezone ?? 'Asia/Kolkata',
  })
    .format(session.scheduledCheckoutAt)
    .replace(/\s?([ap])m/i, (_, p: string) => `${p.toLowerCase()}m`)
    // "11am", not "11:00am" — a whole hour drops its minutes, the same rule
    // `formatClock` follows. The reference writes "Out Thursday, 11am".
    .replace(/:00(?=[ap]m)/i, '');

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Room {session.roomNumber}</p>
        <h1 className={styles.property}>{property?.name ?? 'Your stay'}</h1>
        <p className={styles.stayLine}>
          Room {session.roomNumber} until {checkout}.
        </p>
        {kitchen ? (
          <span className={styles.kitchen}>
            <span className={styles.pulse} aria-hidden="true" />
            {kitchen}
          </span>
        ) : null}
      </header>

      <Link href={`${base}/menu`} className={styles.dining}>
        <span className={styles.diningLabel}>In-room dining</span>
        <p className={styles.diningTitle}>Order to the room</p>
        <p className={styles.diningSub}>
          Rajasthani plates and the rooftop grill, brought up.
        </p>
      </Link>

      <nav className={styles.rows} aria-label="Services">
        {ROWS.map((row) => (
          <Link key={row.key} href={`${base}/${row.key}`} className={styles.row}>
            <span>
              <p className={styles.rowTitle}>{row.title}</p>
              <p className={styles.rowSub}>{row.sub}</p>
            </span>
            <span className={styles.chevron} aria-hidden="true">→</span>
          </Link>
        ))}
      </nav>

      <footer className={styles.footer}>
        <span>The Kesari · Udaipur</span>
        <span className="tabular">Room {session.roomNumber}</span>
      </footer>
    </main>
  );
}
