import Link from 'next/link';
import { withTenant } from '@/db';
import { can, findProperty } from '@/modules/identity';
import { adminAccess, AdminDenied } from './guard';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { AdminShell } from './admin-shell';
import styles from './admin.module.css';

/**
 * The ops console's front page.
 *
 * It lists what this account can actually reach, and says plainly what is not
 * built yet. A console full of dead links is how staff learn not to trust the
 * console.
 */
export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  // No permission required to see the console's front page — it lists what this
  // account can reach, and an account that can reach nothing should be told so
  // rather than bounced.
  const access = await adminAccess();
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, outlet } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      outlet: await getInRoomDiningOutletConfig(tx, propertyId),
    }),
  );

  const mayEditMenu = can(session, propertyId, 'catalog:read');
  const maySeeRequests = can(session, propertyId, 'request:read');
  const maySeeStays = can(session, propertyId, 'stay:read');
  const maySeeBuilding = can(session, propertyId, 'room:read');

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
      current="home"
    >
      <h1 className={styles.title}>Overview</h1>
      <p className={styles.lede}>
        {outlet
          ? outlet.isAcceptingOrders
            ? `${outlet.name} is taking orders.`
            : `${outlet.name} is closed to orders.`
          : 'No in-room dining outlet is configured here.'}
      </p>

      <ul className={styles.cards}>
        {mayEditMenu ? (
          <li className={styles.card}>
            <Link href="/admin/menu" className={styles.cardLink}>
              <span className={styles.cardTitle}>Menu</span>
              <span className={styles.cardBody}>
                Sections, dishes, prices, and what is on tonight.
              </span>
            </Link>
          </li>
        ) : null}

        <li className={styles.card}>
          <Link href="/kds" className={styles.cardLink}>
            <span className={styles.cardTitle}>Kitchen display</span>
            <span className={styles.cardBody}>The live ticket rail.</span>
          </Link>
        </li>

        <li className={styles.card}>
          <Link href="/runner" className={styles.cardLink}>
            <span className={styles.cardTitle}>Runner</span>
            <span className={styles.cardBody}>Trays waiting to go up.</span>
          </Link>
        </li>

        {maySeeRequests ? (
          <li className={styles.card}>
            <Link href="/admin/requests" className={styles.cardLink}>
              <span className={styles.cardTitle}>What guests can ask for</span>
              <span className={styles.cardBody}>
                Amenities and services, what each costs, how long it is promised
                in, and whose phone it reaches.
              </span>
            </Link>
          </li>
        ) : null}

        <li className={styles.card}>
          <Link href="/housekeeping" className={styles.cardLink}>
            <span className={styles.cardTitle}>The floors</span>
            <span className={styles.cardBody}>
              Amenities, housekeeping and repairs, with the clock on each one.
            </span>
          </Link>
        </li>

        {maySeeBuilding ? (
          <li className={styles.card}>
            <Link href="/admin/property" className={styles.cardLink}>
              <span className={styles.cardTitle}>The property</span>
              <span className={styles.cardBody}>
                The hotel&rsquo;s name and clock, its room types, its floors and
                rooms. A room added here gets its own QR sticker.
              </span>
            </Link>
          </li>
        ) : null}

        {maySeeStays ? (
          <li className={styles.card}>
            <Link href="/admin/rooms" className={styles.cardLink}>
              <span className={styles.cardTitle}>Rooms</span>
              <span className={styles.cardBody}>
                Who is in, who is out today, and what is on each folio. Check
                people in and out from here.
              </span>
            </Link>
          </li>
        ) : null}

        {maySeeStays ? (
          <li className={styles.card}>
            <Link href="/admin/checkouts" className={styles.cardLink}>
              <span className={styles.cardTitle}>Leaving</span>
              <span className={styles.cardBody}>
                Late checkouts waiting on an answer. Approving moves the stay,
                posts the fee and keeps the guest&rsquo;s phone working.
              </span>
            </Link>
          </li>
        ) : null}

        {/* Named rather than hidden: these are the next phases in
            docs/PROJECT-PLAN.md, and staff asking "where is the folio" deserve
            an answer better than a missing tile. */}
        <li className={`${styles.card} ${styles.soon}`}>
          <span className={styles.cardTitle}>Settling a folio</span>
          <span className={styles.cardBody}>
            Not built yet — the rest of P3. Checking out frees the room and
            records the balance; taking the money is still the card machine.
          </span>
        </li>
      </ul>
    </AdminShell>
  );
}
