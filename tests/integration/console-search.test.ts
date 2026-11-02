import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant } from '@/db';
import { consoleChrome, searchRooms, setConsoleAppearance } from '@/modules/identity';
import { searchGuests } from '@/modules/stay';
import { searchOrders } from '@/modules/ordering';
import { orderNeedle } from '@/lib/search';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * The console's frame: ⌘K's three reads, and a person's light or dark
 * (migration 0017). All through app_user, so RLS is in the room.
 */
describe('the console frame', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let adminA = '';

  const asA = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');

    const stayA = await checkInGuest(a, { name: 'Priya Nair', phone: '+919820070001' });
    await checkInGuest(b, { name: 'Priya Nair', phone: '+919820070002' });

    await owner.query(
      `INSERT INTO orders (tenant_id, property_id, stay_id, outlet_id, order_number, status,
                           destination_label, placed_at)
       VALUES ($1, $2, $3, $4, 'KE-1186', 'PLACED', 'Room 214', now()),
              ($1, $2, $3, $4, 'KE-1187', 'DRAFT', 'Room 214', NULL)`,
      [a.tenantId, a.propertyId, stayA, a.outletId]);

    const admin = await owner.query<{ id: string }>(
      `SELECT id FROM staff_users WHERE tenant_id = $1 LIMIT 1`, [a.tenantId]);
    adminA = admin.rows[0]!.id;
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  describe('rooms', () => {
    it('finds a room by the start of its number', async () => {
      const hits = await asA((tx) => searchRooms(tx, { propertyId: a.propertyId, query: '21' }));
      expect(hits.map((h) => h.number)).toEqual(['214']);
      expect(hits[0]!.floorName).toBe('Ground');
    });

    it('does not match the middle of a number, or a LIKE wildcard', async () => {
      for (const query of ['14', '%', '_14']) {
        const hits = await asA((tx) => searchRooms(tx, { propertyId: a.propertyId, query }));
        expect(hits).toEqual([]);
      }
    });
  });

  describe('guests', () => {
    it('finds a guest anywhere in the name, with the room they are in', async () => {
      const hits = await asA((tx) => searchGuests(tx, { propertyId: a.propertyId, query: 'nair' }));
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ fullName: 'Priya Nair', inRoom: '214' });
    });

    it('never finds another hotel\'s guest of the same name', async () => {
      // B's Priya Nair exists; A's property and A's tenant see one.
      const hits = await asA((tx) => searchGuests(tx, { propertyId: b.propertyId, query: 'Priya' }));
      expect(hits).toEqual([]);
    });
  });

  describe('orders', () => {
    it.each(['KE-1186', 'ke1186', '1186', '#1186'])('finds KE-1186 from "%s"', async (typed) => {
      const needle = orderNeedle(typed)!;
      const hits = await asA((tx) => searchOrders(tx, { propertyId: a.propertyId, needle }));
      expect(hits.map((h) => h.orderNumber)).toEqual(['KE-1186']);
      expect(hits[0]!.roomId).toBe(a.roomId);
    });

    it('does not find a draft, which has no number anybody could quote', async () => {
      const hits = await asA((tx) => searchOrders(tx, { propertyId: a.propertyId, needle: '1187' }));
      expect(hits).toEqual([]);
    });
  });

  describe('appearance', () => {
    it('starts at "system" and keeps what the person picks', async () => {
      const before = await asA((tx) => consoleChrome(tx, {
        propertyId: a.propertyId, staffUserId: adminA,
      }));
      expect(before).toMatchObject({
        appearance: 'system', roomCount: 1, city: 'Udaipur', theme: 'kesari',
      });
      expect(before.roleNames.length).toBeGreaterThan(0);

      await asA((tx) => setConsoleAppearance(tx, { staffUserId: adminA, appearance: 'dark' }));
      const after = await asA((tx) => consoleChrome(tx, {
        propertyId: a.propertyId, staffUserId: adminA,
      }));
      expect(after.appearance).toBe('dark');
    });

    it('cannot reach an account in another tenant', async () => {
      await expect(withTenant({ tenantId: b.tenantId }, (tx) => setConsoleAppearance(tx, {
        staffUserId: adminA, appearance: 'light',
      }))).rejects.toThrow(/no longer available/);
    });

    it('holds only the three values', async () => {
      await expect(owner.query(
        `UPDATE staff_users SET console_appearance = 'auto' WHERE id = $1`, [adminA],
      )).rejects.toThrow(/staff_users_console_appearance_chk/);
    });
  });
});
