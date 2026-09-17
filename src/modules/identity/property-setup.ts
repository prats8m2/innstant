import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { floors, rooms, roomTypes, roomQrCodes } from '@/db/schema/identity';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { newPublicCode } from './provision';

/**
 * The building: floors and the rooms on them.
 *
 * P3.5. `provisionProperty()` has created these in one transaction since P0 and
 * was the only thing that ever did — so a hotel that opened a floor, or
 * renumbered a wing, had a seeder run and a wiped property as its only route.
 * `room:manage` has been a declared permission with no caller since S5.
 *
 * Reads live in `rooms.ts`; this is the writing half, the same split
 * `modules/catalog` makes between its menu reader and `admin.ts`.
 */

/* ── Floors ─────────────────────────────────────────────────────────────── */

export interface FloorInput {
  tenantId: string;
  propertyId: string;
  name: string;
  /** The storey. Unique per property, and what rooms are grouped by. */
  level: number;
  sortOrder?: number;
  staffUserId: string;
}

export async function createFloor(
  tx: Tx,
  input: FloorInput,
): Promise<{ id: string }> {
  const name = cleanName(input.name, 'floor');
  assertLevel(input.level);

  const clash = await tx.select({ id: floors.id }).from(floors)
    .where(and(eq(floors.propertyId, input.propertyId), eq(floors.level, input.level)))
    .limit(1);
  // The unique index is the backstop; this turns its 23505 into a sentence
  // somebody can act on — the same thing `createStay()` does for D-007.
  if (clash[0]) {
    throw new ConflictError(`There is already a floor at level ${input.level}.`);
  }

  const [created] = await tx.insert(floors).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    name,
    level: input.level,
    sortOrder: input.sortOrder ?? input.level,
  }).returning({ id: floors.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'floor',
    entityId: created!.id,
    eventType: 'floor.created',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { name, level: input.level },
  });

  return created!;
}

export async function renameFloor(
  tx: Tx,
  input: { tenantId: string; propertyId: string; floorId: string; name: string; staffUserId: string },
): Promise<void> {
  const name = cleanName(input.name, 'floor');

  const updated = await tx.update(floors)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(floors.id, input.floorId), eq(floors.propertyId, input.propertyId)))
    .returning({ id: floors.id, level: floors.level });

  if (!updated[0]) throw new NotFoundError('No such floor at this property.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'floor',
    entityId: input.floorId,
    eventType: 'floor.renamed',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { name },
  });
}

/**
 * Delete a floor, and only an empty one.
 *
 * A hard delete rather than an archive, because `floors` has no `archived_at`
 * and an empty floor has no history to keep: nothing references it, no stay ever
 * happened on it, and `shift_zones` covers floors that have rooms. A floor with
 * rooms is refused — including ARCHIVED rooms, which still point at it by FK,
 * and whose old stays are still the answer to "where was this guest".
 */
export async function deleteFloor(
  tx: Tx,
  input: { tenantId: string; propertyId: string; floorId: string; staffUserId: string },
): Promise<void> {
  const found = await tx.select({ name: floors.name, level: floors.level })
    .from(floors)
    .where(and(eq(floors.id, input.floorId), eq(floors.propertyId, input.propertyId)))
    .limit(1);

  const floor = found[0];
  if (!floor) throw new NotFoundError('No such floor at this property.');

  const held = await tx.select({ n: sql<number>`count(*)::int` })
    .from(rooms).where(eq(rooms.floorId, input.floorId));
  const count = Number(held[0]?.n ?? 0);

  if (count > 0) {
    throw new ConflictError(
      count === 1
        ? 'One room is still on this floor. Move or remove it first.'
        : `${count} rooms are still on this floor. Move or remove them first.`,
    );
  }

  await tx.delete(floors).where(eq(floors.id, input.floorId));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'floor',
    entityId: input.floorId,
    eventType: 'floor.deleted',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { name: floor.name, level: floor.level },
  });
}

/* ── Rooms ──────────────────────────────────────────────────────────────── */

export interface RoomInput {
  tenantId: string;
  propertyId: string;
  floorId: string;
  roomTypeId: string;
  number: string;
  notes?: string | null;
  staffUserId: string;
}

export interface CreatedRoom {
  id: string;
  number: string;
  /** Minted here. A room without one is a room no sticker reaches. */
  publicCode: string;
}

/**
 * A new room, with its QR code.
 *
 * The QR is not optional and not a second step. `provisionProperty()` mints one
 * per room in the same transaction, and a room created without one is invisible
 * to the entire guest surface — there is no screen that would tell you, because
 * every screen assumes the code exists.
 */
export async function createRoom(
  tx: Tx,
  input: RoomInput,
): Promise<CreatedRoom> {
  const number = cleanRoomNumber(input.number);
  await assertFloorAndType(tx, input);

  /**
   * Against every room INCLUDING archived ones: `rooms_property_number_uq` has
   * no partial predicate, so an archived 214 still holds the number. Saying so
   * here is better than a 23505, and better than silently letting somebody
   * think they can reuse it.
   */
  const clash = await tx.select({ id: rooms.id, archivedAt: rooms.archivedAt })
    .from(rooms)
    .where(and(eq(rooms.propertyId, input.propertyId), eq(rooms.number, number)))
    .limit(1);

  if (clash[0]) {
    throw new ConflictError(
      clash[0].archivedAt
        ? `Room ${number} was removed rather than deleted, and still holds its number. Restore it instead.`
        : `Room ${number} already exists.`,
    );
  }

  const [created] = await tx.insert(rooms).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    floorId: input.floorId,
    roomTypeId: input.roomTypeId,
    number,
    notes: input.notes?.trim() || null,
  }).returning({ id: rooms.id });

  const publicCode = newPublicCode();
  await tx.insert(roomQrCodes).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    roomId: created!.id,
    publicCode,
    version: 1,
  });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'room',
    entityId: created!.id,
    eventType: 'room.created',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    // The code itself is deliberately NOT logged: `event_log` is readable by
    // anything with `audit:read`, and a public code reaches the guest surface.
    payload: { number, floorId: input.floorId },
  });

  return { id: created!.id, number, publicCode };
}

export async function updateRoom(
  tx: Tx,
  input: RoomInput & { roomId: string },
): Promise<void> {
  const number = cleanRoomNumber(input.number);
  await assertFloorAndType(tx, input);

  const before = await tx.select({
    number: rooms.number,
    floorId: rooms.floorId,
    roomTypeId: rooms.roomTypeId,
    notes: rooms.notes,
    archivedAt: rooms.archivedAt,
  }).from(rooms)
    .where(and(eq(rooms.id, input.roomId), eq(rooms.propertyId, input.propertyId)))
    .limit(1);

  const previous = before[0];
  if (!previous) throw new NotFoundError('No such room at this property.');
  if (previous.archivedAt) {
    throw new ConflictError('This room has been removed. Restore it before editing it.');
  }

  if (number !== previous.number) {
    const clash = await tx.select({ id: rooms.id }).from(rooms)
      .where(and(eq(rooms.propertyId, input.propertyId), eq(rooms.number, number)))
      .limit(1);
    if (clash[0]) throw new ConflictError(`Room ${number} already exists.`);
  }

  const next = {
    number,
    floorId: input.floorId,
    roomTypeId: input.roomTypeId,
    notes: input.notes?.trim() || null,
  };

  await tx.update(rooms)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(rooms.id, input.roomId));

  const changed = Object.fromEntries(
    (Object.keys(next) as Array<keyof typeof next>)
      .filter((field) => previous[field] !== next[field])
      .map((field) => [field, { from: previous[field], to: next[field] }]),
  );
  if (!Object.keys(changed).length) return;

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'room',
    entityId: input.roomId,
    eventType: 'room.updated',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { number, changed },
  });
}

/**
 * Take a room out of service.
 *
 * Archived, never deleted (D-008's reasoning): every stay that ever happened in
 * it points here by FK, and a guest disputing a charge from March needs the room
 * to still resolve.
 *
 * Refused while somebody is in it. The stay check is raw SQL across a table this
 * module does not own — the same narrow read-only projection the floor board and
 * the desk's checkout queue already take (D-001) — because the guard has to be
 * in the SAME transaction as the write. Splitting it into the caller leaves a
 * window where a guest checks in between the check and the archive, and the
 * first anybody hears of it is a guest whose QR stops working.
 */
export async function archiveRoom(
  tx: Tx,
  input: { tenantId: string; propertyId: string; roomId: string; staffUserId: string },
): Promise<void> {
  const found = await tx.select({ number: rooms.number, archivedAt: rooms.archivedAt })
    .from(rooms)
    .where(and(eq(rooms.id, input.roomId), eq(rooms.propertyId, input.propertyId)))
    .limit(1);

  const room = found[0];
  if (!room) throw new NotFoundError('No such room at this property.');
  if (room.archivedAt) throw new ConflictError(`Room ${room.number} is already removed.`);

  const occupied = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM stays
    WHERE room_id = ${input.roomId} AND status = 'CHECKED_IN'
  `);
  if (Number(occupied.rows[0]?.n ?? 0) > 0) {
    throw new ConflictError(
      `Somebody is still in room ${room.number}. Check them out first.`,
    );
  }

  const now = new Date();
  await tx.update(rooms)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(rooms.id, input.roomId), isNull(rooms.archivedAt)));

  /**
   * And the sticker stops working. `scanQrCode()` resolves a code to a room and
   * then to an active stay; leaving the code live on a room out of service means
   * a sticker in a corridor that resolves to a real property for ever.
   */
  await tx.update(roomQrCodes)
    .set({ revokedAt: now })
    .where(and(eq(roomQrCodes.roomId, input.roomId), isNull(roomQrCodes.revokedAt)));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'room',
    entityId: input.roomId,
    eventType: 'room.archived',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { number: room.number },
  });
}

/**
 * Back into service, with a NEW code.
 *
 * Not the old one: it was revoked when the room was archived, and anything
 * printed from it has been out of a guest's hands for however long the room was
 * shut. A restored room gets a fresh sticker, which is the honest state — the
 * alternative is a code that was dead on Tuesday and live on Thursday.
 */
export async function restoreRoom(
  tx: Tx,
  input: { tenantId: string; propertyId: string; roomId: string; staffUserId: string },
): Promise<{ publicCode: string }> {
  const found = await tx.select({ number: rooms.number, archivedAt: rooms.archivedAt })
    .from(rooms)
    .where(and(eq(rooms.id, input.roomId), eq(rooms.propertyId, input.propertyId)))
    .limit(1);

  const room = found[0];
  if (!room) throw new NotFoundError('No such room at this property.');
  if (!room.archivedAt) throw new ConflictError(`Room ${room.number} is already in service.`);

  const now = new Date();
  await tx.update(rooms)
    .set({ archivedAt: null, updatedAt: now })
    .where(eq(rooms.id, input.roomId));

  const live = await tx.select({ version: roomQrCodes.version })
    .from(roomQrCodes)
    .where(eq(roomQrCodes.roomId, input.roomId))
    .orderBy(asc(roomQrCodes.version));

  const publicCode = newPublicCode();
  await tx.insert(roomQrCodes).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    roomId: input.roomId,
    publicCode,
    version: (live.at(-1)?.version ?? 0) + 1,
  });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'room',
    entityId: input.roomId,
    eventType: 'room.restored',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { number: room.number },
  });

  return { publicCode };
}

/* ── Shared ─────────────────────────────────────────────────────────────── */

function cleanName(value: string, what: string): string {
  const name = value.trim();
  if (!name) throw new ValidationError(`Give the ${what} a name.`);
  if (name.length > 80) throw new ValidationError(`That ${what} name is too long.`);
  return name;
}

/**
 * A room number is a label, not a number: "004", "2A" and "Cottage 3" are all
 * real, and parsing it as an integer would lose the leading zero the key rack
 * has on it.
 */
function cleanRoomNumber(value: string): string {
  const number = value.trim();
  if (!number) throw new ValidationError('Give the room a number.');
  if (number.length > 16) throw new ValidationError('That room number is too long.');
  return number;
}

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < -5 || level > 200) {
    throw new ValidationError('A floor level is a whole number between -5 and 200.');
  }
}

/** Both have to be this property's, or a room lands on another hotel's floor. */
async function assertFloorAndType(
  tx: Tx,
  input: { propertyId: string; floorId: string; roomTypeId: string },
): Promise<void> {
  const floor = await tx.select({ id: floors.id }).from(floors)
    .where(and(eq(floors.id, input.floorId), eq(floors.propertyId, input.propertyId)))
    .limit(1);
  if (!floor[0]) throw new ValidationError('Pick a floor at this property.');

  const type = await tx.select({ id: roomTypes.id }).from(roomTypes)
    .where(and(
      eq(roomTypes.id, input.roomTypeId),
      eq(roomTypes.propertyId, input.propertyId),
      isNull(roomTypes.archivedAt),
    ))
    .limit(1);
  if (!type[0]) throw new ValidationError('Pick a room type at this property.');
}
