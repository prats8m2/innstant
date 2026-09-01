import { and, eq, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { shifts, shiftZones } from '@/db/schema/housekeeping';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

/**
 * Shifts and the floors they cover.
 *
 * These exist for one reason: routing (DATA-MODEL §7) is role ∩ ON SHIFT ∩
 * covers-this-floor, ranked by open count. Without a shift with zones on it the
 * middle two terms have no data behind them and every request falls back to
 * somebody noticing it on a board — which is precisely what P2's exit criterion
 * says must not happen.
 *
 * ─── Why clocking in is a shift rather than a flag on the user ──────────────
 *
 * A flag cannot answer "who was on the second floor at 9:40pm last Tuesday",
 * which is the question a disputed SLA breach turns into. The row is the record;
 * `clocked_out_at` closes it and nothing is deleted.
 */

export interface ShiftZone {
  floorId: string;
  floorName: string;
}

export interface StaffShift {
  id: string;
  staffUserId: string;
  status: 'SCHEDULED' | 'ON_DUTY' | 'ON_BREAK' | 'OFF_DUTY';
  clockedInAt: Date | null;
  zones: ShiftZone[];
}

/**
 * Clock in, covering these floors.
 *
 * Idempotent for the obvious reason: a housekeeper tapping twice on a phone with
 * one bar should not open two shifts, and two open shifts would double-count
 * them in the ranking. A second call with different floors UPDATES the zones —
 * "actually I have got three as well" is a normal thing to say mid-shift.
 */
export async function clockIn(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    staffUserId: string;
    floorIds: readonly string[];
  },
): Promise<StaffShift> {
  if (!input.floorIds.length) {
    // A shift covering nothing can never be routed to, so it is not a shift.
    throw new ValidationError('Choose at least one floor to cover.');
  }

  const existing = await currentShiftRow(tx, input);
  const now = new Date();

  const shiftId = existing?.id ?? (await tx.insert(shifts).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    staffUserId: input.staffUserId,
    status: 'ON_DUTY',
    // The scheduled window is what a rota would set. Clocking in without one is
    // the common case in a small hotel, so it is "now until end of day" rather
    // than a required input nobody has.
    scheduledStartAt: now,
    scheduledEndAt: endOfLocalDay(now),
    clockedInAt: now,
  }).returning({ id: shifts.id }))[0]!.id;

  if (existing) {
    await tx.update(shifts)
      .set({ status: 'ON_DUTY', clockedInAt: existing.clockedInAt ?? now, updatedAt: now })
      .where(eq(shifts.id, shiftId));
  }

  // Replace the zones: the form posts the full set of ticked floors, and a diff
  // would need the client to say what it thinks the previous set was.
  await tx.delete(shiftZones).where(eq(shiftZones.shiftId, shiftId));
  await tx.insert(shiftZones).values(input.floorIds.map((floorId) => ({
    tenantId: input.tenantId,
    shiftId,
    floorId,
  })));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'shift',
    entityId: shiftId,
    eventType: existing ? 'shift.zones_changed' : 'shift.clocked_in',
    toStatus: 'ON_DUTY',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { floors: input.floorIds.length },
  });

  const shift = await getCurrentShift(tx, input);
  if (!shift) throw new ConflictError('That shift could not be opened. Try again.');
  return shift;
}

/** Clock out. The row stays — it is the record of who was where. */
export async function clockOut(
  tx: Tx,
  input: { tenantId: string; propertyId: string; staffUserId: string },
): Promise<void> {
  const existing = await currentShiftRow(tx, input);
  if (!existing) throw new NotFoundError('You are not clocked in.');

  const now = new Date();
  await tx.update(shifts)
    .set({ status: 'OFF_DUTY', clockedOutAt: now, updatedAt: now })
    .where(eq(shifts.id, existing.id));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'shift',
    entityId: existing.id,
    eventType: 'shift.clocked_out',
    fromStatus: 'ON_DUTY',
    toStatus: 'OFF_DUTY',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
  });
}

async function currentShiftRow(
  tx: Tx,
  input: { propertyId: string; staffUserId: string },
): Promise<{ id: string; clockedInAt: Date | null } | null> {
  const rows = await tx.select({ id: shifts.id, clockedInAt: shifts.clockedInAt })
    .from(shifts)
    .where(and(
      eq(shifts.propertyId, input.propertyId),
      eq(shifts.staffUserId, input.staffUserId),
      eq(shifts.status, 'ON_DUTY'),
      isNull(shifts.clockedOutAt),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/** The shift this person is on right now, with the floors it covers. */
export async function getCurrentShift(
  tx: Tx,
  input: { propertyId: string; staffUserId: string },
): Promise<StaffShift | null> {
  /**
   * Raw SQL for the join onto `floors`, which belongs to identity (D-001). A
   * read-only projection inside the tenant-scoped transaction is the narrow
   * exception the other modules already take, and RLS still applies to every
   * row it touches.
   */
  const rows = await tx.execute<{
    id: string; staff_user_id: string; status: StaffShift['status'];
    clocked_in_at: Date | null; zones: unknown;
  }>(sql`
    SELECT s.id, s.staff_user_id, s.status, s.clocked_in_at,
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('floorId', f.id, 'floorName', f.name)
                          ORDER BY f.sort_order, f.level)
         FROM shift_zones z JOIN floors f ON f.id = z.floor_id
         WHERE z.shift_id = s.id),
        '[]'::jsonb) AS zones
    FROM shifts s
    WHERE s.property_id = ${input.propertyId}
      AND s.staff_user_id = ${input.staffUserId}
      AND s.status = 'ON_DUTY'
      AND s.clocked_out_at IS NULL
    LIMIT 1
  `);

  const row = rows.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    staffUserId: row.staff_user_id,
    status: row.status,
    clockedInAt: row.clocked_in_at ? new Date(row.clocked_in_at) : null,
    zones: (row.zones as ShiftZone[]) ?? [],
  };
}

export interface OnDutyStaff {
  staffUserId: string;
  fullName: string;
  /** Role keys held AT THIS PROPERTY — routing matches on one of these. */
  roleKeys: string[];
  clockedInAt: Date | null;
}

/**
 * Who is on duty right now and covers this floor.
 *
 * The "∩ on-shift ∩ covers floor" half of the routing rule. The role filter and
 * the ranking live in `requests`, which owns the request rows the ranking counts
 * — this function answers only what shifts know.
 */
export async function onDutyCovering(
  tx: Tx,
  input: { propertyId: string; floorId: string },
): Promise<OnDutyStaff[]> {
  const rows = await tx.execute<{
    staff_user_id: string; full_name: string; clocked_in_at: Date | null; role_keys: unknown;
  }>(sql`
    SELECT
      s.staff_user_id, su.full_name, s.clocked_in_at,
      COALESCE(
        (SELECT jsonb_agg(DISTINCT r.key)
         FROM staff_property_roles spr
         JOIN roles r ON r.id = spr.role_id
         WHERE spr.staff_user_id = s.staff_user_id
           AND spr.property_id = s.property_id),
        '[]'::jsonb) AS role_keys
    FROM shifts s
    JOIN shift_zones z ON z.shift_id = s.id
    JOIN staff_users su ON su.id = s.staff_user_id
    WHERE s.property_id = ${input.propertyId}
      AND s.status = 'ON_DUTY'
      AND s.clocked_out_at IS NULL
      AND z.floor_id = ${input.floorId}
      AND su.status = 'ACTIVE'
    ORDER BY s.clocked_in_at ASC NULLS LAST
  `);

  return rows.rows.map((row) => ({
    staffUserId: row.staff_user_id,
    fullName: row.full_name,
    roleKeys: Array.isArray(row.role_keys) ? (row.role_keys as string[]) : [],
    clockedInAt: row.clocked_in_at ? new Date(row.clocked_in_at) : null,
  }));
}

/** Everyone on duty at the property, for a board header. */
export async function onDutyCount(tx: Tx, propertyId: string): Promise<number> {
  const rows = await tx.select({ n: sql<number>`count(*)::int` }).from(shifts)
    .where(and(
      eq(shifts.propertyId, propertyId),
      eq(shifts.status, 'ON_DUTY'),
      isNull(shifts.clockedOutAt),
    ));
  return rows[0]?.n ?? 0;
}

/**
 * End of the day the instant falls in, in UTC.
 *
 * Deliberately not property-local: `scheduled_end_at` is a placeholder for a
 * rota nobody has entered, and pretending it is a considered local boundary
 * would be worse than it being obviously approximate. When a rota exists it sets
 * this properly, in the property's timezone.
 */
function endOfLocalDay(now: Date): Date {
  const end = new Date(now);
  end.setUTCHours(23, 59, 0, 0);
  return end > now ? end : new Date(now.getTime() + 8 * 60 * 60 * 1000);
}
