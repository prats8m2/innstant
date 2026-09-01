import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { notifications } from '@/db/schema/notifications';

/**
 * Outbound alerts, as rows. DATA-MODEL §8.
 *
 * Every alert the product tries to send is a row here BEFORE it is sent, so a
 * missed one is diagnosable rather than a shrug. That ordering is the whole
 * point of the table: "we never told the duty manager" and "we told them and
 * their phone was off" are different problems with different fixes, and only a
 * row written first can tell them apart.
 *
 * ─── IN_APP is delivered; the outside channels are not ─────────────────────
 *
 * `deliverInApp()` below is the drainer, and the bell in the ops console and on
 * the floor board is where the rows land. It needs no external service, so it
 * could be built without asking anybody, and it is the fallback every other
 * channel wants anyway — when WhatsApp is added and a send fails, the row is
 * still on somebody's screen.
 *
 * PUSH, WHATSAPP and EMAIL stay unwritten. They need an external service, which
 * CLAUDE.md says to ask about first.
 *
 * What the statuses mean for IN_APP:
 *   PENDING  — written, and no screen belonging to the recipient has read it.
 *   SENT     — handed to a screen. `sent_at` is when.
 *   plus `acknowledged_at`, which is the recipient saying they have seen it.
 *
 * A row that stays PENDING is therefore a real signal rather than a shrug: the
 * duty manager has not opened the console since it was queued.
 */

export interface QueuedNotification {
  tenantId: string;
  propertyId: string;
  /** IN_APP today. PUSH, WHATSAPP and EMAIL are what a drainer will add. */
  channel: 'IN_APP' | 'PUSH' | 'WHATSAPP' | 'EMAIL';
  recipientStaffId?: string | null;
  recipientGuestSessionId?: string | null;
  recipientAddress?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /** What to say, resolved at delivery — never a rendered string here, so a
   *  template change does not rewrite history. */
  template: string;
  payload?: Record<string, unknown>;
}

export async function queueNotifications(
  tx: Tx,
  rows: readonly QueuedNotification[],
): Promise<number> {
  if (!rows.length) return 0;

  await tx.insert(notifications).values(rows.map((row) => ({
    tenantId: row.tenantId,
    propertyId: row.propertyId,
    channel: row.channel,
    recipientStaffId: row.recipientStaffId ?? null,
    recipientGuestSessionId: row.recipientGuestSessionId ?? null,
    recipientAddress: row.recipientAddress ?? null,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    template: row.template,
    payload: row.payload ?? {},
    status: 'PENDING',
  })));

  /**
   * Tell the listening processes, inside the same transaction (D-015, and the
   * same shape as `notifyRequestChanged`). A bell can never be lit for a row
   * that then rolls back.
   *
   * One notify per distinct recipient rather than one per row: the payload
   * carries no content at all, only who should re-read, and two escalations
   * queued in the same breath are one nudge.
   */
  const recipients = new Set(
    rows.filter((row) => row.channel === 'IN_APP' && row.recipientStaffId)
      .map((row) => `${row.propertyId}:${row.recipientStaffId}`),
  );

  for (const key of recipients) {
    const [propertyId, recipientStaffId] = key.split(':');
    const payload: StaffNotifiedPayload = { propertyId: propertyId!, recipientStaffId: recipientStaffId! };
    await tx.execute(
      sql`SELECT pg_notify(${NOTIFICATION_CHANNEL}, ${JSON.stringify(payload)})`,
    );
  }

  return rows.length;
}

/**
 * The channel a staff bell listens on.
 *
 * Deliberately NOT the request channel. The floor board already refreshes on
 * `service_request_changed`, and folding notifications into it would mean every
 * screen at the property re-reading every other screen's alerts — the filter
 * that matters here is one staff member, not one property.
 */
export const NOTIFICATION_CHANNEL = 'staff_notification';

/** Routing only. What was said is re-read through RLS by the screen (D-026). */
export interface StaffNotifiedPayload {
  propertyId: string;
  recipientStaffId: string;
}

/**
 * The drainer for the in-app channel: hand this person's pending alerts to the
 * screen that is asking for them.
 *
 * Called by the bell's own read, in the same transaction, because for an in-app
 * alert "delivered" means precisely "a screen belonging to the recipient
 * rendered it". There is nothing else it could honestly mean, and marking rows
 * SENT at write time would make the status say a screen had it when nobody was
 * logged in.
 *
 * Scoped to one staff member, so one person opening the console does not mark
 * the whole property's alerts as delivered.
 *
 * Idempotent: the second call updates nothing, because the WHERE no longer
 * matches. `attempts` is incremented anyway — for IN_APP that counts how many
 * times a screen picked the row up, which is what a "why did I see this twice"
 * question needs.
 */
export async function deliverInApp(
  tx: Tx,
  input: { propertyId: string; staffUserId: string; now?: Date },
): Promise<number> {
  const rows = await tx.update(notifications)
    .set({
      status: 'SENT',
      sentAt: input.now ?? new Date(),
      attempts: sql`${notifications.attempts} + 1`,
    })
    .where(and(
      eq(notifications.propertyId, input.propertyId),
      eq(notifications.recipientStaffId, input.staffUserId),
      eq(notifications.channel, 'IN_APP'),
      eq(notifications.status, 'PENDING'),
    ))
    .returning({ id: notifications.id });

  return rows.length;
}

export interface StaffNotification {
  id: string;
  template: string;
  payload: Record<string, unknown>;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
}

/**
 * What is waiting for one member of staff.
 *
 * Unacknowledged first and newest first — a screen showing these wants the
 * thing that has not been seen, not the tidiest chronology.
 */
export async function notificationsFor(
  tx: Tx,
  input: { propertyId: string; staffUserId: string; limit?: number },
): Promise<StaffNotification[]> {
  const rows = await tx.select({
    id: notifications.id,
    template: notifications.template,
    payload: notifications.payload,
    entityType: notifications.entityType,
    entityId: notifications.entityId,
    createdAt: notifications.createdAt,
    acknowledgedAt: notifications.acknowledgedAt,
  }).from(notifications)
    .where(and(
      eq(notifications.propertyId, input.propertyId),
      eq(notifications.recipientStaffId, input.staffUserId),
    ))
    /**
     * Unacknowledged first, then newest first — which is what the bell wants
     * and what this function has always claimed to do. It did not: the order
     * was `created_at` alone, so a fortnight of acknowledged rows could push
     * an unseen escalation off the end of the list.
     */
    .orderBy(asc(sql`${notifications.acknowledgedAt} is not null`), desc(notifications.createdAt))
    .limit(input.limit ?? 20);

  return rows.map((row) => ({
    ...row,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));
}

/** How many this person has not seen. For a badge. */
export async function unacknowledgedCount(
  tx: Tx,
  input: { propertyId: string; staffUserId: string },
): Promise<number> {
  const rows = await tx.select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(
      eq(notifications.propertyId, input.propertyId),
      eq(notifications.recipientStaffId, input.staffUserId),
      isNull(notifications.acknowledgedAt),
    ));
  return rows[0]?.n ?? 0;
}

/** Seen. Not deleted — the row is the audit trail. */
export async function acknowledgeAll(
  tx: Tx,
  input: { propertyId: string; staffUserId: string },
): Promise<void> {
  await tx.update(notifications)
    .set({ acknowledgedAt: new Date() })
    .where(and(
      eq(notifications.propertyId, input.propertyId),
      eq(notifications.recipientStaffId, input.staffUserId),
      isNull(notifications.acknowledgedAt),
    ));
}
