import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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
 * ─── Nothing delivers these yet, and that is deliberate ────────────────────
 *
 * The channel is a product decision — in-app, WhatsApp (a P5 objection-killer),
 * email — and it needs an external service, which CLAUDE.md says to ask about.
 * Writing the row now means the SLA sweep is complete and testable today, and
 * the day a channel is chosen it drains a table that already has the history in
 * it rather than starting empty.
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
    .orderBy(desc(notifications.createdAt))
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
