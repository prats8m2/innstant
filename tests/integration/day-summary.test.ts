import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant } from '@/db';
import {
  seedMenu, getDish, KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import { addToCart, placeOrder, advanceOrder, daySummary, stayContext } from '@/modules/ordering';
import { localTimeAt } from '@/lib/clock';
import { ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, type Fixture } from './setup';

/**
 * The overview's day summary: what counts as a sale, the hotel's own day,
 * the comparison with yesterday at the same hour, and the top dishes.
 */
describe('daySummary', () => {
  let owner: pg.Client;
  let a: Fixture;
  let stayId: string;
  const staff = '11111111-1111-4111-8111-111111111111';
  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);
  const summary = () => scoped((tx) => daySummary(tx, {
    propertyId: a.propertyId, timeZone: 'Asia/Kolkata', currency: 'INR',
  }));

  async function order(name: string, quantity: number, key: string) {
    const id = (await owner.query<{ id: string }>(
      `SELECT id FROM menu_items WHERE tenant_id = $1 AND name = $2`, [a.tenantId, name])).rows[0]!.id;
    const detail = await scoped((tx) => getDish(tx, { propertyId: a.propertyId, itemId: id }));
    const defaults = detail!.modifierGroups.flatMap((g) => g.options.filter((o) => o.isDefault).map((o) => o.id));
    await scoped((tx) => addToCart(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context: stayContext(stayId),
      menuItemId: id, quantity, modifierOptionIds: defaults,
    }));
    return scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context: stayContext(stayId),
      destinationLabel: 'Room 214', idempotencyKey: key, accessTier: 'CHARGE',
    }));
  }

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
    // Open around the clock, so placing an order never depends on the hour.
    await owner.query(`DELETE FROM outlet_hours WHERE outlet_id = $1`, [a.outletId]);
    for (let day = 0; day < 7; day++) {
      await owner.query(
        `INSERT INTO outlet_hours (tenant_id, outlet_id, day_of_week, opens_at, closes_at, crosses_midnight)
         VALUES ($1, $2, $3, '00:00', '23:59', false)`, [a.tenantId, a.outletId, day]);
    }
    stayId = await checkInGuest(a);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('counts sales, leaves out rejections, and ranks the dishes', async () => {
    await order('Masala chai', 3, 'day-1');
    await order('Laal maas with bajra roti', 1, 'day-2');
    const rejected = await order('Kesar lassi', 2, 'day-3');
    await scoped((tx) => advanceOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, orderId: rejected.orderId,
      to: 'REJECTED', reason: 'Out of saffron', actor: { kind: 'STAFF', staffUserId: staff },
    }));

    const day = await summary();
    expect(day.today.orders).toBe(2);
    expect(day.today.rejected).toBe(1);

    const totals = (await owner.query<{ total: number }>(
      `SELECT sum(total_minor)::int AS total FROM orders
        WHERE tenant_id = $1 AND status NOT IN ('REJECTED', 'CANCELLED')`, [a.tenantId])).rows[0]!.total;
    expect(day.today.salesMinor).toBe(totals);
    expect(day.today.averageOrderMinor).toBe(Math.round(totals / 2));

    // By quantity: three chai before one laal maas; the rejected lassi is not a sale.
    expect(day.topDishes.map((d) => d.name)).toEqual(['Masala chai', 'Laal maas with bajra roti']);
    expect(day.topDishes[0]!.quantity).toBe(3);

    // Counted in the hotel's current hour.
    const hour = Math.floor(localTimeAt(new Date(), 'Asia/Kolkata').minutes / 60);
    expect(day.byHour[hour]).toBe(2);
    expect(day.byHour.reduce((n, x) => n + x, 0)).toBe(2);
  });

  it('compares with yesterday up to the same time, not all of yesterday', async () => {
    // One of today's orders, moved to yesterday an hour earlier than now.
    await owner.query(`
      UPDATE orders SET placed_at = now() - interval '1 day 1 hour'
       WHERE id = (SELECT id FROM orders WHERE tenant_id = $1 AND status <> 'REJECTED' ORDER BY placed_at LIMIT 1)`,
      [a.tenantId]);
    const day = await summary();
    expect(day.today.orders).toBe(1);
    // Yesterday-so-far counts it only if yesterday at that hour was still yesterday.
    const local = localTimeAt(new Date(), 'Asia/Kolkata');
    expect(day.yesterdaySoFar.orders).toBe(local.minutes >= 60 ? 1 : 0);
  });
});
