import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  createStay, checkOutStay, getGuestDossier, updateGuestProfile, guestIdForStay, recentGuests,
} from '@/modules/stay';
import { postFolioLine } from '@/modules/billing';
import {
  getRequestTypeByKey, raiseServiceRequest,
} from '@/modules/requests';
import { atLocalHourOnSameDay } from '@/lib/clock';
import {
  ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * Everything one property knows about one guest.
 *
 * `guests` is tenant-scoped and `guest_property_profiles` is not
 * (EXTENSION-POINTS §2), which is the whole shape of this: a returning guest is
 * one row whose history follows them, and what each hotel thinks of them is
 * that hotel's own.
 */
describe('a guest, and what this property knows', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let gm = '';

  const TZ = 'Asia/Kolkata';
  const PHONE = '+919820044444';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const tomorrowAt = (hour: number) =>
    atLocalHourOnSameDay(new Date(Date.now() + 86_400_000), hour, TZ);

  const checkIn = (over: Record<string, unknown> = {}) => scoped((tx) => createStay(tx, {
    tenantId: a.tenantId,
    propertyId: a.propertyId,
    roomId: a.roomId,
    guest: { fullName: 'Iqbal Qureshi', phone: PHONE },
    scheduledCheckoutAt: tomorrowAt(11),
    actor: { kind: 'STAFF', staffUserId: gm },
    ...over,
  }));

  const dossier = (guestId: string) =>
    scoped((tx) => getGuestDossier(tx, { propertyId: a.propertyId, guestId }));

  const save = (guestId: string, over: Record<string, unknown> = {}) =>
    scoped((tx) => updateGuestProfile(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      guestId,
      isVip: false,
      chargingBlocked: false,
      staffNotes: null,
      dietaryFlags: [],
      staffUserId: gm,
      ...over,
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
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['service_request_items', 'service_requests', 'folio_lines', 'folios',
                     'checkout_requests', 'guest_sessions', 'stays',
                     'guest_property_profiles', 'guests', 'idempotency_keys']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── The dossier ─────────────────────────────────────────────────────── */

  it('is who they are, plus what this property has written down', async () => {
    const stay = await checkIn();
    const found = (await dossier(stay.guestId))!;

    expect(found.fullName).toBe('Iqbal Qureshi');
    expect(found.phone).toBe(PHONE);
    // No profile row yet: nothing is known, which is not the same as blocked.
    expect(found.isVip).toBe(false);
    expect(found.chargingBlocked).toBe(false);
    expect(found.dietaryFlags).toEqual([]);
    expect(found.currentStayId).toBe(stay.stayId);
  });

  it('lists their stays here, newest first, with what each one owed', async () => {
    const first = await checkIn();
    await scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: first.stayId,
      source: 'ORDER', description: 'Dinner', amountMinor: 247_000, currency: 'INR',
    }));
    await scoped((tx) => checkOutStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: first.stayId, staffUserId: gm,
    }));
    const second = await checkIn();

    const found = (await dossier(first.guestId))!;
    expect(found.stays).toHaveLength(2);
    expect(found.stays[0]!.id).toBe(second.stayId);
    expect(found.stays[0]!.status).toBe('CHECKED_IN');
    expect(found.stays[1]!.status).toBe('CHECKED_OUT');
    expect(found.stays[1]!.balanceMinor).toBe(247_000);
    expect(found.stays[1]!.roomNumber).toBe('214');
  });

  /**
   * Computed from the folios, not read from
   * `guest_property_profiles.lifetime_value_minor` — which exists, is written by
   * nobody and read by nobody. An unmaintained denormalised total is worse than
   * none (D-036).
   */
  it('adds up what they have spent here across every stay', async () => {
    const first = await checkIn();
    await scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: first.stayId,
      source: 'ORDER', description: 'Dinner', amountMinor: 247_000, currency: 'INR',
    }));
    await scoped((tx) => checkOutStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: first.stayId, staffUserId: gm,
    }));

    const second = await checkIn();
    await scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: second.stayId,
      source: 'ORDER', description: 'Breakfast', amountMinor: 62_000, currency: 'INR',
    }));

    expect((await dossier(first.guestId))!.lifetimeChargesMinor).toBe(309_000);
  });

  it('finds the guest from a stay, which is where the desk comes from', async () => {
    const stay = await checkIn();
    expect(await scoped((tx) =>
      guestIdForStay(tx, { propertyId: a.propertyId, stayId: stay.stayId })))
      .toBe(stay.guestId);
  });

  it('lists recent guests for a desk looking for somebody who has left', async () => {
    const stay = await checkIn();
    await scoped((tx) => checkOutStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId, staffUserId: gm,
    }));

    const recent = await scoped((tx) => recentGuests(tx, { propertyId: a.propertyId }));
    expect(recent.map((g) => g.fullName)).toContain('Iqbal Qureshi');
  });

  /* ── What the property writes down ───────────────────────────────────── */

  it('saves the flags, the notes and the two switches', async () => {
    const stay = await checkIn();
    await save(stay.guestId, {
      isVip: true,
      staffNotes: 'Always asks for the corner table.',
      dietaryFlags: ['NUT_ALLERGY', 'VEGETARIAN'],
    });

    const found = (await dossier(stay.guestId))!;
    expect(found.isVip).toBe(true);
    expect(found.staffNotes).toBe('Always asks for the corner table.');
    // Sorted and de-duplicated, so the order the form posted is not the order
    // the kitchen reads.
    expect(found.dietaryFlags).toEqual(['NUT_ALLERGY', 'VEGETARIAN']);
  });

  it('refuses a dietary flag the kitchen would not understand', async () => {
    const stay = await checkIn();
    await expect(save(stay.guestId, { dietaryFlags: ['PESCATARIAN'] }))
      .rejects.toThrow(/does not know/i);
  });

  it('logs who changed what, as a diff', async () => {
    const stay = await checkIn();
    await save(stay.guestId, { chargingBlocked: true, dietaryFlags: ['JAIN'] });

    const history = await scoped((tx) => readEventHistory(tx, 'guest', stay.guestId));
    const updated = history.find((e) => e.event_type === 'guest.profile_updated')!;
    const changed = (updated.payload as { changed: Record<string, { to: unknown }> }).changed;

    // "Who put a hold on 214, and when" has to be answerable.
    expect(changed.chargingBlocked).toEqual({ from: false, to: true });
    expect(changed.dietaryFlags).toEqual({ from: [], to: ['JAIN'] });
    expect(updated.actor_kind).toBe('STAFF');
  });

  it('does not log a save that changed nothing', async () => {
    const stay = await checkIn();
    await save(stay.guestId, { isVip: true });
    await save(stay.guestId, { isVip: true });

    const history = await scoped((tx) => readEventHistory(tx, 'guest', stay.guestId));
    expect(history.filter((e) => e.event_type === 'guest.profile_updated')).toHaveLength(1);
  });

  /* ── The hold, and what it stops ─────────────────────────────────────── */

  /**
   * `placeOrder()` has refused on this since P1. `raiseServiceRequest()` did
   * not — so a guest who could not order a chai could still put ₹450 of laundry
   * on the same room, which is the desk's decision being overruled by whichever
   * screen the guest opened.
   */
  it('a charging hold stops a chargeable request, not just an order', async () => {
    const stay = await checkIn();
    await save(stay.guestId, { chargingBlocked: true });

    await expect(scoped(async (tx) => {
      const type = await getRequestTypeByKey(tx, { propertyId: a.propertyId, key: 'LAUNDRY' });
      return raiseServiceRequest(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId, roomId: a.roomId,
        lines: [{ requestTypeId: type!.id, quantity: 1 }],
        idempotencyKey: `hold-${Math.random()}`, accessTier: 'FULL',
      });
    })).rejects.toThrow(/on hold/i);
  });

  /**
   * #9. A hold on CHARGING must not stop somebody asking for a towel — that
   * would turn a billing dispute into a guest who cannot call for help.
   */
  it('a charging hold does not stop a free request', async () => {
    const stay = await checkIn();
    await save(stay.guestId, { chargingBlocked: true });

    await expect(scoped(async (tx) => {
      const type = await getRequestTypeByKey(tx, {
        propertyId: a.propertyId, key: 'EXTRA_TOWELS',
      });
      return raiseServiceRequest(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId, roomId: a.roomId,
        lines: [{ requestTypeId: type!.id, quantity: 1 }],
        idempotencyKey: `free-${Math.random()}`, accessTier: 'REQUEST',
      });
    })).resolves.toBeTruthy();
  });

  it('lifts the hold when the desk lifts it', async () => {
    const stay = await checkIn();
    await save(stay.guestId, { chargingBlocked: true });
    await save(stay.guestId, { chargingBlocked: false });

    await expect(scoped(async (tx) => {
      const type = await getRequestTypeByKey(tx, { propertyId: a.propertyId, key: 'LAUNDRY' });
      return raiseServiceRequest(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId, roomId: a.roomId,
        lines: [{ requestTypeId: type!.id, quantity: 1 }],
        idempotencyKey: `lifted-${Math.random()}`, accessTier: 'FULL',
      });
    })).resolves.toBeTruthy();
  });

  /* ── One guest, two hotels ───────────────────────────────────────────── */

  /**
   * EXTENSION-POINTS §2: the guest is one row across the group, and the profile
   * is per property. A hold at one hotel is not a hold at its sister, and the
   * note somebody left in Udaipur is not on the screen in Jaipur.
   */
  it('keeps one guest row across the group and one profile per property', async () => {
    const here = await checkIn();

    const there = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => createStay(tx, {
        tenantId: b.tenantId, propertyId: b.propertyId, roomId: b.roomId,
        guest: { fullName: 'Iqbal Qureshi', phone: PHONE },
        scheduledCheckoutAt: tomorrowAt(11),
        actor: { kind: 'STAFF', staffUserId: gm },
      }),
    );
    // Tenant B is a different tenant, so this is a DIFFERENT guest row — the key
    // is (tenant_id, phone), never phone alone.
    expect(there.guestId).not.toBe(here.guestId);

    await save(here.guestId, { chargingBlocked: true, staffNotes: 'Card declined once.' });

    const theirs = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => getGuestDossier(tx, { propertyId: b.propertyId, guestId: there.guestId }),
    );
    expect(theirs!.chargingBlocked).toBe(false);
    expect(theirs!.staffNotes).toBeNull();
  });

  it('another hotel cannot read this one\'s dossier', async () => {
    const stay = await checkIn();
    const leaked = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => getGuestDossier(tx, { propertyId: a.propertyId, guestId: stay.guestId }),
    );
    expect(leaked).toBeNull();
  });

  it('another hotel cannot write to it either', async () => {
    const stay = await checkIn();
    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => updateGuestProfile(tx, {
        tenantId: b.tenantId, propertyId: a.propertyId, guestId: stay.guestId,
        isVip: true, chargingBlocked: true, staffNotes: 'x', dietaryFlags: [],
        staffUserId: gm,
      }),
    )).rejects.toThrow();

    expect((await dossier(stay.guestId))!.chargingBlocked).toBe(false);
  });
});
