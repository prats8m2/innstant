import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getRequestTypeByKey, CALL_SERVICE_KEY } from '@/modules/requests';
import { CallForService } from './call-form';
import styles from './service.module.css';

/**
 * "Someone comes up to room 214."
 *
 * One tap, and the reference's own words for why: "No queue, no call, no reason
 * needed." Free, so #9 applies in full — an anonymous REQUEST-tier session gets
 * a person walking, with nothing in the way.
 */
export const dynamic = 'force-dynamic';

export default async function ServiceScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  const type = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    (tx) => getRequestTypeByKey(tx, {
      propertyId: session.propertyId,
      key: CALL_SERVICE_KEY,
    }),
  );

  const idempotencyKey = crypto.randomUUID();

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          ←
        </Link>
        <h1 className={styles.barTitle}>Service</h1>
      </header>

      {/* The arches from the reference: three nested shapes and a light moving
          across them. Decorative, and the reason this screen feels like a bell
          pull rather than a form. */}
      <div className={styles.stage}>
        <span className={styles.archOuter} aria-hidden="true" />
        <span className={styles.archMid} aria-hidden="true" />
        <span className={styles.archInner} aria-hidden="true" />
        <span className={styles.sweep} aria-hidden="true" />

        <div className={styles.pitch}>
          <p className={styles.headline}>Someone comes up to room {session.roomNumber}</p>
          <p className={styles.sub}>
            {type
              ? `One tap. No queue, no call, no reason needed. Usually ${type.slaMinutes} minutes.`
              : 'One tap. No queue, no call, no reason needed.'}
          </p>
        </div>
      </div>

      {type ? (
        <CallForService qrCode={qrCode} idempotencyKey={idempotencyKey} />
      ) : (
        <p className={styles.unavailable}>
          Calling for service is not set up here. The front desk can help.
        </p>
      )}
    </main>
  );
}
