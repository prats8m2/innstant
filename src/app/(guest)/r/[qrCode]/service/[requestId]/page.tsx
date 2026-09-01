import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getRequestForStay } from '@/modules/requests';
import { findProperty } from '@/modules/identity';
import { formatMoney, money } from '@/lib/money';
import { CancelRequest } from './cancel-form';
import styles from '../service.module.css';

/**
 * "Ravi is on his way."
 *
 * Where a request lands, whether it came from the one tap or from the amenities
 * list. The reference draws this as the same screen in a different state, and
 * that is right: a guest who tapped once should not be navigated somewhere new.
 *
 * Live updates arrive the same way the order timeline's do — through SSE on the
 * request channel. Until a request is assigned there is no name to show, so this
 * says what is true instead of inventing one.
 */
export const dynamic = 'force-dynamic';

export default async function RequestScreen({
  params,
}: {
  params: Promise<{ qrCode: string; requestId: string }>;
}) {
  const { qrCode, requestId } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const { request, property } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => ({
      // Scoped by stay: a request id in a URL must not resolve to the room next
      // door's leaking tap.
      request: await getRequestForStay(tx, { stayId: session.stayId, requestId }),
      property: await findProperty(tx, session.propertyId),
    }),
  );

  if (!request) notFound();

  const base = `/r/${encodeURIComponent(qrCode)}`;
  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const clock = new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
  });
  const by = request.slaTargetAt
    ? clock.format(request.slaTargetAt).replace(/\s?([ap])m/i, (_, p: string) => `${p.toLowerCase()}m`)
    : null;

  /**
   * What the guest is told, from the status.
   *
   * A name only when there is one — `assigned_staff_name` is null until routing
   * assigns it, and "Ravi is on his way" with no Ravi is the kind of invented
   * detail that makes a guest stop trusting the screen.
   */
  const who = request.assignedStaffName;
  const headline = {
    OPEN: 'Asked for. Someone is coming up.',
    ASSIGNED: who ? `${who} is on the way` : 'Someone is on the way',
    IN_PROGRESS: who ? `${who} is on the way` : 'On the way now',
    COMPLETED: 'Done',
    VERIFIED: 'Done',
    REJECTED: 'We could not do this',
    CANCELLED: 'Cancelled',
  }[request.status];

  const live = ['OPEN', 'ASSIGNED', 'IN_PROGRESS'].includes(request.status);

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <Link href={`${base}/home`} className={styles.back} aria-label="Back to room home">
          ←
        </Link>
        <h1 className={styles.barTitle}>Room {session.roomNumber}</h1>
        <span className={`${styles.barRef} tabular`}>{request.requestNumber}</span>
      </header>

      <section className={styles.status} role="status">
        <p className={styles.headline}>{headline}</p>

        {live && by ? (
          <p className={styles.eta}>
            <span className={styles.pulse} aria-hidden="true" />
            <span className="tabular">by {by}</span>
          </p>
        ) : null}

        {request.rejectionReason ? (
          <p className={styles.reason}>“{request.rejectionReason}”</p>
        ) : null}

        <ul className={styles.asked}>
          {request.lines.map((line, i) => (
            <li key={`${request.id}-${i}`} className={styles.askedLine}>
              <span className={`${styles.askedQty} tabular`}>{line.quantity}×</span>
              <span>{line.label}</span>
              {line.lineTotalMinor > 0 ? (
                <span className={`${styles.askedPrice} tabular`}>
                  {formatMoney(money(line.lineTotalMinor, request.currency))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        {request.guestNote ? <p className={styles.echo}>“{request.guestNote}”</p> : null}

        {request.totalMinor > 0 ? (
          <p className={styles.folioNote}>
            {formatMoney(money(request.totalMinor, request.currency))} is on room{' '}
            {session.roomNumber}, settled at checkout.
          </p>
        ) : (
          <p className={styles.folioNote}>Nothing to pay.</p>
        )}
      </section>

      {live ? (
        <CancelRequest qrCode={qrCode} requestId={request.id} />
      ) : null}

      <nav className={styles.actions}>
        <Link href={`${base}/amenities`} className={styles.secondary}>Ask for something else</Link>
        <Link href={`${base}/home`} className={styles.secondary}>Back to the room</Link>
      </nav>
    </main>
  );
}
