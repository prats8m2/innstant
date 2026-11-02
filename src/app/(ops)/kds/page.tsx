import { withTenant } from '@/db';
import { redirect } from 'next/navigation';
import { getStaffSession } from '@/lib/auth-context';
import { requestPathname } from '@/lib/request-path';
import { can, consoleChrome, findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutletConfig, getOutletHours, listUnavailableItems,
  outletOpenState, portionsLeftToday,
} from '@/modules/catalog';
import { kitchenTickets } from '@/modules/ordering';
import { formatClock, localTimeAt } from '@/lib/clock';
import { KitchenBoard } from './kitchen-board';
import { isNight } from '../night';
import styles from './kds.module.css';

/**
 * The kitchen display.
 *
 * An always-on shared screen in a hot kitchen — which shapes almost every
 * decision here. Big type, high contrast, no hover-only affordances, and the
 * thinnest role in the product driving it (see KITCHEN in permissions.ts).
 *
 * The board is SERVER-rendered and the live feed only tells it to refresh. That
 * ordering matters: a tablet that loses its connection for an hour still shows
 * a correct board on the next poll or reload, rather than a board built
 * entirely from events it may have missed.
 *
 * ─── D-048: one rail became three columns ──────────────────────────────────
 *
 * It used to be a single list, oldest first, every open ticket in it. That is
 * the right shape for four tickets and the wrong one for fourteen: the question
 * a cook asks is not "what is oldest" but "what do I start, what is on, and
 * what is going cold at the pass" — three questions with three different
 * answers, which a single list makes you scan for.
 *
 * The columns are the state machine, not a view preference:
 *
 *   New          PLACED
 *   Cooking      ACCEPTED, PREPARING
 *   At the pass   READY
 *
 * Which is exactly `KITCHEN_OPEN_STATUSES`, partitioned. Nothing here decides
 * what is open — moving a ticket between columns is `advanceOrder()` and
 * nothing else.
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

  const mayChangeAvailability = can(session, propertyId, 'catalog:availability');

  const { property, outlet, tickets, hours, unavailable, accent, portions } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getInRoomDiningOutletConfig(tx, propertyId);
      // The property's guest theme picks the board's accent, exactly as it
      // picks the console's (D-100) — one read, the same one the console makes.
      const chrome = await consoleChrome(tx, { propertyId, staffUserId: session.staffUserId });
      if (!found) {
        return {
          property: null, outlet: null, tickets: [], hours: [], unavailable: [],
          accent: chrome.theme, portions: [],
        };
      }
      const loadedProperty = await findProperty(tx, propertyId);
      const open = await kitchenTickets(tx, { outletId: found.id });

      /*
       * "Safed maas: last one tonight" — the board's All day footnote, from
       * the daily limits the menu already keeps (D-086). Only for dishes still
       * to make; a dish with no limit is absent from the map and says nothing.
       */
      const toMake = [...new Set(open
        .filter((t) => t.status !== 'READY')
        .flatMap((t) => t.lines.map((l) => l.menuItemId))
        .filter((id): id is string => Boolean(id)))];
      const left = toMake.length
        ? await portionsLeftToday(tx, {
            itemIds: toMake,
            businessDate: localTimeAt(new Date(), loadedProperty?.timezone ?? 'Asia/Kolkata').date!,
          })
        : new Map<string, { limit: number; left: number }>();

      return {
        property: loadedProperty,
        outlet: found,
        tickets: open,
        hours: await getOutletHours(tx, found.id),
        // The 86 tray. Skipped entirely for an account that cannot put a dish
        // back — the tray would be a row of buttons that refuse.
        unavailable: mayChangeAvailability
          ? await listUnavailableItems(tx, { outletId: found.id })
          : [],
        accent: chrome.theme,
        portions: [...left].map(([menuItemId, { left: remaining }]) => ({ menuItemId, left: remaining })),
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

  /**
   * Everything a human reads is in the PROPERTY's timezone, never the server's
   * (CLAUDE.md "Dates"). The board's clock keeps ticking client-side from this
   * same zone; the closing time is resolved here because `outletOpenState()`
   * needs the hours rows and those are not worth shipping to the browser.
   */
  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const openState = outletOpenState(hours, localTimeAt(new Date(), timeZone));
  const closesAt = openState.isOpen && openState.closesAt
    ? `closes ${formatClock(openState.closesAt)}`
    : 'closed to orders';

  const permissions = {
    accept: can(session, propertyId, 'order:accept'),
    reject: can(session, propertyId, 'order:reject'),
    advance: can(session, propertyId, 'order:advance'),
    // The 86 button. KITCHEN holds this and nothing else on the catalog.
    availability: mayChangeAvailability,
  };

  const renderedAt = Date.now();
  return (
    <KitchenBoard
      propertyId={propertyId}
      /* "The Kesari · closes 1am" — which hotel this screen belongs to, for
         the group F&B manager who has four of these tabs open. */
      subtitle={`${property?.name ?? 'This property'} · ${closesAt}`}
      timeZone={timeZone}
      /* Resolved here, not in the browser: a kitchen tablet that boots at
         23:00 must not paint a white screen at somebody before it hydrates. */
      initialMode={isNight(renderedAt, timeZone) ? 'dark' : 'light'}
      accent={accent}
      promiseMinutes={outlet.prepTimeMinutes}
      portions={portions}
      renderedAt={renderedAt}
      staffUserId={session.staffUserId}
      tickets={tickets}
      unavailable={unavailable}
      permissions={permissions}
    />
  );
}
