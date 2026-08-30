import { pgTable, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { pk, ts, createdAt, updatedAt, tenantId, propertyId, shiftStatus } from './_shared';
import { floors, staffUsers } from './identity';

/**
 * Shifts and zones. These exist so routing (DATA-MODEL §7) can be automatic:
 * a request goes to the intersection of role, on-shift, and covers-this-floor,
 * ranked by open count. Without shift_zones the "∩ covers floor" term has no
 * data behind it and requests fall back to manual assignment — which is the
 * thing P2's exit criterion says must not happen.
 */
export const shifts = pgTable('shifts', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  staffUserId: uuid('staff_user_id').notNull().references(() => staffUsers.id, { onDelete: 'cascade' }),

  status: shiftStatus('status').notNull().default('SCHEDULED'),
  scheduledStartAt: ts('scheduled_start_at').notNull(),
  scheduledEndAt: ts('scheduled_end_at').notNull(),
  clockedInAt: ts('clocked_in_at'),
  clockedOutAt: ts('clocked_out_at'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('shifts_property_status_idx').on(t.propertyId, t.status),
  index('shifts_staff_idx').on(t.staffUserId, t.scheduledStartAt),
]);

export const shiftZones = pgTable('shift_zones', {
  id: pk(),
  tenantId: tenantId(),
  shiftId: uuid('shift_id').notNull().references(() => shifts.id, { onDelete: 'cascade' }),
  floorId: uuid('floor_id').notNull().references(() => floors.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('shift_zones_uq').on(t.shiftId, t.floorId)]);
