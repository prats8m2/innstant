import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  createFloor, renameFloor, deleteFloor,
  createRoom, updateRoom, archiveRoom, restoreRoom, regenerateQrCode,
  createRoomType, updateRoomType, archiveRoomType, restoreRoomType,
  listRoomsAtProperty, liveQrCodesForProperty, listFloors,
  listRoomTypes, listRoomTypesWithUse,
  updatePropertySettings, currencyIsStillOpen, findProperty,
} from '@/modules/identity';
import { createStay, checkOutStay } from '@/modules/stay';
import { postFolioLine } from '@/modules/billing';
import { scanQrCode, resolveGuestSession, QrNotUsableError } from '@/modules/access';
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
    // Anything these tests added, but never the three the fixture provisions.
    await owner.query(
      `DELETE FROM room_types WHERE property_id = $1 AND code = ANY($2)`,
      [a.propertyId, ['CYD']]);
    await owner.query(
      `UPDATE room_types SET archived_at = NULL WHERE property_id = $1`, [a.propertyId]);
    await owner.query(
      `UPDATE rooms SET archived_at = NULL WHERE property_id = $1`, [a.propertyId]);
    await owner.query(
      `UPDATE room_qr_codes SET revoked_at = NULL WHERE property_id = $1`, [a.propertyId]);
    await owner.query(
      `UPDATE properties SET name = 'Hotel A', timezone = 'Asia/Kolkata', currency = 'INR'
       WHERE id = $1`, [a.propertyId]);
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

  /* ── The hotel itself ────────────────────────────────────────────────── */

  const settingsNow = () => scoped((tx) => findProperty(tx, a.propertyId));

  const saveSettings = (over: Record<string, unknown> = {}) =>
    scoped((tx) => updatePropertySettings(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      name: 'The Kesari', timezone: 'Asia/Kolkata', currency: 'INR',
      staffUserId: gm, ...over,
    }));

  it('renames the hotel and moves its clock', async () => {
    await saveSettings({ name: 'The Kesari Haveli', timezone: 'Asia/Dubai' });

    const now = await settingsNow();
    expect(now?.name).toBe('The Kesari Haveli');
    expect(now?.timezone).toBe('Asia/Dubai');

    const history = await scoped((tx) => readEventHistory(tx, 'property', a.propertyId));
    const event = history.find((row) => row.event_type === 'property.updated');
    expect(event).toBeTruthy();
  });

  /**
   * A typo here surfaces weeks later as a guest reading "by 3:26 am", not as an
   * error — kitchen hours, availability windows and business-day rollovers are
   * all property-local. Validated against the runtime's own tz database rather
   * than a list kept here.
   */
  it('refuses a timezone that is not one', async () => {
    await expect(saveSettings({ timezone: 'Asia/Kolkatta' }))
      .rejects.toThrow(/not a timezone/);
    expect((await settingsNow())?.timezone).toBe('Asia/Kolkata');
  });

  it('takes a real IANA alias', async () => {
    await saveSettings({ timezone: 'Asia/Calcutta' });
    expect((await settingsNow())?.timezone).toBe('Asia/Calcutta');
  });

  it('refuses something that is not a currency code', async () => {
    await expect(saveSettings({ currency: 'Rupees' })).rejects.toThrow(/three-letter ISO/);
  });

  /**
   * #5 — every row holding an amount carries its OWN currency. Nothing converts
   * a past bill, and a folio whose rows disagree is not a bill. So the currency
   * is settable during setup and fixed from the first charge onwards.
   */
  it('lets the currency change before anything is charged', async () => {
    expect(await scoped((tx) => currencyIsStillOpen(tx, a.propertyId))).toBe(true);

    await saveSettings({ currency: 'aed' });
    expect((await settingsNow())?.currency).toBe('AED');
  });

  it('fixes the currency once the property has charged', async () => {
    const room = await addRoom({ number: '215' });
    const stay = await scoped((tx) => createStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id,
      guest: { fullName: 'Paid For Something', phone: '+919820013131' },
      scheduledCheckoutAt: atLocalHourOnSameDay(new Date(Date.now() + 86_400_000), 11, TZ),
      actor: { kind: 'STAFF', staffUserId: gm },
    }));

    await scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId,
      source: 'MANUAL', description: 'Laundry', amountMinor: 30_000, currency: 'INR',
      postedByStaffId: gm,
    }));

    expect(await scoped((tx) => currencyIsStillOpen(tx, a.propertyId))).toBe(false);

    await expect(saveSettings({ currency: 'AED' }))
      .rejects.toThrow(/already charged in INR/);
    expect((await settingsNow())?.currency).toBe('INR');

    // The name and the clock are still editable — only the currency is pinned.
    await saveSettings({ name: 'The Kesari Haveli' });
    expect((await settingsNow())?.name).toBe('The Kesari Haveli');
  });

  /* ── Room types ──────────────────────────────────────────────────────── */

  const typesNow = () => scoped((tx) => listRoomTypesWithUse(tx, { propertyId: a.propertyId }));
  const offeredNow = () => scoped((tx) => listRoomTypes(tx, { propertyId: a.propertyId }));

  const addType = (over: Record<string, unknown> = {}) => scoped((tx) => createRoomType(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId,
    name: 'Courtyard', code: 'CYD', maxOccupancy: 2, staffUserId: gm, ...over,
  }));

  it('adds a room type, and a room can be it', async () => {
    const type = await addType();

    expect((await offeredNow()).find((t) => t.id === type.id)?.code).toBe('CYD');

    const room = await addRoom({ number: '215', roomTypeId: type.id });
    expect((await roomsNow()).find((r) => r.id === room.id)?.roomTypeName).toBe('Courtyard');

    const history = await scoped((tx) => readEventHistory(tx, 'room_type', type.id));
    expect(history[0]!.event_type).toBe('room_type.created');
  });

  /**
   * "lkv", " LKV " and "Lkv" must not become three room types at the same hotel.
   * A code is what a rate sheet, a PMS export and a channel manager will key on.
   */
  it('normalises the code, and refuses a second one like it', async () => {
    const type = await addType({ code: ' cyd ' });
    expect((await typesNow()).find((t) => t.id === type.id)?.code).toBe('CYD');

    await expect(addType({ name: 'Courtyard again', code: 'Cyd' }))
      .rejects.toThrow(/already in use here/);
  });

  it('refuses a code with punctuation in it', async () => {
    await expect(addType({ code: 'C/D' })).rejects.toThrow(/letters, numbers/);
  });

  it('renames one, and the guest reads the new name', async () => {
    const type = await addType();
    const room = await addRoom({ number: '215', roomTypeId: type.id });

    await scoped((tx) => updateRoomType(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomTypeId: type.id,
      name: 'Courtyard deluxe', code: 'CYD', maxOccupancy: 3, staffUserId: gm,
    }));

    expect((await roomsNow()).find((r) => r.id === room.id)?.roomTypeName)
      .toBe('Courtyard deluxe');
    expect((await typesNow()).find((t) => t.id === type.id)?.maxOccupancy).toBe(3);
  });

  /**
   * `rooms.room_type_id` is NOT NULL, so a type with rooms on it cannot be
   * deleted — and must not be archived either, or those rooms would point at
   * something the edit form can no longer offer.
   */
  it('refuses to retire a type that rooms still are, and counts them first', async () => {
    const type = await addType();
    await addRoom({ number: '215', roomTypeId: type.id });
    await addRoom({ number: '216', roomTypeId: type.id });

    expect((await typesNow()).find((t) => t.id === type.id)?.roomCount).toBe(2);

    await expect(scoped((tx) => archiveRoomType(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomTypeId: type.id, staffUserId: gm,
    }))).rejects.toThrow(/2 rooms are still a Courtyard/);
  });

  /** Archived ROOMS hold their type too — restoring one has to find it. */
  it('counts an out-of-service room against its type', async () => {
    const type = await addType();
    const room = await addRoom({ number: '215', roomTypeId: type.id });
    await scoped((tx) => archiveRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }));

    expect((await typesNow()).find((t) => t.id === type.id)?.roomCount).toBe(1);
    await expect(scoped((tx) => archiveRoomType(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomTypeId: type.id, staffUserId: gm,
    }))).rejects.toThrow(/One room is still a Courtyard/);
  });

  it('retires an unused one, which stops being offered but keeps its code', async () => {
    const type = await addType();

    await scoped((tx) => archiveRoomType(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomTypeId: type.id, staffUserId: gm,
    }));

    expect((await offeredNow()).find((t) => t.id === type.id)).toBeUndefined();
    expect((await typesNow()).find((t) => t.id === type.id)?.archivedAt).toBeTruthy();

    // The code is still taken: room_types_property_code_uq has no partial
    // predicate, and saying so beats a 23505.
    await expect(addType({ name: 'Courtyard II', code: 'CYD' }))
      .rejects.toThrow(/retired room type, which still holds the code/);

    await scoped((tx) => restoreRoomType(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomTypeId: type.id, staffUserId: gm,
    }));
    expect((await offeredNow()).find((t) => t.id === type.id)?.code).toBe('CYD');
  });

  it('will not put a room on a retired type', async () => {
    const type = await addType();
    await scoped((tx) => archiveRoomType(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomTypeId: type.id, staffUserId: gm,
    }));

    await expect(addRoom({ number: '215', roomTypeId: type.id }))
      .rejects.toThrow(/Pick a room type at this property/);
  });

  /* ── Reprinting a sticker ────────────────────────────────────────────── */

  const reprint = (roomId: string) => scoped((tx) => regenerateQrCode(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId, roomId, staffUserId: gm,
  }));

  const checkIn = (roomId: string, fullName: string) => scoped((tx) => createStay(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId, roomId,
    guest: { fullName, phone: '+919820012121' },
    scheduledCheckoutAt: atLocalHourOnSameDay(new Date(Date.now() + 86_400_000), 11, TZ),
    actor: { kind: 'STAFF', staffUserId: gm },
  }));

  /**
   * The claim `room_qr_codes.version` has carried since 0000 — "reprinting a
   * sticker invalidates the old one" — and which nothing did until P3.5.
   */
  it('kills the old sticker and issues a working one', async () => {
    const room = await addRoom({ number: '215' });
    await checkIn(room.id, 'Photographed In The Lift');

    const issued = await reprint(room.id);

    expect(issued.publicCode).not.toBe(room.publicCode);
    expect(issued.version).toBe(2);
    expect((await codesNow()).get(room.id)?.publicCode).toBe(issued.publicCode);

    await expect(scanQrCode(room.publicCode)).rejects.toBeInstanceOf(QrNotUsableError);
    expect((await scanQrCode(issued.publicCode)).room.number).toBe('215');
  });

  /**
   * #10 — sessions bind to `stay_id`, never to the room and never to the code.
   *
   * This is the reason a desk can reprint a sticker on an OCCUPIED room, which
   * is exactly the room whose code got photographed. A reprint that signed the
   * guest out would make the desk afraid to use it, and the control would be
   * there without ever being reached for.
   */
  it('does not sign out the guest already in the room', async () => {
    const room = await addRoom({ number: '215' });
    await checkIn(room.id, 'Already Scanned');

    const scan = await scanQrCode(room.publicCode);
    await reprint(room.id);

    const still = await resolveGuestSession(scan.cookieValue);
    expect(still?.stayId).toBe(scan.session.stayId);
  });

  /**
   * Never backwards. A room reprinted, shut and reopened reads 1, 2, 3 — so the
   * number in the audit trail is the number on the plastic. Derived from
   * `max(version)` rather than a row count, so a code deleted by hand cannot
   * make two stickers both claim to be the second.
   */
  it('numbers stickers by how many have been printed, not how many are live', async () => {
    const room = await addRoom({ number: '215' });

    expect((await reprint(room.id)).version).toBe(2);

    await scoped((tx) => archiveRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }));
    await scoped((tx) => restoreRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }));

    expect((await codesNow()).get(room.id)?.version).toBe(3);
    expect((await reprint(room.id)).version).toBe(4);
  });

  it('refuses on a room that is out of service, and says what to do instead', async () => {
    const room = await addRoom({ number: '215' });
    await scoped((tx) => archiveRoom(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: room.id, staffUserId: gm,
    }));

    await expect(reprint(room.id)).rejects.toThrow(/out of service. Bring it back/);
    // And still nothing live, so the refusal did not leave a working code on a
    // door the desk cannot put anybody behind.
    expect((await codesNow()).get(room.id)).toBeUndefined();
  });

  it('records the reprint without recording the code', async () => {
    const room = await addRoom({ number: '215' });
    const issued = await reprint(room.id);

    const history = await scoped((tx) => readEventHistory(tx, 'room', room.id));
    const event = history.find((row) => row.event_type === 'qr.regenerated');
    expect(event).toBeTruthy();
    expect(event!.actor_kind).toBe('STAFF');
    expect(JSON.stringify(history)).not.toContain(issued.publicCode);
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
