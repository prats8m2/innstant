import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getRequestCatalog, CALL_SERVICE_KEY } from '@/modules/requests';
import { AmenityForm } from './amenity-form';
import styles from './amenities.module.css';

/**
 * Amenities — everything a guest can ask for that is not food.
 *
 * Free and chargeable in ONE list, which is the reference's own decision and
 * the line at the top says why: "Ask for as much as you like. Anything with a
 * price says so before you send it." Splitting them into paid and free tabs
 * would make asking for a towel feel like shopping.
 *
 * CLAUDE.md #9 — this whole screen renders for an anonymous REQUEST-tier
 * session. The one prompt appears only if the guest picks something that costs.
 */
export const dynamic = 'force-dynamic';

export default async function AmenitiesScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  const catalog = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      /**
       * Everything except the one-tap call.
       *
       * All four categories, including SERVICE: laundry and the airport
       * transfer are SERVICE rows, and the reference's own home screen says
       * they belong here — "Towels · laundry · transfer". Filtering the category
       * out left the two chargeable things off the only screen that offers
       * them, which is how an e2e found this.
       *
       * `CALL_SERVICE` is the exception: a one-tap call is not a list item, and
       * it has a screen of its own.
       */
      const all = await getRequestCatalog(tx, { propertyId: session.propertyId });
      return all.filter((card) => card.key !== CALL_SERVICE_KEY);
    },
  );

  // One key per render, so both taps of a double-tap carry the same one (#8).
  const idempotencyKey = crypto.randomUUID();

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          ←
        </Link>
        <h1 className={styles.barTitle}>Amenities</h1>
      </header>

      {catalog.length ? (
        <AmenityForm
          qrCode={qrCode}
          idempotencyKey={idempotencyKey}
          catalog={catalog}
          roomNumber={session.roomNumber}
        />
      ) : (
        <p className={styles.empty}>
          Nothing is set up to request here yet. The front desk can help.
        </p>
      )}
    </main>
  );
}
