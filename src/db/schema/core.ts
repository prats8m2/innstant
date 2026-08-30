import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { pk, ts, createdAt, tenantId } from './_shared';

/**
 * Cross-cutting tables. Owned by no module.
 *
 * These are deliberately exempt from the module-boundary lint rule (D-019):
 * every module writes `event_log` in its own transaction (#7), so scoping it
 * to one module would break either #7 or D-001.
 *
 * Prefer `recordEvent(tx, …)` from `src/db/events.ts` over touching the table
 * directly — #7's real requirement is that the event is written in the SAME
 * transaction as the status change, and a helper that takes `tx` is what makes
 * that hard to get wrong.
 */

/**
 * The audit trail, the SLA analytics source, and the dispute record — one
 * append-only table instead of three systems that disagree (D-010).
 * UPDATE and DELETE are revoked from `app_user` in 0001_rls.sql.
 * The only table with real growth; partition by month past a few million rows.
 */
export const eventLog = pgTable('event_log', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: uuid('property_id'),

  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),

  /** e.g. 'order.accepted'. The transition, not a free-text note. */
  eventType: text('event_type').notNull(),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),

  /** Who caused it. Exactly one of these is set, or neither for system events. */
  actorStaffId: uuid('actor_staff_id'),
  actorGuestSessionId: uuid('actor_guest_session_id'),
  actorKind: text('actor_kind').notNull().default('SYSTEM'),

  payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),

  occurredAt: ts('occurred_at').notNull().defaultNow(),
}, (t) => [
  // DATA-MODEL §9 — the audit trail lookup.
  index('event_log_entity_idx').on(t.entityType, t.entityId, t.occurredAt),
  index('event_log_property_idx').on(t.propertyId, t.occurredAt),
]);

/**
 * #8. Order placement, payment capture, PMS posting.
 * A guest double-tapping "Place order" on hotel wifi is the most common
 * duplicate-write source in this product, and it is not hypothetical.
 * The stored response is replayed on retry rather than re-executing.
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: pk(),
  tenantId: tenantId(),

  /** e.g. 'order.place' — scopes the key so unrelated paths cannot collide. */
  scope: text('scope').notNull(),
  key: text('key').notNull(),

  status: text('status').notNull().default('IN_PROGRESS'),
  responseBody: jsonb('response_body'),
  responseStatus: integer('response_status'),

  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
}, (t) => [
  uniqueIndex('idempotency_keys_scope_key_uq').on(t.tenantId, t.scope, t.key),
]);

/**
 * #8 / D-011. The PMS adapter drains this.
 * A hotel's Opera instance being down must never fail a guest's order: write
 * the folio line, queue the post, retry with backoff.
 */
export const integrationOutbox = pgTable('integration_outbox', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: uuid('property_id').notNull(),

  target: text('target').notNull(),
  operation: text('operation').notNull(),
  payload: jsonb('payload').notNull(),

  status: text('status').notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),

  nextAttemptAt: ts('next_attempt_at').notNull().defaultNow(),
  deliveredAt: ts('delivered_at'),
  createdAt: createdAt(),
}, (t) => [
  index('integration_outbox_sweep_idx').on(t.status, t.nextAttemptAt),
]);
