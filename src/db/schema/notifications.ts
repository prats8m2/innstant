import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { pk, ts, createdAt, tenantId, propertyId } from './_shared';

/**
 * DATA-MODEL §8 — every outbound alert as a row, so a missed kitchen alert is
 * diagnosable rather than a shrug.
 *
 * Web Push is best-effort: iOS Safari is not reliable enough to be the primary
 * channel for a kitchen ticket. The KDS is an always-on screen with an audio
 * alert and a persistent unacknowledged count; this table is the audit of what
 * we TRIED to send, not the mechanism guests and staff actually depend on.
 */
export const notifications = pgTable('notifications', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),

  channel: text('channel').notNull(),
  recipientStaffId: uuid('recipient_staff_id'),
  recipientGuestSessionId: uuid('recipient_guest_session_id'),
  recipientAddress: text('recipient_address'),

  entityType: text('entity_type'),
  entityId: uuid('entity_id'),

  template: text('template').notNull(),
  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),

  status: text('status').notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),

  sentAt: ts('sent_at'),
  acknowledgedAt: ts('acknowledged_at'),
  createdAt: createdAt(),
}, (t) => [
  index('notifications_recipient_idx').on(t.recipientStaffId, t.status),
  index('notifications_entity_idx').on(t.entityType, t.entityId),
]);
