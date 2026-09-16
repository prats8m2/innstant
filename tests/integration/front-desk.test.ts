import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  createStay, listRoomsWithOccupancy, checkOutStay,
  requestCheckoutChange, decideCheckoutRequest, listCheckoutRequests,
} from '@/modules/stay';
import { postFolioLine } from '@/modules/billing';
import { scanQrCode, resolveGuestSession, QrNotUsableError } from '@/modules/access';
import { atLocalHourOnSameDay } from '@/lib/clock';
import {
  ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * The front desk.
 *
 * Check-out did not exist at all until now — `stay_status` has had CHECKED_OUT
 * since 0000 and nothing ever set it, which meant `revokeSessionsForStay()` had
 * one caller (a test) and #10's promise that sessions are revoked at checkout
 * was true only because no checkout had ever happened.
 */
describe('the front desk', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let gm = '';

  const TZ = 'Asia/Kolkata';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const tomorrowAt = (hour: number) =>
    atLocalHourOnSameDay(new Date(Date.now() + 86_400_000), hour, TZ);

  const checkIn = (over: Record<string, unknown> = {}) => scoped((tx) => createStay(tx, {
    tenantId: a.tenantId,
    propertyId: a.propertyId,
    roomId: a.roomId,
    guest: { fullName: 'Iqbal Qureshi', phone: '+919820044444' },
    scheduledCheckoutAt: tomorrowAt(11),
    actor: { kind: 'STAFF', staffUserId: gm },
    ...over,
  }));

  const checkOut = (stayId: string) => scoped((tx) => checkOutStay(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: gm,
  }));

  const rooms = () => scoped((tx) => listRoomsWithOccupancy(tx, { propertyId: a.propertyId }));

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
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['checkout_requests', 'folio_lines', 'folios', 'guest_sessions',
                     'access_escalations', 'verification_challenges', 'stays']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── The room list ───────────────────────────────────────────────────── */

  it('lists every room with its floor and type, empty ones included', async () => {
    const list = await rooms();
    expect(list.length).toBeGreaterThan(0);

    const room214 = list.find((r) => r.number === '214')!;
    expect(room214.floorName).toBeTruthy();
    expect(room214.roomTypeName).toBe('Deluxe');
    // Nobody is in it yet, which the desk has to be able to see.
    expect(room214.stay).toBeNull();
  });

  it('shows who is in a room, and what they owe', async () => {
    const stay = await checkIn();
    await scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId,
      source: 'ORDER', description: 'In-room dining', amountMinor: 247_000, currency: 'INR',
    }));

    const room214 = (await rooms()).find((r) => r.number === '214')!;
    expect(room214.stay?.guestName).toBe('Iqbal Qureshi');
    expect(room214.stay?.balanceMinor).toBe(247_000);
    expect(room214.stay?.scheduledCheckoutAt.getTime()).toBe(tomorrowAt(11).getTime());
  });

  /**
   * A stay with no folio has never been charged, which is different from owing
   * nothing — the screen says "nothing yet" rather than "₹0".
   */
  it('distinguishes a guest who owes nothing from one who has bought nothing', async () => {
    await checkIn();
    expect((await rooms()).find((r) => r.number === '214')!.stay!.balanceMinor).toBeNull();
  });

  /* ── The sticker's link ──────────────────────────────────────────────── */

  /**
   * The code a desk copies off this screen is the code a phone in the corridor
   * resolves. Showing one a scan would reject is worse than showing none,
   * because somebody will print forty of them.
   */
  it('shows the code a scan actually resolves', async () => {
    await checkIn();
    const withQr = await scoped((tx) =>
      listRoomsWithOccupancy(tx, { propertyId: a.propertyId, withQrCodes: true }));

    const room214 = withQr.find((r) => r.number === '214')!;
    expect(room214.qr?.publicCode).toBeTruthy();

    const scan = await scanQrCode(room214.qr!.publicCode);
    expect(scan.room.number).toBe('214');
    expect(scan.session.propertyId).toBe(a.propertyId);
  });

  /**
   * Reprinting a sticker mints a new version and revokes the old one, and a room
   * then has two `room_qr_codes` rows. The screen must show the live one — and
   * must not show the room twice, which a plain join would.
   */
  it('shows the live code after a reprint, once', async () => {
    const before = await scoped((tx) =>
      listRoomsWithOccupancy(tx, { propertyId: a.propertyId, withQrCodes: true }));
    const old = before.find((r) => r.number === '214')!.qr!.publicCode;

    await owner.query(
      `UPDATE room_qr_codes SET revoked_at = now() WHERE public_code = $1`, [old]);
    await owner.query(
      `INSERT INTO room_qr_codes (tenant_id, property_id, room_id, public_code, version)
       SELECT tenant_id, property_id, room_id, 'reprinted-214', 2
       FROM room_qr_codes WHERE public_code = $1`, [old]);

    const after = await scoped((tx) =>
      listRoomsWithOccupancy(tx, { propertyId: a.propertyId, withQrCodes: true }));
    const rows = after.filter((r) => r.number === '214');

    expect(rows).toHaveLength(1);
    expect(rows[0]!.qr?.publicCode).toBe('reprinted-214');

    // And the old one is genuinely dead, which is what made it worth replacing.
    await expect(scanQrCode(old)).rejects.toBeInstanceOf(QrNotUsableError);

    // Put the fixture back. `room_qr_codes` is seeded once in `beforeAll` and
    // the per-test wipe does not touch it, so a reprint left here kills every
    // later scan of `a.qrCode` — which is exactly what it did the first time.
    await owner.query(`DELETE FROM room_qr_codes WHERE public_code = 'reprinted-214'`);
    await owner.query(
      `UPDATE room_qr_codes SET revoked_at = NULL WHERE public_code = $1`, [old]);
  });

  /**
   * `qr:read` is its own permission. A public code reaches the room's guest
   * surface from anywhere, so a screen that may not show it is not handed it —
   * not hidden in the markup, absent from the payload.
   */
  it('does not fetch a code for a caller that did not ask', async () => {
    const without = await scoped((tx) =>
      listRoomsWithOccupancy(tx, { propertyId: a.propertyId }));
    expect(without.every((room) => room.qr === undefined)).toBe(true);
  });

  /* ── Check-in ────────────────────────────────────────────────────────── */

  it('puts a walk-in in an empty room, through the one door', async () => {
    // A phone nothing else in this file uses: `guests` is tenant-scoped and
    // survives between tests on purpose (EXTENSION-POINTS §2), so a shared
    // number would match a guest an earlier test created.
    const stay = await checkIn({
      guest: { fullName: 'Walk In', phone: '+919820099999' },
    });
    expect(stay.guestIsNew).toBe(true);

    const history = await scoped((tx) => readEventHistory(tx, 'stay', stay.stayId));
    expect(history.map((e) => e.event_type)).toContain('stay.created');
    // Attributed to the person at the desk, not to SYSTEM.
    expect(history[0]!.actor_kind).toBe('STAFF');
  });

  /**
   * D-007's partial unique index is the backstop; `createStay()` turns the 23505
   * into a sentence somebody at a desk can act on.
   */
  it('refuses to put a second guest in an occupied room', async () => {
    await checkIn();
    await expect(checkIn({ guest: { fullName: 'Somebody Else', phone: '+919820055555' } }))
      .rejects.toThrow();
  });

  it('matches a returning guest on their phone rather than making a second one',
    async () => {
      const first = await checkIn();
      await checkOut(first.stayId);
      const second = await checkIn();

      expect(second.guestIsNew).toBe(false);
      expect(second.guestId).toBe(first.guestId);
    });

  /* ── Check-out ───────────────────────────────────────────────────────── */

  /**
   * #10, and the reason sessions bind to `stay_id` rather than to `room_id`.
   * The sticker on the nightstand is unchanged and still public; the phone that
   * scanned it this morning stops working this afternoon.
   */
  it('revokes every session on the stay, and the QR still works for the next guest',
    async () => {
      const stay = await checkIn();
      const phone = await scanQrCode(a.qrCode);
      const tablet = await scanQrCode(a.qrCode);
      expect(await resolveGuestSession(phone.cookieValue)).toBeTruthy();

      const result = await checkOut(stay.stayId);
      expect(result.sessionsRevoked).toBe(2);

      for (const device of [phone, tablet]) {
        expect(await resolveGuestSession(device.cookieValue)).toBeNull();
      }

      // The next guest scans the same unchanged sticker and gets their own stay.
      const next = await checkIn({ guest: { fullName: 'Next Guest', phone: '+919820066666' } });
      const fresh = await scanQrCode(a.qrCode);
      expect(fresh.session.stayId).toBe(next.stayId);
      expect(fresh.session.stayId).not.toBe(stay.stayId);
    });

  it('frees the room the moment it commits', async () => {
    const first = await checkIn();
    await checkOut(first.stayId);

    expect((await rooms()).find((r) => r.number === '214')!.stay).toBeNull();
    // D-007's index only counts CHECKED_IN, so the room is immediately reusable.
    await expect(checkIn({ guest: { fullName: 'Next Guest', phone: '+919820066666' } }))
      .resolves.toBeTruthy();
  });

  it('records what was still owed when they walked', async () => {
    const stay = await checkIn();
    await scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId,
      source: 'ORDER', description: 'In-room dining', amountMinor: 247_000, currency: 'INR',
    }));

    const result = await checkOut(stay.stayId);
    expect(result.balanceMinor).toBe(247_000);

    const history = await scoped((tx) => readEventHistory(tx, 'stay', stay.stayId));
    const out = history.find((e) => e.event_type === 'stay.checked_out')!;
    // "They left owing ₹2,470 and the desk checked them out at 11:04" has to be
    // answerable later. Settlement is a later bullet; the number is not lost.
    expect((out.payload as Record<string, unknown>).balanceMinor).toBe(247_000);
    expect(out.to_status).toBe('CHECKED_OUT');
    expect(out.actor_kind).toBe('STAFF');
  });

  it('does not block on an unpaid balance', async () => {
    const stay = await checkIn();
    await scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId,
      source: 'ORDER', description: 'Dinner', amountMinor: 500_000, currency: 'INR',
    }));
    // The desk settles by card machine and records the departure here. Refusing
    // would make the feature unusable until express checkout exists.
    await expect(checkOut(stay.stayId)).resolves.toMatchObject({ balanceMinor: 500_000 });
  });

  it('refuses to check the same guest out twice', async () => {
    const stay = await checkIn();
    await checkOut(stay.stayId);
    await expect(checkOut(stay.stayId)).rejects.toThrow(/already checked out/i);
  });

  it('two people at the desk pressing check out produce one departure', async () => {
    const stay = await checkIn();
    const phone = await scanQrCode(a.qrCode);

    const [first, second] = await Promise.allSettled([
      checkOut(stay.stayId), checkOut(stay.stayId),
    ]);
    expect([first, second].filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const history = await scoped((tx) => readEventHistory(tx, 'stay', stay.stayId));
    expect(history.filter((e) => e.event_type === 'stay.checked_out')).toHaveLength(1);
    expect(await resolveGuestSession(phone.cookieValue)).toBeNull();
  });

  /* ── The checkout requests it tidies up ──────────────────────────────── */

  /**
   * COMPLETED was unreachable before this: a stay could be approved for 2pm and
   * nothing ever ended it.
   */
  it('completes an approved late checkout on the way out', async () => {
    const stay = await checkIn();
    const asked = await scoped((tx) => requestCheckoutChange(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId,
      requestedCheckoutAt: tomorrowAt(14), feeMinor: 250_000, currency: 'INR',
    }));
    await scoped((tx) => decideCheckoutRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, checkoutRequestId: asked.id,
      to: 'APPROVED', staffUserId: gm, timeZone: TZ,
    }));

    const result = await checkOut(stay.stayId);
    expect(result.completedCheckoutRequests).toBe(1);

    const done = await scoped((tx) =>
      listCheckoutRequests(tx, { propertyId: a.propertyId, statuses: ['COMPLETED'] }));
    expect(done).toHaveLength(1);
  });

  /** Nobody is going to answer it now, and the desk's queue is for live rooms. */
  it('cancels a request still waiting on the desk', async () => {
    const stay = await checkIn();
    await scoped((tx) => requestCheckoutChange(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId,
      requestedCheckoutAt: tomorrowAt(14), feeMinor: 250_000, currency: 'INR',
    }));

    const result = await checkOut(stay.stayId);
    expect(result.cancelledCheckoutRequests).toBe(1);
    expect(await scoped((tx) =>
      listCheckoutRequests(tx, { propertyId: a.propertyId }))).toEqual([]);
  });

  /* ── Isolation ───────────────────────────────────────────────────────── */

  it('another hotel cannot see or end this one\'s stays', async () => {
    const stay = await checkIn();

    const theirs = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => listRoomsWithOccupancy(tx, { propertyId: a.propertyId }),
    );
    expect(theirs).toEqual([]);

    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => checkOutStay(tx, {
        tenantId: b.tenantId, propertyId: a.propertyId,
        stayId: stay.stayId, staffUserId: gm,
      }),
    )).rejects.toThrow();

    expect((await rooms()).find((r) => r.number === '214')!.stay).toBeTruthy();
  });
});
