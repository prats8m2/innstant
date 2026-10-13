import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ConciergeBell } from 'lucide-react';
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
          ←
        </Link>
        <h1 className={styles.barTitle}>Service</h1>
      </header>

      {/*
        The bell, and the call going out from it.

        This replaced three static arch outlines with the headline sitting on
        top of them: the shapes read as nothing in particular, the text
        overlapped their edges, and 300px of the screen was doing no work. The
        composition is now what the screen is FOR — a bell, rings leaving it,
        and the promise underneath.

        Everything here is decorative and `aria-hidden`; the words below carry
        the meaning, and the button below that does the thing.
      */}
      <div className={styles.stage}>
        <span className={styles.aurora} aria-hidden="true" />

        <div className={styles.bellWrap}>
          {/* Three rings on one keyframe, staggered by a third of it each, so
              the call looks continuous rather than like three pulses. */}
          <span className={styles.ring} aria-hidden="true" />
          <span className={styles.ring} aria-hidden="true" />
          <span className={styles.ring} aria-hidden="true" />

          <span className={styles.bell} aria-hidden="true">
            {/* The same mark as this screen's tile on the room home, so the
                two are recognisably one thing. */}
            <ConciergeBell size={40} strokeWidth={1.6} absoluteStrokeWidth />
          </span>
        </div>

        <div className={styles.pitch}>
          <p className={styles.headline}>Someone comes up to room {session.roomNumber}</p>
          <p className={styles.sub}>No queue, no call, no reason needed.</p>
          {/*
            The wait, as its own mark rather than a third sentence. It is the
            one number on the screen and the answer to "should I bother".
          */}
          {type ? (
            <p className={styles.waitChip}>
              <span className={styles.waitDot} aria-hidden="true" />
              Usually {type.slaMinutes} minutes
            </p>
          ) : null}
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
