import { withTenant } from '@/db';
import { redirect } from 'next/navigation';
import { getStaffSession } from '@/lib/auth-context';
import { requestPathname } from '@/lib/request-path';
import { can, findProperty, listFloors } from '@/modules/identity';
import { getOpenRequests, OPEN_REQUEST_STATUSES } from '@/modules/requests';
import { getCurrentShift, onDutyCount } from '@/modules/housekeeping';
import { Alerts } from '@/components/alerts';
import { RequestBoard } from './request-board';
import { LiveBoard } from './live-board';
import { ShiftBar } from './shift-bar';
import styles from './housekeeping.module.css';

/**
 * The floor board — every request nobody has finished with.
 *
 * A phone screen first, unlike the KDS. A housekeeper is walking a corridor with
 * a trolley; a cook is standing at a pass. Same data, different posture, and a
 * board designed for a wall-mounted tablet is unusable in an apron pocket.
 *
 * Ordered by SLA target rather than by age (`getOpenRequests`): a wake-up call
 * raised five minutes ago is more urgent than towels raised twenty minutes ago,
 * and a board sorted by age buries exactly the thing that is about to breach.
 */
export const dynamic = 'force-dynamic';

export default async function HousekeepingBoard() {
  /**
   * No session redirects rather than throwing. The middleware is a cookie
   * turnstile that cannot reach Postgres from the edge, so it waves through a
   * REVOKED or expired cookie; throwing here renders the error boundary and an
   * always-on kitchen tablet shows "Application error" instead of a sign-in
   * form. Same reasoning as `adminAccess()`.
   */
  const session = await getStaffSession();
  if (!session) {
    const next = await requestPathname();
    redirect(next ? `/admin/login?next=${encodeURIComponent(next)}` : '/admin/login');
  }

  const propertyId = [...session.properties.keys()][0];
  if (!propertyId) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This account has no property assigned.</p>
      </main>
    );
  }

  if (!can(session, propertyId, 'request:read')) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This account cannot see service requests.</p>
      </main>
    );
  }

  const { property, all, floors, shift, onDuty } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      floors: await listFloors(tx, propertyId),
      // The shift of whoever is holding this phone, and how many people are on
      // the floors at all — the second number is what tells a lone housekeeper
      // that nobody else is covering.
      shift: await getCurrentShift(tx, { propertyId, staffUserId: session.staffUserId }),
      onDuty: await onDutyCount(tx, propertyId),
      /**
       * COMPLETED as well as the live ones.
       *
       * The state machine has VERIFIED because the person who did the work and
       * the person who checks it are different people — and a board that drops a
       * request the moment it is completed makes that button unreachable. So
       * completed-but-unchecked gets its own section below, and the count in the
       * header stays the work still to do.
       */
      all: await getOpenRequests(tx, {
        propertyId,
        statuses: [...OPEN_REQUEST_STATUSES, 'COMPLETED'],
      }),
    }),
  );

  const permissions = {
    assign: can(session, propertyId, 'request:assign'),
    advance: can(session, propertyId, 'request:advance'),
    verify: can(session, propertyId, 'request:verify'),
  };

  const requests = all.filter((r) => r.status !== 'COMPLETED');
  const toCheck = all.filter((r) => r.status === 'COMPLETED');
  const breached = requests.filter((r) => r.breached).length;
  const unclaimed = requests.filter((r) => r.status === 'OPEN').length;

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <h1 className={styles.title}>{property?.name ?? 'The floors'}</h1>
        <span className={`${styles.count} tabular`}>
          {requests.length} open
        </span>
        {breached > 0 ? (
          <span className={`${styles.late} tabular`} role="status">{breached} late</span>
        ) : null}
        <span className={`${styles.count} tabular`}>{onDuty} on duty</span>
        <LiveBoard propertyId={propertyId} breached={breached} unclaimed={unclaimed} />
        {/* Level 1 of an escalation goes to the ASSIGNEE (D-028), and the
            assignee is holding this phone, not sitting in the ops console. A
            bell only on `/admin` would deliver two thirds of what the sweep
            writes. */}
        <Alerts session={session} propertyId={propertyId} />
      </header>

      {can(session, propertyId, 'shift:clock') ? (
        <ShiftBar propertyId={propertyId} floors={floors} shift={shift} />
      ) : null}

      <RequestBoard
        propertyId={propertyId}
        staffUserId={session.staffUserId}
        requests={requests}
        permissions={permissions}
      />

      {toCheck.length ? (
        <section className={styles.checked}>
          <h2 className={styles.checkedHeading}>
            Done, not checked ({toCheck.length})
          </h2>
          <RequestBoard
            propertyId={propertyId}
            staffUserId={session.staffUserId}
            requests={toCheck}
            permissions={permissions}
          />
        </section>
      ) : null}
    </main>
  );
}
