import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db';
import { rooms } from '@/db/schema/identity';

/**
 * Room lookups, for the modules that reference a room but do not own it.
 *
 * `identity` owns tenancy — tenants, properties, floors, rooms, QR codes — so
 * this is where a room is read from. `stay` needs to know a room number and
 * that the room is at the property before it will create a stay there, and the
 * boundary rule (D-001) is what stops it reaching for the table directly.
 */
export interface RoomRef {
  id: string;
  number: string;
  floorId: string;
}

/**
 * Scoped by property as well as id. RLS confines this to the tenant; the
 * property check confines it to the hotel, so a room id from a sister property
 * is indistinguishable from a typo — which is the same reasoning as
 * NotFoundError over ForbiddenError in src/lib/errors.ts.
 */
export async function findRoomAtProperty(
  tx: Tx,
  input: { propertyId: string; roomId: string },
): Promise<RoomRef | null> {
  const rows = await tx
    .select({ id: rooms.id, number: rooms.number, floorId: rooms.floorId })
    .from(rooms)
    .where(and(eq(rooms.id, input.roomId), eq(rooms.propertyId, input.propertyId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findRoomByNumber(
  tx: Tx,
  input: { propertyId: string; number: string },
): Promise<RoomRef | null> {
  const rows = await tx
    .select({ id: rooms.id, number: rooms.number, floorId: rooms.floorId })
    .from(rooms)
    .where(and(eq(rooms.propertyId, input.propertyId), eq(rooms.number, input.number)))
    .limit(1);
  return rows[0] ?? null;
}
