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

  const { publicCode } = await issueQrCode(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    roomId: created!.id,
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
  await revokeQrCodes(tx, input.roomId);

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

  const { publicCode } = await issueQrCode(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    roomId: input.roomId,
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

/* ── Room types ─────────────────────────────────────────────────────────── */

export interface RoomTypeInput {
  tenantId: string;
  propertyId: string;
  name: string;
  /** Short, uppercase, and what a rate sheet will key on. Unique per property. */
  code: string;
  maxOccupancy: number;
  staffUserId: string;
}

/**
 * A room type — what a room IS, never what it costs.
 *
 * EXTENSION-POINTS §1 calls this the single most expensive thing that could be
 * deferred: rates and inventory are priced per room type, so booking cannot
 * exist without the table, and adding it later means reconciling a varchar's
 * typos across live data. The table has existed since 0000 and only
 * `provisionProperty()` ever wrote to it — so a hotel that opened a new class of
 * room could not describe it, and `/admin/property` said so out loud rather than
 * pretending ("This property has no room types, so a room has nothing to be").
 *
 * #11 applies with full force. There is no price field here and there is nowhere
 * to put one: a price belongs to a rate plan for a type on a DATE, and a
 * `nightly_rate` added "just for the setup screen" would commit the model to
 * per-type flat pricing before the rate calendar exists to disagree.
 */
export async function createRoomType(
  tx: Tx,
  input: RoomTypeInput,
): Promise<{ id: string }> {
  const name = cleanName(input.name, 'room type');
  const code = cleanTypeCode(input.code);
  assertOccupancy(input.maxOccupancy);

  await assertTypeCodeFree(tx, { propertyId: input.propertyId, code });

  // After the existing ones, so a property that has always had three gets its
  // fourth at the bottom rather than jumbled into the middle of the list.
  const last = await tx.select({ sortOrder: roomTypes.sortOrder })
    .from(roomTypes)
    .where(eq(roomTypes.propertyId, input.propertyId))
    .orderBy(asc(roomTypes.sortOrder));

  const [created] = await tx.insert(roomTypes).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    name,
    code,
    maxOccupancy: input.maxOccupancy,
    sortOrder: (last.at(-1)?.sortOrder ?? -1) + 1,
  }).returning({ id: roomTypes.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'room_type',
    entityId: created!.id,
    eventType: 'room_type.created',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { name, code, maxOccupancy: input.maxOccupancy },
  });

  return created!;
}

export async function updateRoomType(
  tx: Tx,
  input: RoomTypeInput & { roomTypeId: string },
): Promise<void> {
  const name = cleanName(input.name, 'room type');
  const code = cleanTypeCode(input.code);
  assertOccupancy(input.maxOccupancy);

  const before = await tx.select({
    name: roomTypes.name,
    code: roomTypes.code,
    maxOccupancy: roomTypes.maxOccupancy,
    archivedAt: roomTypes.archivedAt,
  }).from(roomTypes)
    .where(and(eq(roomTypes.id, input.roomTypeId), eq(roomTypes.propertyId, input.propertyId)))
    .limit(1);

  const previous = before[0];
  if (!previous) throw new NotFoundError('No such room type at this property.');
  if (previous.archivedAt) {
    throw new ConflictError('This room type is retired. Bring it back before editing it.');
  }

  if (code !== previous.code) {
    await assertTypeCodeFree(tx, { propertyId: input.propertyId, code });
  }

  const next = { name, code, maxOccupancy: input.maxOccupancy };

  await tx.update(roomTypes)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(roomTypes.id, input.roomTypeId));

  const changed = Object.fromEntries(
    (Object.keys(next) as Array<keyof typeof next>)
      .filter((field) => previous[field] !== next[field])
      .map((field) => [field, { from: previous[field], to: next[field] }]),
  );
  if (!Object.keys(changed).length) return;

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'room_type',
    entityId: input.roomTypeId,
    eventType: 'room_type.updated',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { name, changed },
  });
}

/**
 * Retire a room type, and only one nothing is.
 *
 * `rooms.room_type_id` is NOT NULL, so a type with rooms on it cannot be deleted
 * and must not be archived either — `listRoomTypes()` stops offering an archived
 * type, so archiving one still in use would leave rooms pointing at something
 * the edit form cannot re-select, and the first person to touch an unrelated
 * field on that room would be told to pick a room type that is no longer there.
 *
 * Archived rather than deleted for the same reason as a room: a stay that
 * happened in a Jharokha suite is still the answer to what the guest booked, and
 * `describeRoom()` reads the name for the guest's own screen.
 */
export async function archiveRoomType(
  tx: Tx,
  input: { tenantId: string; propertyId: string; roomTypeId: string; staffUserId: string },
): Promise<void> {
  const found = await tx.select({ name: roomTypes.name, archivedAt: roomTypes.archivedAt })
    .from(roomTypes)
    .where(and(eq(roomTypes.id, input.roomTypeId), eq(roomTypes.propertyId, input.propertyId)))
    .limit(1);

  const type = found[0];
  if (!type) throw new NotFoundError('No such room type at this property.');
  if (type.archivedAt) throw new ConflictError(`${type.name} is already retired.`);

  // Archived rooms count: they still point here by FK, and restoring one has to
  // find its type still selectable.
  const held = await tx.select({ n: sql<number>`count(*)::int` })
    .from(rooms).where(eq(rooms.roomTypeId, input.roomTypeId));
  const count = Number(held[0]?.n ?? 0);

  if (count > 0) {
    throw new ConflictError(
      count === 1
        ? `One room is still a ${type.name}. Change it first.`
        : `${count} rooms are still a ${type.name}. Change them first.`,
    );
  }

  const now = new Date();
  await tx.update(roomTypes)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(roomTypes.id, input.roomTypeId), isNull(roomTypes.archivedAt)));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'room_type',
    entityId: input.roomTypeId,
    eventType: 'room_type.archived',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { name: type.name },
  });
}

export async function restoreRoomType(
  tx: Tx,
  input: { tenantId: string; propertyId: string; roomTypeId: string; staffUserId: string },
): Promise<void> {
  const found = await tx.select({ name: roomTypes.name, archivedAt: roomTypes.archivedAt })
    .from(roomTypes)
    .where(and(eq(roomTypes.id, input.roomTypeId), eq(roomTypes.propertyId, input.propertyId)))
    .limit(1);

  const type = found[0];
  if (!type) throw new NotFoundError('No such room type at this property.');
  if (!type.archivedAt) throw new ConflictError(`${type.name} is already in use.`);

  const now = new Date();
  await tx.update(roomTypes)
    .set({ archivedAt: null, updatedAt: now })
    .where(eq(roomTypes.id, input.roomTypeId));

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'room_type',
    entityId: input.roomTypeId,
    eventType: 'room_type.restored',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { name: type.name },
  });
}

/* ── The sticker ────────────────────────────────────────────────────────── */

/**
 * Reprint a room's QR sticker.
 *
 * `qr:regenerate` has been a declared permission since S5 with nothing calling
 * it, and `room_qr_codes.version` has carried the comment "reprinting a sticker
 * invalidates the old one" since 0000 — describing a thing no code did. A
 * sticker peels off, gets covered in chai, or is photographed by somebody who
 * is not a guest, and the only route back was a database write.
 *
 * ─── What a reprint does and does not break ────────────────────────────────
 *
 * It kills the OLD code immediately: `scanQrCode()` will not resolve it again,
 * so a photograph of the sticker taken in the lift is worthless from here on.
 * That is the whole point, and it is why this is its own permission rather than
 * part of `room:manage`.
 *
 * It does NOT sign the current guest out. Sessions bind to `stay_id`, never to
 * the room and never to the code (#10) — so the phone already on the nightstand
 * keeps working, and only a fresh scan needs the fresh sticker. A reprint that
 * logged the occupant out would make the desk afraid to use it, which is how a
 * compromised code stays live.
 */
export async function regenerateQrCode(
  tx: Tx,
  input: { tenantId: string; propertyId: string; roomId: string; staffUserId: string },
): Promise<{ publicCode: string; version: number }> {
  const found = await tx.select({ number: rooms.number, archivedAt: rooms.archivedAt })
    .from(rooms)
    .where(and(eq(rooms.id, input.roomId), eq(rooms.propertyId, input.propertyId)))
    .limit(1);

  const room = found[0];
  if (!room) throw new NotFoundError('No such room at this property.');
  // An out-of-service room's codes are already revoked, and minting a live one
  // for a room the desk cannot put anybody in would put a working sticker on a
  // door that should stay shut. Restoring is the way, and it issues one.
  if (room.archivedAt) {
    throw new ConflictError(
      `Room ${room.number} is out of service. Bring it back — that issues a new sticker.`,
    );
  }

  await revokeQrCodes(tx, input.roomId);
  const issued = await issueQrCode(tx, input);

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'room',
    entityId: input.roomId,
    eventType: 'qr.regenerated',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    // The version, never the code: `event_log` is readable by anything holding
    // `audit:read`, and a public code reaches the guest surface.
    payload: { number: room.number, version: issued.version },
  });

  return issued;
}

/**
 * Mint the live code for a room, at one past the highest version it has ever
 * had.
 *
 * `version` counts stickers printed, not stickers live, so it never goes
 * backwards: a room reprinted, archived and restored reads 1, 2, 3 and the
 * numbers on the audit trail line up with the numbers on the plastic. Deriving
 * it from `max(version)` rather than counting rows means a code deleted by hand
 * cannot make two stickers claim to be version 2.
 *
 * Callers revoke first where revoking is the point (`archiveRoom`,
 * `regenerateQrCode`); a brand-new room has nothing to revoke.
 */
async function issueQrCode(
  tx: Tx,
  input: { tenantId: string; propertyId: string; roomId: string },
): Promise<{ publicCode: string; version: number }> {
  const printed = await tx.select({ version: roomQrCodes.version })
    .from(roomQrCodes)
    .where(eq(roomQrCodes.roomId, input.roomId))
    .orderBy(asc(roomQrCodes.version));

  const publicCode = newPublicCode();
  const version = (printed.at(-1)?.version ?? 0) + 1;

  await tx.insert(roomQrCodes).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    roomId: input.roomId,
    publicCode,
    version,
  });

  return { publicCode, version };
}

/** Every live code for the room, so a reprint leaves exactly one. */
async function revokeQrCodes(tx: Tx, roomId: string): Promise<void> {
  await tx.update(roomQrCodes)
    .set({ revokedAt: new Date() })
    .where(and(eq(roomQrCodes.roomId, roomId), isNull(roomQrCodes.revokedAt)));
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

/**
 * A type code is what a rate sheet, a PMS export and a channel manager will key
 * on one day, so it is normalised HERE rather than left to whoever typed it:
 * "lkv", " LKV " and "Lkv" must not become three room types at the same hotel.
 */
function cleanTypeCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!code) throw new ValidationError('Give the room type a short code.');
  if (code.length > 12) throw new ValidationError('A room type code is 12 characters at most.');
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    throw new ValidationError('A room type code is letters, numbers, - and _ only.');
  }
  return code;
}

function assertOccupancy(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 20) {
    throw new ValidationError('Occupancy is a whole number between 1 and 20.');
  }
}

/**
 * Against archived types too: `room_types_property_code_uq` has no partial
 * predicate, so a retired LKV still holds LKV — the same trap as an archived
 * room holding its number, and worth the same sentence rather than a 23505.
 */
async function assertTypeCodeFree(
  tx: Tx,
  input: { propertyId: string; code: string },
): Promise<void> {
  const clash = await tx.select({ id: roomTypes.id, archivedAt: roomTypes.archivedAt })
    .from(roomTypes)
    .where(and(eq(roomTypes.propertyId, input.propertyId), eq(roomTypes.code, input.code)))
    .limit(1);

  if (!clash[0]) return;

  throw new ConflictError(
    clash[0].archivedAt
      ? `${input.code} belongs to a retired room type, which still holds the code. Bring that one back instead.`
      : `${input.code} is already in use here.`,
  );
}
