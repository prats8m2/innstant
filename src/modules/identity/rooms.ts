import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Tx } from '@/db';
import { floors, properties, rooms, roomTypes } from '@/db/schema/identity';

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

/**
 * How a room is described to the guest whose room it is — "214, lake view".
 *
 * Separate from `findRoomAtProperty()` rather than a wider `RoomRef`: the room
 * type is a join, every other caller of that function wants routing ids only,
 * and paying for a join on the kitchen ticket to satisfy one line on the stay
 * screen is the wrong trade.
 *
 * The name comes from `room_types`, which is where a property already writes
 * "Lake view" and "Jharokha suite" — the reference's "Room 214, lake side" made
 * up a descriptor, and inventing one here would mean a second place to keep it
 * true.
 */
export interface RoomDescription {
  number: string;
  roomTypeName: string | null;
}

export async function describeRoom(
  tx: Tx,
  input: { propertyId: string; roomId: string },
): Promise<RoomDescription | null> {
  const rows = await tx
    .select({ number: rooms.number, roomTypeName: roomTypes.name })
    .from(rooms)
    .leftJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
    .where(and(eq(rooms.id, input.roomId), eq(rooms.propertyId, input.propertyId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Every room at the property, for a screen that lists them.
 *
 * With the floor and the room type resolved, because a front desk reads "214 ·
 * Second · Lake view" and not three uuids. Archived rooms are excluded: a room
 * taken out of service is not one the desk can put anybody in.
 *
 * Ordered by floor then number, which is how a key rack is ordered and how
 * somebody standing at a desk expects to scan a list.
 */
export interface RoomListing {
  id: string;
  number: string;
  floorId: string;
  floorName: string;
  roomTypeName: string | null;
}

export async function listRoomsAtProperty(
  tx: Tx,
  input: { propertyId: string },
): Promise<RoomListing[]> {
  return tx
    .select({
      id: rooms.id,
      number: rooms.number,
      floorId: rooms.floorId,
      floorName: floors.name,
      roomTypeName: roomTypes.name,
    })
    .from(rooms)
    .innerJoin(floors, eq(floors.id, rooms.floorId))
    .leftJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
    .where(and(eq(rooms.propertyId, input.propertyId), isNull(rooms.archivedAt)))
    .orderBy(asc(floors.sortOrder), asc(floors.level), asc(rooms.number));
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

/**
 * The property's own settings, for the screens that render a time or an amount.
 *
 * `timezone` is the one that matters: anything a human sees is rendered in the
 * PROPERTY's timezone, never the server's (CLAUDE.md "Dates"). A guest in
 * Udaipur reading "by 3:26 am" because the box is in another region is a bug
 * that only shows up once the app is deployed somewhere real.
 */
export interface PropertySettings {
  id: string;
  name: string;
  timezone: string;
  currency: string;
}

export async function findProperty(
  tx: Tx,
  propertyId: string,
): Promise<PropertySettings | null> {
  const rows = await tx
    .select({
      id: properties.id,
      name: properties.name,
      timezone: properties.timezone,
      currency: properties.currency,
    })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return rows[0] ?? null;
}

export interface FloorRef {
  id: string;
  name: string;
  level: number;
}

/**
 * The property's floors, in the order a person thinks of them.
 *
 * `identity` owns floors (D-001), so the shift picker and anything else that
 * needs to offer them comes through here rather than reaching for the table.
 */
export async function listFloors(tx: Tx, propertyId: string): Promise<FloorRef[]> {
  return tx.select({ id: floors.id, name: floors.name, level: floors.level })
    .from(floors)
    .where(eq(floors.propertyId, propertyId))
    .orderBy(asc(floors.sortOrder), asc(floors.level));
}
