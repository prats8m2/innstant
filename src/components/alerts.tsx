import { withTenant } from '@/db';
import type { StaffSession } from '@/modules/identity';
import {
  deliverInApp, notificationsFor, renderNotification, unacknowledgedCount,
} from '@/modules/notifications';
import { NotificationBell, type BellItem } from './notification-bell';

/**
 * The server half of the bell: read this person's alerts, mark them delivered,
 * and hand the finished sentences to the client component.
 *
 * ─── Why delivery happens on a render ──────────────────────────────────────
 *
 * For the in-app channel there is no other honest moment. A row is SENT when a
 * screen belonging to the recipient has it, and this is that screen asking. So
 * the drainer runs in the same transaction as the read: whatever is returned
 * here has, by definition, been delivered.
 *
 * The consequence is the useful half. A row still PENDING an hour after a
 * breach means the duty manager has not opened the console — which is a fact
 * worth having, and one that marking rows SENT at write time would have thrown
 * away.
 *
 * (A prefetch of an admin page will mark rows delivered a moment before a human
 * looks. That is the right side to be wrong on: the alternative is a round trip
 * from the client on mount, and an alert that says "nobody has seen this" when
 * it is sitting on an open screen.)
 *
 * ─── Why it is a component and not a page's job ────────────────────────────
 *
 * It is mounted in the ops console's shell, so every admin screen has it
 * without seven pages remembering to load it, and again on the floor board,
 * because level 1 of an escalation goes to the assignee and the assignee is a
 * housekeeper who is not in the console.
 */
export async function Alerts({
  session,
  propertyId,
  placement,
}: {
  session: StaffSession;
  propertyId: string;
  placement?: 'end' | 'rail';
}) {
  const { rows, unseen } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      await deliverInApp(tx, { propertyId, staffUserId: session.staffUserId });
      return {
        rows: await notificationsFor(tx, {
          propertyId,
          staffUserId: session.staffUserId,
          limit: 12,
        }),
        unseen: await unacknowledgedCount(tx, {
          propertyId,
          staffUserId: session.staffUserId,
        }),
      };
    },
  );

  const items: BellItem[] = rows.map((row) => {
    const rendered = renderNotification({ template: row.template, payload: row.payload });
    return {
      id: row.id,
      title: rendered.title,
      body: rendered.body,
      href: rendered.href,
      at: row.createdAt.toISOString(),
      seen: row.acknowledgedAt !== null,
    };
  });

  return <NotificationBell propertyId={propertyId} items={items} unseen={unseen} placement={placement} />;
}
