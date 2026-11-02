import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Bell, ChevronLeft } from 'lucide-react';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getRequestTypeByKey, CALL_SERVICE_KEY } from '@/modules/requests';
import { CallForService } from './call-form';
import styles from './service.module.css';

/**
 * "Someone comes up to room 214."
 *
 * One tap, and the reference's own words for why: "No queue, no call, no reason
 * needed." Free, so #9 applies in full — an anonymous REQUEST-tier session gets
 * a person walking, with nothing in the way.
 *
 * There is no Direction A board for this screen. It is drawn in the
 * amenities board's language (D-100): the back arrow, a Marcellus question at
 * title-1, one card that says what will happen, the optional note, and the
 * one accent button pinned under the thumb.
 */
export const dynamic = 'force-dynamic';

export default async function ServiceScreen({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

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
          <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </header>

      <div className={styles.intro}>
        <p className={styles.eyebrow}>Call for service</p>
        <h1 className={styles.title}>
          Someone comes up to room <span className="tabular">{session.roomNumber}</span>
        </h1>
        <p className={styles.lede}>No queue, no call, no reason needed.</p>
      </div>

      {type ? (
        <>
          {/*
            What will happen, as one card: the wait — the one number on the
            screen and the answer to "should I bother" — and that it is free.
            The bell is the same mark as this screen's tile on the room home.
          */}
          <div className={styles.promise}>
            <Bell className={styles.promiseIcon} size={24} strokeWidth={1.5} aria-hidden="true" />
            <span className={styles.promiseBody}>
              <span className={styles.promiseLine}>
                Usually <span className="tabular">{type.slaMinutes}</span> minutes
              </span>
              <span className={styles.promiseSub}>Free. Nothing goes on your bill.</span>
            </span>
          </div>

          <CallForService qrCode={qrCode} idempotencyKey={idempotencyKey} />
        </>
      ) : (
        <p className={styles.unavailable}>
          Calling for service is not set up here. The front desk can help.
        </p>
      )}
    </main>
  );
}
