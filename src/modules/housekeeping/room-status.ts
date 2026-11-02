import { eq } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { roomStatus } from '@/db/schema/housekeeping';
import { findRoomAtProperty } from '@/modules/identity';
import { NotFoundError, ValidationError } from '@/lib/errors';

/**
 * Is an empty room ready for the next guest (D-096).
 *
 * The housekeeping half of a room's state, beside occupancy: CLEAN, DIRTY
 * (set by checkout), INSPECTED (a supervisor's second look), OUT_OF_ORDER
 * (with a reason). A room with no row is CLEAN. Every change writes a
 * `room.status_changed` event with the before and after (#7).
 */
export const ROOM_CLEAN_STATUSES = ['CLEAN', 'DIRTY', 'INSPECTED', 'OUT_OF_ORDER'] as const;
export type RoomCleanStatus = (typeof ROOM_CLEAN_STATUSES)[number];

export interface RoomCleanState {
  status: RoomCleanStatus;
  note: string | null;
  updatedAt: Date | null;
}

const CLEAN: RoomCleanState = { status: 'CLEAN', note: null, updatedAt: null };

/** Every room's state at the property; a room missing from the map is CLEAN. */
export async function roomCleanStates(
  tx: Tx,
  input: { propertyId: string },
): Promise<Map<string, RoomCleanState>> {
  const rows = await tx.select({
    roomId: roomStatus.roomId, status: roomStatus.status, note: roomStatus.note, updatedAt: roomStatus.updatedAt,
  }).from(roomStatus).where(eq(roomStatus.propertyId, input.propertyId));
  return new Map(rows.map((r) => [r.roomId, { status: r.status, note: r.note, updatedAt: r.updatedAt }]));
}

export function cleanStateOf(states: ReadonlyMap<string, RoomCleanState>, roomId: string): RoomCleanState {
  return states.get(roomId) ?? CLEAN;
}

export async function setRoomCleanStatus(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    roomId: string;
    status: RoomCleanStatus;
    /** Required for OUT_OF_ORDER — what is wrong with it. */
    note?: string | null;
    /** Null when the system does it (checkout's DIRTY is the desk's act, though). */
    staffUserId: string | null;
  },
): Promise<{ from: RoomCleanStatus; to: RoomCleanStatus; roomNumber: string }> {
  if (!ROOM_CLEAN_STATUSES.includes(input.status)) throw new ValidationError('That is not a room state.');
  const note = input.note?.trim() || null;
  if (input.status === 'OUT_OF_ORDER' && !note) {
    throw new ValidationError('Say what is wrong with the room.');
  }

  const room = await findRoomAtProperty(tx, { propertyId: input.propertyId, roomId: input.roomId });
  if (!room) throw new NotFoundError('That room is not at this property.');

  const [before] = await tx.select({ status: roomStatus.status }).from(roomStatus)
    .where(eq(roomStatus.roomId, input.roomId)).limit(1);
  const from = (before?.status ?? 'CLEAN') as RoomCleanStatus;
  const now = new Date();

  await tx.insert(roomStatus).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    roomId: input.roomId,
    status: input.status,
    note: input.status === 'OUT_OF_ORDER' ? note : null,
    updatedByStaffId: input.staffUserId,
  }).onConflictDoUpdate({
    target: roomStatus.roomId,
    set: {
      status: input.status,
      note: input.status === 'OUT_OF_ORDER' ? note : null,
      updatedByStaffId: input.staffUserId,
      updatedAt: now,
    },
  });

  // The same state twice is not a change, and the log is for changes.
  if (from !== input.status) {
    await recordEvent(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      entityType: 'room',
      entityId: input.roomId,
      eventType: 'room.status_changed',
      fromStatus: from,
      toStatus: input.status,
      actor: input.staffUserId ? { kind: 'STAFF', staffUserId: input.staffUserId } : { kind: 'SYSTEM' },
      payload: { roomNumber: room.number, ...(note && input.status === 'OUT_OF_ORDER' ? { note } : {}) },
    });
  }

  return { from, to: input.status, roomNumber: room.number };
}
