import { withTenant } from '@/db';
import { redirect } from 'next/navigation';
import { getStaffSession } from '@/lib/auth-context';
import { requestPathname } from '@/lib/request-path';
import { can, findProperty, listFloors } from '@/modules/identity';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { runnerTickets, runnerDay } from '@/modules/ordering';
import { getOpenRequests } from '@/modules/requests';
import { getCurrentShift } from '@/modules/housekeeping';
import { FloorHeader, OffShiftNotice } from '../floor-header';
import { PickupQueue } from './pickup-queue';
import { LiveQueue } from './live-queue';
import styles from './runner.module.css';

/**
 * The runner app. A phone, in a corridor, one-handed.
 *
 * It is the last hop in P1's exit criterion — nothing else in the product can
 * mark an order DELIVERED, which is where the guest's tracking timeline ends
 * and where the kitchen's SLA clock stops.
 *
 * Deliberately not the KDS at a smaller width. The kitchen's question is "what
 * do I cook next"; a runner's is "which door, and how long has this been
 * sitting". Same data, different sort key, and only two buttons.
 *
 * ─── D-048: the shift moved to the top ─────────────────────────────────────
 *
 * Clocking in used to live only on `/housekeeping`, which meant a runner whose
 * shift had lapsed saw an empty queue with nothing explaining it. The header is
 * shared by both floor screens now, and an off-shift runner is told so rather
 * than shown a blank page — the requests board has always said this and the
 * pickup queue never did.
 */
export const dynamic = 'force-dynamic';

export default async function RunnerApp() {
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

  // A runner has one property. Picking the first is the same placeholder the
  // KDS uses — the property switcher is admin work.
  const propertyId = [...session.properties.keys()][0];
  if (!propertyId) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This account has no property assigned.</p>
      </main>
    );
  }

  if (!can(session, propertyId, 'order:read')) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>This account cannot see orders.</p>
      </main>
    );
  }

  const maySeeRequests = can(session, propertyId, 'request:read');

  const { property, outlet, tickets, floors, shift, myRequests, myDay } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getInRoomDiningOutletConfig(tx, propertyId);
      const here = await findProperty(tx, propertyId);
      return {
        property: here,
        // D-089: the strip at the top — what this runner has carried today.
        myDay: await runnerDay(tx, {
          propertyId, staffUserId: session.staffUserId, timeZone: here?.timezone ?? 'Asia/Kolkata',
        }),
        floors: await listFloors(tx, propertyId),
        shift: await getCurrentShift(tx, { propertyId, staffUserId: session.staffUserId }),
        outlet: found,
        tickets: found ? await runnerTickets(tx, { outletId: found.id }) : [],
        /**
         * Only to put a number on the other tab. The design shows both counts
         * because the point of the pair is knowing there are three requests
         * waiting while you are looking at trays — a tab that only counts
         * itself is a tab nobody switches to.
         */
        myRequests: maySeeRequests
          ? (await getOpenRequests(tx, { propertyId }))
            .filter((r) => r.assignedStaffId === session.staffUserId).length
          : null,
      };
    },
  );

  if (!outlet) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>No kitchen is configured at this property.</p>
      </main>
    );
  }

  const carrying = tickets.filter((t) => t.status === 'OUT_FOR_DELIVERY').length;
  const timeZone = property?.timezone ?? 'Asia/Kolkata';

  return (
    <main className={styles.shell}>
      <FloorHeader
        propertyId={propertyId}
        fullName={session.fullName}
        shift={shift}
        floors={floors}
        timeZone={timeZone}
        mayClock={can(session, propertyId, 'shift:clock')}
        current="/runner"
        tabs={[
          { href: '/runner', label: 'Pickups', count: tickets.length },
          ...(maySeeRequests
            ? [{ href: '/housekeeping', label: 'Requests', count: myRequests }]
            : []),
        ]}
      />

      <div className={styles.bar}>
        <h1 className={styles.title}>Trays</h1>
        <span className={`${styles.count} tabular`}>
          {tickets.length - carrying} waiting
          {carrying ? ` · ${carrying} out` : ''}
        </span>
        <LiveQueue propertyId={propertyId} />
      </div>

      {/* A tray is handed to whoever is standing at the pass, so the queue is
          still shown off shift — what changes is that nothing is ROUTED to
          them, and the notice says so rather than leaving a quiet screen. */}
      {shift ? null : <OffShiftNotice />}

      {/* Your run today. Two numbers, because a runner asks "how many have I
          done" and "am I quick", and nothing else on this screen says either. */}
      <dl className={styles.myDay}>
        <div>
          <dt>Handed over today</dt>
          <dd className="tabular">{myDay.delivered}</dd>
        </div>
        <div>
          <dt>Pass to door</dt>
          <dd className="tabular">{myDay.averageMinutesToDoor == null ? '—' : `${myDay.averageMinutesToDoor} min`}</dd>
        </div>
      </dl>

      <PickupQueue
        propertyId={propertyId}
        staffUserId={session.staffUserId}
        tickets={tickets}
      />
    </main>
  );
}
