import { withTenant } from '@/db';
import { redirect } from 'next/navigation';
import { getStaffSession } from '@/lib/auth-context';
import { requestPathname } from '@/lib/request-path';
import { can } from '@/modules/identity';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { kitchenTickets } from '@/modules/ordering';
import { TicketRail } from './ticket-rail';
import { LiveTickets } from './live-tickets';
import styles from './kds.module.css';

/**
 * The kitchen display.
 *
 * An always-on shared screen in a hot kitchen — which shapes almost every
 * decision here. Big type, high contrast, no hover-only affordances, and the
 * thinnest role in the product driving it (see KITCHEN in permissions.ts).
 *
 * The rail is SERVER-rendered and the live feed only tells it to refresh. That
 * ordering matters: a tablet that loses its connection for an hour still shows
 * a correct board on the next poll or reload, rather than a board built
 * entirely from events it may have missed.
 */
export const dynamic = 'force-dynamic';

export default async function KitchenDisplay() {
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

  // A cook has one property. A group F&B manager legitimately has several, and
  // picking the first is a placeholder — the property switcher is admin work.
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
      return { outlet: found, tickets: await kitchenTickets(tx, { outletId: found.id }) };
    },
  );

  if (!outlet) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>No kitchen is configured at this property.</p>
      </main>
    );
  }

  const permissions = {
    accept: can(session, propertyId, 'order:accept'),
    reject: can(session, propertyId, 'order:reject'),
    advance: can(session, propertyId, 'order:advance'),
    // The 86 button. KITCHEN holds this and nothing else on the catalog.
    availability: can(session, propertyId, 'catalog:availability'),
  };

  /**
   * Tickets nobody has accepted yet.
   *
   * Counted from the list already on the page rather than through
   * `openTicketCount()` — that function counts every open status and would be a
   * second query for data sitting in `tickets`. What a kitchen needs to see is
   * the number waiting for someone to say yes.
   */
  const unacknowledged = tickets.filter((t) => t.status === 'PLACED').length;

  return (
    <main className={styles.shell}>
      <header className={styles.bar}>
        <h1 className={styles.title}>{outlet.name}</h1>
        <span className={`${styles.count} tabular`}>
          {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'}
        </span>
        {unacknowledged > 0 ? (
          <span className={`${styles.unacked} tabular`} role="status">
            {unacknowledged} waiting
          </span>
        ) : null}
        <LiveTickets propertyId={propertyId} unacknowledged={unacknowledged} />
      </header>

      <TicketRail
        propertyId={propertyId}
        tickets={tickets}
        permissions={permissions}
      />
    </main>
  );
}
