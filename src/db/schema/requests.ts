import { pgTable, uuid, text, integer, boolean, index } from 'drizzle-orm/pg-core';
import {
  pk, ts, createdAt, updatedAt, tenantId, propertyId, currency, archivedAt, serviceRequestStatus,
} from './_shared';
import { stays } from './stay';
import { floors, staffUsers } from './identity';

/**
 * DATA-MODEL §7. `request_types` is the property-configurable catalog behind
 * BOTH "order amenities" and "call the service boy" — one generic guest UI,
 * and the ops team self-serves rather than filing a ticket with us.
 */
export const requestTypes = pgTable('request_types', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),

  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category').notNull().default('AMENITY'),
  iconKey: text('icon_key'),

  /** #9 — free requests must work at the base REQUEST tier with no prompt.
   *  A chargeable one is what trips escalation. */
  priceMinor: integer('price_minor').notNull().default(0),
  currency: currency(),
  isChargeable: boolean('is_chargeable').notNull().default(false),

  /** Drives the SLA sweep and the "usually 12 minutes" promise on the card. */
  slaMinutes: integer('sla_minutes').notNull().default(15),
  routeToRoleKey: text('route_to_role_key').notNull(),

  allowsQuantity: boolean('allows_quantity').notNull().default(false),
  maxQuantity: integer('max_quantity').notNull().default(1),
  allowsNote: boolean('allows_note').notNull().default(true),
  allowsPhoto: boolean('allows_photo').notNull().default(false),

  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('request_types_property_idx').on(t.propertyId, t.category, t.sortOrder)]);

export const serviceRequests = pgTable('service_requests', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  stayId: uuid('stay_id').notNull().references(() => stays.id),
  floorId: uuid('floor_id').notNull().references(() => floors.id),
  requestTypeId: uuid('request_type_id').references(() => requestTypes.id, { onDelete: 'set null' }),

  requestNumber: text('request_number').notNull(),
  status: serviceRequestStatus('status').notNull().default('OPEN'),

  guestNote: text('guest_note'),
  photoUrl: text('photo_url'),

  totalMinor: integer('total_minor').notNull().default(0),
  currency: currency(),

  /**
   * ESCALATED is deliberately NOT a status (DATA-MODEL §6). A request can be
   * both IN_PROGRESS and breached at the same time, and collapsing that into
   * one enum loses the fact that someone is actually working on it.
   */
  slaTargetAt: ts('sla_target_at'),
  escalatedAt: ts('escalated_at'),
  escalationLevel: integer('escalation_level').notNull().default(0),

  /** §7 — role ∩ on-shift ∩ covers-floor, ranked by open count. Nobody
   *  assigns this by hand. */
  assignedStaffId: uuid('assigned_staff_id').references(() => staffUsers.id),
  assignedAt: ts('assigned_at'),
  startedAt: ts('started_at'),
  completedAt: ts('completed_at'),
  verifiedAt: ts('verified_at'),

  rejectionReason: text('rejection_reason'),
  cancellationReason: text('cancellation_reason'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  // DATA-MODEL §9 — housekeeping board, and the runner's queue.
  index('service_requests_board_idx').on(t.propertyId, t.status, t.slaTargetAt),
  index('service_requests_assignee_idx').on(t.assignedStaffId, t.status),
  index('service_requests_stay_idx').on(t.stayId),
]);

export const serviceRequestItems = pgTable('service_request_items', {
  id: pk(),
  tenantId: tenantId(),
  serviceRequestId: uuid('service_request_id').notNull()
    .references(() => serviceRequests.id, { onDelete: 'cascade' }),

  /** Analytics only — #6, same rule as order lines. */
  requestTypeId: uuid('request_type_id').references(() => requestTypes.id, { onDelete: 'set null' }),

  labelSnapshot: text('label_snapshot').notNull(),
  unitPriceMinor: integer('unit_price_minor').notNull().default(0),
  currency: currency(),

  quantity: integer('quantity').notNull().default(1),
  lineTotalMinor: integer('line_total_minor').notNull().default(0),

  createdAt: createdAt(),
}, (t) => [index('service_request_items_request_idx').on(t.serviceRequestId)]);
