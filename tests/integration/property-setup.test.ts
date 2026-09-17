import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  createFloor, renameFloor, deleteFloor,
  createRoom, updateRoom, archiveRoom, restoreRoom,
  listRoomsAtProperty, liveQrCodesForProperty, listFloors,
} from '@/modules/identity';
import { createStay, checkOutStay } from '@/modules/stay';
import { scanQrCode, QrNotUsableError } from '@/modules/access';
import { atLocalHourOnSameDay } from '@/lib/clock';
import {
  ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * P3.5 — a hotel opening a floor, or renumbering a wing.
 *
 * `provisionProperty()` has done this in one transaction since P0 and was the
 * only thing that ever did, so the claims worth a real database are the ones it
 * used to guarantee by construction: that a new room gets a QR code, and that
 * the uniqueness the schema enforces reaches somebody as a sentence.
 */
describe('setting up the building', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let gm = '';
  let roomTypeId = '';

  const TZ = 'Asia/Kolkata';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const floorsNow = () => scoped((tx) => listFloors(tx, a.propertyId));
  const roomsNow = () => scoped((tx) => listRoomsAtProperty(tx, { propertyId: a.propertyId }));
  const codesNow = () => scoped((tx) => liveQrCodesForProperty(tx, { propertyId: a.propertyId }));

  const addFloor = (over: Record<string, unknown> = {}) => scoped((tx) => createFloor(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId,
    name: 'Second', level: 2, staffUserId: gm, ...over,
  }));

  const addRoom = (over: Record<string, unknown> = {}) => scoped((tx) => createRoom(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId,
    floorId: a.floorId, roomTypeId, number: '215', staffUserId: gm, ...over,
  }));

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');

    const gmRow = await owner.query<{ id: string }>(
      `SELECT su.id FROM staff_users su
       JOIN staff_property_roles spr ON spr.staff_user_id = su.id
       JOIN roles r ON r.id = spr.role_id
       WHERE spr.property_id = $1 AND r.key = 'PROPERTY_ADMIN' LIMIT 1`, [a.propertyId]);
    gm = gmRow.rows[0]!.id;

    const typeRow = await owner.query<{ id: string }>(
      `SELECT id FROM room_types WHERE property_id = $1 LIMIT 1`, [a.propertyId]);
    roomTypeId = typeRow.rows[0]!.id;
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['folio_lines', 'folios', 'guest_sessions', 'stays', 'guests']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    }
    // Anything these tests added, but never the fixture's own room or floor.
    await owner.query(
      `DELETE FROM room_qr_codes WHERE room_id IN
         (SELECT id FROM rooms WHERE property_id = $1 AND number <> '214')`, [a.propertyId]);
    await owner.query(
      `DELETE FROM rooms WHERE property_id = $1 AND number <> '214'`, [a.propertyId]);
    await owner.query(
      `DELETE FROM floors WHERE property_id = $1 AND id <> $2`, [a.propertyId, a.floorId]);
    await owner.query(
      `UPDATE rooms SET archived_at = NULL WHERE property_id = $1`, [a.propertyId]);
    await owner.query(
      `UPDATE room_qr_codes SET revoked_at = NULL WHERE property_id = $1`, [a.propertyId]);
    await owner.query(`DELETE FROM event_log WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── Floors ──────────────────────────────────────────────────────────── */

  it('opens a floor', async () => {
    const floor = await addFloor();
    const all = await floorsNow();

    expect(all.find((f) => f.id === floor.id)?.name).toBe('Second');

    const history = await scoped((tx) => readEventHistory(tx, 'floor', floor.id));
    expect(history[0]!.event_type).toBe('floor.created');
    expect(history[0]!.actor_kind).toBe('STAFF');
  });

  it('refuses a second floor at the same level', async () => {
    await addFloor({ level: 2 });
    await expect(addFloor({ level: 2, name: 'Second again' }))
      .rejects.toThrow(/already a floor at level 2/);
  });

  it('renames one', async () => {
    const floor = await addFloor();
    await scoped((tx) => renameFloor(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      floorId: floor.id, name: 'Lake wing', staffUserId: gm,
    }));
    expect((await floorsNow()).find((f) => f.id === floor.id)?.name).toBe('Lake wing');
  });

  it('deletes an empty one', async () => {
    const floor = await addFloor();
    await scoped((tx) => deleteFloor(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, floorId: floor.id, staffUserId: gm,
    }));
    expect((await floorsNow()).find((f) => f.id === floor.id)).toBeUndefined();
  });

  /**
   * Including archived rooms, which still point at the floor by FK and whose old
   * stays are still the answer to "where was this guest in March".
   */
  it('refuses to delete a floor that still holds rooms', async () => {
    const floor = await addFloor();
    const room = await addRoom({ floorId: floor.id, number: '201' });

    await expect(scoped((tx) => deleteFloor(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, floorId: floor.id, staffUserId: gm,
    }))).rejects.toThrow(/One room is still on this floor/);

    await scoped((tx) => archiveRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }));
    await expect(scoped((tx) => deleteFloor(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, floorId: floor.id, staffUserId: gm,
    }))).rejects.toThrow(/still on this floor/);
  });

  /* ── Rooms ───────────────────────────────────────────────────────────── */

  /**
   * The claim `provisionProperty()` used to guarantee by construction. A room
   * created without a code is invisible to the entire guest surface, and no
   * screen would tell you — every one of them assumes the code exists.
   */
  it('mints a QR code with the room, and a phone can scan it', async () => {
    const room = await addRoom({ number: '215' });
    expect(room.publicCode).toBeTruthy();

    expect((await codesNow()).get(room.id)?.publicCode).toBe(room.publicCode);

    // A code with no stay behind it is correctly unusable, so check somebody in
    // first — which is what a real new room gets.
    await scoped((tx) => createStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id,
      guest: { fullName: 'First Guest', phone: '+919820012121' },
      scheduledCheckoutAt: atLocalHourOnSameDay(new Date(Date.now() + 86_400_000), 11, TZ),
      actor: { kind: 'STAFF', staffUserId: gm },
    }));

    const scan = await scanQrCode(room.publicCode);
    expect(scan.room.number).toBe('215');
  });

  it('never mints the same code twice', async () => {
    const first = await addRoom({ number: '215' });
    const second = await addRoom({ number: '216' });
    expect(first.publicCode).not.toBe(second.publicCode);
  });

  it('refuses a number already in use', async () => {
    await expect(addRoom({ number: '214' })).rejects.toThrow(/Room 214 already exists/);
  });

  /**
   * `rooms_property_number_uq` has no partial predicate, so an archived room
   * keeps its number. Saying so is better than a 23505, and better than letting
   * somebody believe they can reuse it.
   */
  it('says why a removed room\'s number is still taken', async () => {
    const room = await addRoom({ number: '215' });
    await scoped((tx) => archiveRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }));

    await expect(addRoom({ number: '215' }))
      .rejects.toThrow(/still holds its number. Restore it instead/);
  });

  it('will not put a room on another property\'s floor', async () => {
    await expect(addRoom({ number: '215', floorId: b.floorId }))
      .rejects.toThrow(/Pick a floor at this property/);
    await expect(addRoom({ number: '215', roomTypeId: b.roomTypeId }))
      .rejects.toThrow(/Pick a room type at this property/);
  });

  it('renumbers and moves a room, and logs the diff', async () => {
    const floor = await addFloor();
    const room = await addRoom({ number: '215' });

    await scoped((tx) => updateRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id,
      floorId: floor.id, roomTypeId, number: '2A', staffUserId: gm,
    }));

    const moved = (await roomsNow()).find((r) => r.id === room.id)!;
    expect(moved.number).toBe('2A');
    expect(moved.floorId).toBe(floor.id);

    const history = await scoped((tx) => readEventHistory(tx, 'room', room.id));
    const changed = (history.find((e) => e.event_type === 'room.updated')!
      .payload as { changed: Record<string, unknown> }).changed;
    expect(Object.keys(changed).sort()).toEqual(['floorId', 'number']);
  });

  /* ── Out of service ──────────────────────────────────────────────────── */

  /**
   * The sticker has to die with the room. Leaving the code live on a room out of
   * service means a sticker in a corridor that resolves to a real property for
   * ever.
   */
  it('revokes the sticker when a room goes out of service', async () => {
    const room = await addRoom({ number: '215' });
    await scoped((tx) => archiveRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }));

    expect((await roomsNow()).find((r) => r.id === room.id)).toBeUndefined();
    expect((await codesNow()).get(room.id)).toBeUndefined();
    await expect(scanQrCode(room.publicCode)).rejects.toBeInstanceOf(QrNotUsableError);
  });

  it('refuses while somebody is in it, and allows it once they leave', async () => {
    const room = await addRoom({ number: '215' });
    const stay = await scoped((tx) => createStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id,
      guest: { fullName: 'In Residence', phone: '+919820013131' },
      scheduledCheckoutAt: atLocalHourOnSameDay(new Date(Date.now() + 86_400_000), 11, TZ),
      actor: { kind: 'STAFF', staffUserId: gm },
    }));

    await expect(scoped((tx) => archiveRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }))).rejects.toThrow(/Somebody is still in room 215/);

    await scoped((tx) => checkOutStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId, staffUserId: gm,
    }));
    await expect(scoped((tx) => archiveRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }))).resolves.toBeUndefined();
  });

  /**
   * A NEW code, not the old one. The old sticker has been out of a guest's hands
   * for however long the room was shut, and a code that was dead on Tuesday and
   * live on Thursday is the wrong kind of surprise.
   */
  it('gives a restored room a fresh sticker', async () => {
    const room = await addRoom({ number: '215' });
    const original = room.publicCode;

    await scoped((tx) => archiveRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }));
    const restored = await scoped((tx) => restoreRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }));

    expect(restored.publicCode).not.toBe(original);
    expect((await codesNow()).get(room.id)?.publicCode).toBe(restored.publicCode);
    expect((await roomsNow()).find((r) => r.id === room.id)).toBeTruthy();
    await expect(scanQrCode(original)).rejects.toBeInstanceOf(QrNotUsableError);
  });

  it('does not log the public code, which reaches the guest surface', async () => {
    const room = await addRoom({ number: '215' });
    const history = await scoped((tx) => readEventHistory(tx, 'room', room.id));
    expect(JSON.stringify(history)).not.toContain(room.publicCode);
  });

  /* ── Isolation ───────────────────────────────────────────────────────── */

  it('another hotel cannot add a room here, or remove one', async () => {
    const room = await addRoom({ number: '215' });

    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => createRoom(tx, {
        tenantId: b.tenantId, propertyId: a.propertyId,
        floorId: a.floorId, roomTypeId, number: '999', staffUserId: gm,
      }),
    )).rejects.toThrow();

    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => archiveRoom(tx, {
        tenantId: b.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
      }),
    )).rejects.toThrow();

    expect((await roomsNow()).find((r) => r.id === room.id)).toBeTruthy();
  });
});
