import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import {
  tenants, properties, floors, rooms, roomTypes, roomQrCodes,
  staffUsers, staffPropertyRoles,
} from '@/db/schema/identity';
import { createDefaultAccessPolicy } from '@/modules/access';
import { seedDefaultRequestTypes } from '@/modules/requests';
import { createOutlet } from '@/modules/catalog';
import { seedSystemRoles } from './seed-roles';

/**
 * Onboarding a hotel is ONE transaction (DATA-MODEL §10). Half a property is
 * worse than none: rooms with no QR codes, or an outlet with no access policy,
 * is a property that looks provisioned and fails at the first scan.
 *
 * Note what this file does NOT do: it never touches another module's tables.
 * Outlets go through `createOutlet`, request types through
 * `seedDefaultRequestTypes`, the access policy through
 * `createDefaultAccessPolicy` — each taking THIS transaction so the whole thing
 * still commits or rolls back as one unit (D-001, and #1 unbroken).
 *
 * This is also the integration-test fixture and the demo-data generator, which
 * is why it takes an override object: a test that builds its own rows is a test
 * of rows nobody provisions.
 */
export interface RoomSeed {
  number: string;
  floorLevel: number;
  roomTypeCode: string;
}

export interface RoomTypeSeed {
  code: string;
  name: string;
  maxOccupancy?: number;
}

export interface FloorSeed {
  level: number;
  name: string;
}

export interface ProvisionPropertyInput {
  tenantId: string;
  name: string;
  slug: string;
  timezone?: string;
  currency?: string;
  city?: string;
  branding?: Record<string, unknown>;

  roomTypes: readonly RoomTypeSeed[];
  floors: readonly FloorSeed[];
  rooms: readonly RoomSeed[];

  outletName?: string;
  /** Email for the first PROPERTY_ADMIN. Created as INVITED with no password —
   *  S5 has no invite flow yet, so the seeder sets a password directly. */
  adminEmail: string;
  adminName?: string;
}

export interface ProvisionedProperty {
  propertyId: string;
  outletId: string;
  accessPolicyId: string;
  adminStaffUserId: string;
  roomIds: Map<string, string>;
  qrCodes: Map<string, string>;
  requestTypeCount: number;
}

/** Public QR codes are short, unambiguous, and not sequential — a sequential
 *  code invites walking the range from a corridor. Exported so a room added
 *  after provisioning mints one the same way (P3.5) — two generators would be
 *  two answers to "how guessable is a sticker". */
export function newPublicCode(): string {
  return randomBytes(9).toString('base64url');
}

export async function provisionTenant(
  tx: Tx, input: { id?: string; name: string; slug: string },
): Promise<string> {
  const existing = await tx.select({ id: tenants.id })
    .from(tenants).where(eq(tenants.slug, input.slug)).limit(1);
  if (existing[0]) return existing[0].id;

  const [row] = await tx.insert(tenants).values({
    ...(input.id ? { id: input.id } : {}),
    name: input.name,
    slug: input.slug,
    status: 'ACTIVE',
  }).returning({ id: tenants.id });
  return row!.id;
}

export async function provisionProperty(
  tx: Tx, input: ProvisionPropertyInput,
): Promise<ProvisionedProperty> {
  const currency = input.currency ?? 'INR';

  // 1. Property
  const existingProperty = await tx.select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.tenantId, input.tenantId), eq(properties.slug, input.slug)))
    .limit(1);

  const propertyId = existingProperty[0]?.id ?? (
    await tx.insert(properties).values({
      tenantId: input.tenantId,
      name: input.name,
      slug: input.slug,
      timezone: input.timezone ?? 'Asia/Kolkata',
      currency,
      city: input.city ?? null,
      branding: input.branding ?? {},
    }).returning({ id: properties.id })
  )[0]!.id;

  // 2. The 8 system roles (convergent — safe to re-run)
  const roleIds = await seedSystemRoles(tx, input.tenantId);

  // 3. Room types
  const roomTypeIds = new Map<string, string>();
  for (const [i, rt] of input.roomTypes.entries()) {
    const found = await tx.select({ id: roomTypes.id }).from(roomTypes)
      .where(and(eq(roomTypes.propertyId, propertyId), eq(roomTypes.code, rt.code))).limit(1);
    roomTypeIds.set(rt.code, found[0]?.id ?? (
      await tx.insert(roomTypes).values({
        tenantId: input.tenantId, propertyId, code: rt.code, name: rt.name,
        maxOccupancy: rt.maxOccupancy ?? 2, sortOrder: i,
      }).returning({ id: roomTypes.id })
    )[0]!.id);
  }

  // 4. Floors
  const floorIds = new Map<number, string>();
  for (const [i, f] of input.floors.entries()) {
    const found = await tx.select({ id: floors.id }).from(floors)
      .where(and(eq(floors.propertyId, propertyId), eq(floors.level, f.level))).limit(1);
    floorIds.set(f.level, found[0]?.id ?? (
      await tx.insert(floors).values({
        tenantId: input.tenantId, propertyId, name: f.name, level: f.level, sortOrder: i,
      }).returning({ id: floors.id })
    )[0]!.id);
  }

  // 5. Rooms + one QR code each, at version 1
  //
  // Batched deliberately. Per-room round trips made this O(rooms) network
  // calls: 34 rooms took ~2 minutes from a laptop, and a 200-room property
  // would take fifteen. Onboarding is a sales moment; it cannot feel broken.
  const existingRooms = await tx
    .select({ id: rooms.id, number: rooms.number })
    .from(rooms)
    .where(eq(rooms.propertyId, propertyId));
  const roomIds = new Map(existingRooms.map((r) => [r.number, r.id]));

  const newRooms = input.rooms.filter((r) => !roomIds.has(r.number));
  for (const r of newRooms) {
    if (!floorIds.has(r.floorLevel)) {
      throw new Error(`Room ${r.number} references unknown floor ${r.floorLevel}`);
    }
    if (!roomTypeIds.has(r.roomTypeCode)) {
      throw new Error(`Room ${r.number} references unknown room type ${r.roomTypeCode}`);
    }
  }
  if (newRooms.length) {
    const created = await tx.insert(rooms).values(newRooms.map((r) => ({
      tenantId: input.tenantId,
      propertyId,
      floorId: floorIds.get(r.floorLevel)!,
      roomTypeId: roomTypeIds.get(r.roomTypeCode)!,
      number: r.number,
    }))).returning({ id: rooms.id, number: rooms.number });
    for (const r of created) roomIds.set(r.number, r.id);
  }

  const existingQrs = await tx
    .select({ roomId: roomQrCodes.roomId, publicCode: roomQrCodes.publicCode })
    .from(roomQrCodes)
    .where(eq(roomQrCodes.propertyId, propertyId));
  const qrByRoomId = new Map(existingQrs.map((q) => [q.roomId, q.publicCode]));

  const qrToCreate = input.rooms
    .map((r) => ({ number: r.number, roomId: roomIds.get(r.number)! }))
    .filter((r) => !qrByRoomId.has(r.roomId))
    .map((r) => ({ ...r, publicCode: newPublicCode() }));
  if (qrToCreate.length) {
    await tx.insert(roomQrCodes).values(qrToCreate.map((q) => ({
      tenantId: input.tenantId, propertyId, roomId: q.roomId,
      publicCode: q.publicCode, version: 1,
    })));
    for (const q of qrToCreate) qrByRoomId.set(q.roomId, q.publicCode);
  }

  const qrCodes = new Map<string, string>();
  for (const r of input.rooms) {
    qrCodes.set(r.number, qrByRoomId.get(roomIds.get(r.number)!)!);
  }

  // 6. In-room dining outlet — another module's table, via its service
  const outletId = await createOutlet(tx, {
    tenantId: input.tenantId, propertyId, kind: 'IN_ROOM_DINING',
    name: input.outletName ?? 'In-room dining', currency,
  });

  // 7. ~20 request types
  const requestTypeCount = await seedDefaultRequestTypes(tx, {
    tenantId: input.tenantId, propertyId, currency,
  });

  // 8. Default access policy — D-012 defaults, no verification on scan
  const accessPolicyId = await createDefaultAccessPolicy(tx, {
    tenantId: input.tenantId, propertyId,
  });

  // 9. First PROPERTY_ADMIN
  const existingAdmin = await tx.select({ id: staffUsers.id }).from(staffUsers)
    .where(and(eq(staffUsers.tenantId, input.tenantId), eq(staffUsers.email, input.adminEmail)))
    .limit(1);
  const adminStaffUserId = existingAdmin[0]?.id ?? (
    await tx.insert(staffUsers).values({
      tenantId: input.tenantId,
      email: input.adminEmail,
      fullName: input.adminName ?? input.adminEmail,
      status: 'INVITED', // no password yet — S5 has no invite flow
    }).returning({ id: staffUsers.id })
  )[0]!.id;

  const hasRole = await tx.select({ id: staffPropertyRoles.id }).from(staffPropertyRoles)
    .where(and(
      eq(staffPropertyRoles.staffUserId, adminStaffUserId),
      eq(staffPropertyRoles.propertyId, propertyId),
    )).limit(1);
  if (!hasRole[0]) {
    await tx.insert(staffPropertyRoles).values({
      tenantId: input.tenantId,
      staffUserId: adminStaffUserId,
      propertyId,
      roleId: roleIds.get('PROPERTY_ADMIN')!,
    });
  }

  if (!existingProperty[0]) {
    await recordEvent(tx, {
      tenantId: input.tenantId, propertyId,
      entityType: 'property', entityId: propertyId,
      eventType: 'property.provisioned',
      payload: { rooms: input.rooms.length, requestTypes: requestTypeCount },
    });
  }

  return {
    propertyId, outletId, accessPolicyId, adminStaffUserId,
    roomIds, qrCodes, requestTypeCount,
  };
}
