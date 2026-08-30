import { pgTable, uuid, text, integer, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { pk, ts, createdAt, updatedAt, tenantId, propertyId, currency, folioSource } from './_shared';
import { stays } from './stay';

/**
 * DATA-MODEL §5. Money is integer minor units with an explicit currency (#5).
 *
 * `folios` keeps MATERIALISED totals, recomputed by an AFTER trigger on
 * folio_lines (added in 0002_constraints.sql) so the totals cannot drift from
 * the lines. `folio_lines` is append-only in practice: a correction is a
 * negative ADJUSTMENT row, never an edit. That is what makes the folio
 * defensible when a guest disputes a charge at 7am on checkout day.
 */
export const folios = pgTable('folios', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  stayId: uuid('stay_id').notNull().references(() => stays.id),

  status: text('status').notNull().default('OPEN'),

  chargesMinor: integer('charges_minor').notNull().default(0),
  paymentsMinor: integer('payments_minor').notNull().default(0),
  balanceMinor: integer('balance_minor').notNull().default(0),
  currency: currency(),

  settledAt: ts('settled_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('folios_stay_uq').on(t.stayId)]);

export const folioLines = pgTable('folio_lines', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  folioId: uuid('folio_id').notNull().references(() => folios.id),

  source: folioSource('source').notNull(),
  /** Opaque pointer to the originating order / request / checkout request.
   *  Not an FK — the sources live in different modules. */
  sourceRefId: uuid('source_ref_id'),

  description: text('description').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  currency: currency(),

  /** D-011 — the PMS post is queued via integration_outbox and drained
   *  asynchronously. A hotel's Opera being down must never fail a guest's
   *  order, so this stays null until the post succeeds. */
  pmsPostedAt: ts('pms_posted_at'),
  pmsRef: text('pms_ref'),

  postedByStaffId: uuid('posted_by_staff_id'),
  createdAt: createdAt(),
}, (t) => [
  index('folio_lines_folio_idx').on(t.folioId, t.createdAt),
  // DATA-MODEL §9 — the PMS sync sweep.
  index('folio_lines_pms_sweep_idx').on(t.propertyId, t.pmsPostedAt),
]);

export const payments = pgTable('payments', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  folioId: uuid('folio_id').notNull().references(() => folios.id),

  provider: text('provider').notNull().default('RAZORPAY'),
  providerPaymentId: text('provider_payment_id'),
  providerOrderId: text('provider_order_id'),

  amountMinor: integer('amount_minor').notNull(),
  currency: currency(),
  status: text('status').notNull().default('PENDING'),
  method: text('method'),

  /** The raw webhook body, kept for reconciliation and disputes. */
  providerPayload: jsonb('provider_payload'),

  capturedAt: ts('captured_at'),
  failedAt: ts('failed_at'),
  failureReason: text('failure_reason'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('payments_folio_idx').on(t.folioId),
  uniqueIndex('payments_provider_payment_uq').on(t.provider, t.providerPaymentId),
]);
