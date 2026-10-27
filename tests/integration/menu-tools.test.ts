import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  seedMenu, getDish, setDailyLimit, repriceCategory, duplicateMenuItem,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import { addToCart, placeOrder, advanceOrder, stayContext } from '@/modules/ordering';
import { findProperty } from '@/modules/identity';
import { localTimeAt } from '@/lib/clock';
import { ConflictError, ValidationError } from '@/lib/errors';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, type Fixture,
} from './setup';

/**
 * The menu studio's step 4: daily limits (D-086), a section repriced in one
 * go, and a dish duplicated. Placement reads the real clock, so the menu is
 * read at the property's real now here too, the same business date a claim
 * is made on.
 */
describe('menu tools', () => {
  let owner: pg.Client;
  let a: Fixture;
  let stayA: string;
  let stayB: string;
  const staff = '11111111-1111-4111-8111-111111111111';
  const laal = 'Laal maas with bajra roti';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);
  const base = () => ({
    tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId, actorStaffId: staff,
  });
  const now = async () => {
    const property = await scoped((tx) => findProperty(tx, a.propertyId));
    return localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata');
  };
  const dishNow = async (name: string) => {
    const at = await now();
    // The dish page reads one dish at a time: it is open whatever the hour,
    // so the test does not depend on the kitchen's hours or the collections.
    const id = (await owner.query<{ id: string }>(
      `SELECT id FROM menu_items WHERE tenant_id = $1 AND name = $2 AND archived_at IS NULL`,
      [a.tenantId, name])).rows[0]!.id;
    return (await scoped((tx) => getDish(tx, { propertyId: a.propertyId, itemId: id, at })))!.dish;
  };

  let dish = '';
  let chef = '';

  const order = (stayId: string, quantity: number, key: string) => scoped(async (tx) => {
    await addToCart(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context: stayContext(stayId),
      menuItemId: dish, quantity, modifierOptionIds: [chef],
    });
  }).then(() => scoped((tx) => placeOrder(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId, context: stayContext(stayId),
    destinationLabel: 'Room', idempotencyKey: key, accessTier: 'CHARGE',
  })));

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    await scoped((tx) => seedMenu(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId,
      categories: KESARI_CATEGORIES, items: KESARI_MENU,
      collections: KESARI_COLLECTIONS, modifierGroups: KESARI_MODIFIER_GROUPS,
    }));
    // Open around the clock, so "now" is always inside the kitchen's hours.
    await owner.query(`DELETE FROM outlet_hours WHERE outlet_id = $1`, [a.outletId]);
    for (let day = 0; day < 7; day++) {
      await owner.query(
        `INSERT INTO outlet_hours (tenant_id, outlet_id, day_of_week, opens_at, closes_at, crosses_midnight)
         VALUES ($1, $2, $3, '00:00', '23:59', false)`, [a.tenantId, a.outletId, day]);
    }
    stayA = await checkInGuest(a);
    const neighbour = (await owner.query<{ id: string }>(`
      INSERT INTO rooms (tenant_id, property_id, floor_id, room_type_id, number, status)
      VALUES ($1,$2,$3,$4,'215','AVAILABLE') RETURNING id`,
      [a.tenantId, a.propertyId, a.floorId, a.roomTypeId])).rows[0]!.id;
    stayB = await checkInGuest(a, { roomId: neighbour, name: 'Rhea Kapoor', phone: '+919820022222' });

    dish = (await owner.query<{ id: string }>(
      `SELECT id FROM menu_items WHERE tenant_id = $1 AND name = $2`, [a.tenantId, laal])).rows[0]!.id;
    const detail = await scoped((tx) => getDish(tx, { propertyId: a.propertyId, itemId: dish }));
    chef = detail!.modifierGroups.flatMap((g) => g.options)
      .find((o) => o.name === 'As the chef makes it')!.id;
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['order_item_modifiers', 'order_items', 'orders', 'folio_lines', 'folios',
                     'cart_item_modifiers', 'cart_items', 'carts', 'idempotency_keys',
                     'menu_item_daily_sales']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [a.tenantId]);
    }
    await owner.query(`UPDATE menu_items SET daily_limit = NULL WHERE tenant_id = $1`, [a.tenantId]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  describe('daily limits (D-086)', () => {
    it('counts down, sells out, and refuses the next order by name', async () => {
      await scoped((tx) => setDailyLimit(tx, { ...base(), itemId: dish, dailyLimit: 3 }));
      expect((await dishNow(laal)).remainingToday).toBe(3);

      await order(stayA, 2, 'limit-1');
      expect((await dishNow(laal)).remainingToday).toBe(1);

      // Two wanted, one left: the order is refused and nothing is written.
      await expect(order(stayB, 2, 'limit-2')).rejects.toThrow(/Only 1 Laal maas/);
      const count = (await owner.query(`SELECT count(*)::int AS n FROM orders WHERE tenant_id = $1`,
        [a.tenantId])).rows[0].n;
      expect(count).toBe(1);
    });

    it('marks a sold-out dish off, and a rejection gives the portions back', async () => {
      await scoped((tx) => setDailyLimit(tx, { ...base(), itemId: dish, dailyLimit: 2 }));
      const placed = await order(stayA, 2, 'limit-3');
      expect(await dishNow(laal)).toMatchObject({ remainingToday: 0, isAvailable: false });

      await scoped((tx) => advanceOrder(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, orderId: placed.orderId,
        to: 'REJECTED', reason: 'Out of mutton', actor: { kind: 'STAFF', staffUserId: staff },
      }));
      expect(await dishNow(laal)).toMatchObject({ remainingToday: 2, isAvailable: true });
    });

    it('gives the last portion to exactly one of two guests ordering at once', async () => {
      await scoped((tx) => setDailyLimit(tx, { ...base(), itemId: dish, dailyLimit: 1 }));
      const results = await Promise.allSettled([
        order(stayA, 1, 'race-a'),
        order(stayB, 1, 'race-b'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(ConflictError);
      const sold = (await owner.query(
        `SELECT sold FROM menu_item_daily_sales WHERE menu_item_id = $1`, [dish])).rows[0].sold;
      expect(sold).toBe(1);
    });

    it('leaves a dish without a limit alone, and logs a limit when set', async () => {
      await order(stayA, 5, 'no-limit');
      expect((await dishNow(laal)).remainingToday).toBeNull();
      await scoped((tx) => setDailyLimit(tx, { ...base(), itemId: dish, dailyLimit: 20 }));
      const events = await scoped((tx) => readEventHistory(tx, 'menu_item', dish));
      expect(events.some((e) => e.event_type === 'menu_item.daily_limit_set')).toBe(true);
      await expect(scoped((tx) => setDailyLimit(tx, { ...base(), itemId: dish, dailyLimit: 0 })))
        .rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('a section repriced in one go', () => {
    it('moves every dish by the percentage, rounded, and logs each one', async () => {
      const sweets = (await owner.query<{ category_id: string }>(
        `SELECT category_id FROM menu_items WHERE tenant_id = $1 AND name = 'Mawa kachori'`,
        [a.tenantId])).rows[0]!.category_id;
      const before = (await owner.query(
        `SELECT id, price_minor FROM menu_items WHERE category_id = $1`, [sweets])).rows;

      const result = await scoped((tx) => repriceCategory(tx, {
        ...base(), categoryId: sweets, percentBps: 500, stepMinor: 1_000,
      }));
      expect(result.changed).toBe(before.length);

      // ₹380 + 5% = ₹399 → ₹400.
      const after = (await owner.query(
        `SELECT price_minor FROM menu_items WHERE category_id = $1`, [sweets])).rows;
      expect(after.map((r) => r.price_minor)).toContain(40_000);
      const events = await scoped((tx) => readEventHistory(tx, 'menu_item', before[0].id));
      expect(events.some((e) => e.event_type === 'menu_item.repriced')).toBe(true);
    });
  });

  describe('duplicate a dish', () => {
    it('copies it under the original, off, with its choices', async () => {
      const copy = await scoped((tx) => duplicateMenuItem(tx, { ...base(), itemId: dish }));
      expect(copy.name).toBe(`${laal} (copy)`);

      const row = (await owner.query(
        `SELECT is_available, price_minor FROM menu_items WHERE id = $1`, [copy.id])).rows[0];
      expect(row).toEqual({ is_available: false, price_minor: 115_000 });

      const groups = (await owner.query(
        `SELECT count(*)::int AS n FROM menu_item_modifier_groups WHERE menu_item_id = $1`,
        [copy.id])).rows[0].n;
      const original = (await owner.query(
        `SELECT count(*)::int AS n FROM menu_item_modifier_groups WHERE menu_item_id = $1`,
        [dish])).rows[0].n;
      expect(groups).toBe(original);

      // Directly under the original in its section.
      const order = (await owner.query(
        `SELECT name FROM menu_items WHERE category_id = (SELECT category_id FROM menu_items WHERE id = $1)
           AND archived_at IS NULL ORDER BY sort_order`, [dish])).rows.map((r) => r.name);
      expect(order.indexOf(`${laal} (copy)`)).toBe(order.indexOf(laal) + 1);
    });
  });
});
