import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getOutletHours, outletOpenState, describeOpenState,
} from '@/modules/catalog';
import { localTimeAt, formatClock, formatCheckoutDay } from '@/lib/clock';
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

/**
 * The four rows, verbatim from the reference (design/README.md — the copy is
 * part of the design, not filler).
 *
 * `built` says whether the row goes anywhere yet. Amenities and service are
 * real screens as of P2; the stay and nearby rows are P3 and P4, and they read
 * as coming rather than as links that do nothing. The subtitles that stated
 * facts we could not back — "Out Thursday, 11am" — say what the row IS instead,
 * because the real checkout time is printed at the top of this screen.
 */
const ROWS = [
  { key: 'amenities', title: 'Amenities', sub: 'Towels · laundry · a charger', built: true },
  { key: 'service', title: 'Call for service', sub: 'Someone comes up', built: true },
  { key: 'stay', title: 'Your stay', sub: 'When you leave, and what is on the room', built: true },
  { key: 'nearby', title: 'Nearby', sub: 'Places we vouch for', built: false },
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
   * than from a literal, in the PROPERTY's timezone.
   *
   * `formatCheckoutDay` rather than an `Intl` call inlined here: the stay screen
   * prints the same sentence, and two copies of a date format is how one of them
   * quietly starts saying 11:00am.
   */
  const checkout = formatCheckoutDay(
    session.scheduledCheckoutAt,
    property?.timezone ?? 'Asia/Kolkata',
  );

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
        {ROWS.map((row) => (row.built ? (
          <Link key={row.key} href={`${base}/${row.key}`} className={styles.row}>
            <span>
              <p className={styles.rowTitle}>{row.title}</p>
              <p className={styles.rowSub}>{row.sub}</p>
            </span>
            <span className={styles.chevron} aria-hidden="true">→</span>
          </Link>
        ) : (
          /* Not a link. A row that looks tappable and does nothing is worse
             than a row that says it is coming. */
          <span key={row.key} className={styles.row} data-soon="true">
            <span>
              <p className={styles.rowTitle}>{row.title}</p>
              <p className={styles.rowSub}>{row.sub} · soon</p>
            </span>
          </span>
        )))}
      </nav>

      <footer className={styles.footer}>
        {/* The property's own name, not a literal — a second hotel was greeted
            by the first one's until this screen started reading its property. */}
        <span>{property?.name ?? 'Your stay'}</span>
        <span className="tabular">Room {session.roomNumber}</span>
      </footer>
    </main>
  );
}
