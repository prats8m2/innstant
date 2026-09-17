import { withTenant } from '@/db';
import { redirect } from 'next/navigation';
import { getStaffSession } from '@/lib/auth-context';
import { requestPathname } from '@/lib/request-path';
import { can } from '@/modules/identity';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { runnerTickets } from '@/modules/ordering';
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

  const { outlet, tickets } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getInRoomDiningOutletConfig(tx, propertyId);
      if (!found) return { outlet: null, tickets: [] };
      return { outlet: found, tickets: await runnerTickets(tx, { outletId: found.id }) };
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

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <h1 className={styles.title}>Trays</h1>
        <span className={`${styles.count} tabular`}>
          {tickets.length - carrying} waiting
          {carrying ? ` · ${carrying} out` : ''}
        </span>
        <LiveQueue propertyId={propertyId} />
      </header>

      <PickupQueue
        propertyId={propertyId}
        staffUserId={session.staffUserId}
        tickets={tickets}
      />
    </main>
  );
}
