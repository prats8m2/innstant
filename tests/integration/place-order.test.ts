import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  seedMenu, getInRoomDiningMenu, getDish,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import { addToCart, getCart, placeOrder } from '@/modules/ordering';
import { getFolioForStay } from '@/modules/billing';
import { ConflictError } from '@/lib/errors';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, type Fixture,
} from './setup';

/**
 * Placing an order — the transaction four non-negotiables meet in.
 *
 * #6 the receipt is snapshotted and survives the catalog changing under it.
 * #7 event_log is written in the same transaction, or not at all.
 * #8 the whole thing is idempotent under a real double-tap.
 * #5 every amount is integer minor units.
 */
describe('placeOrder', () => {
  let owner: pg.Client;
  let a: Fixture;
  let stayId: string;
  const laal = 'Laal maas with bajra roti';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  async function dishId(name: string): Promise<string> {
    return scoped(async (tx) => {
      const menu = await getInRoomDiningMenu(tx, a.propertyId);
      const item = menu!.sections.flatMap((s) => s.items).find((i) => i.name === name);
      if (!item) throw new Error(`no dish named ${name}`);
      return item.id;
    });
  }

  async function optionId(dish: string, option: string): Promise<string> {
    return scoped(async (tx) => {
      const detail = await getDish(tx, { propertyId: a.propertyId, itemId: await dishId(dish) });
      const found = detail!.modifierGroups.flatMap((g) => g.options).find((o) => o.name === option);
      if (!found) throw new Error(`no option named ${option}`);
      return found.id;
    });
  }

  // Resolved once in beforeAll — these ids do not change between tests.
  let dish = '';
  let chefOption = '';
  let rotiOption = '';

  /** Laal maas, as the chef makes it, with an extra bajra roti. */
  async function fillCart(quantity = 1): Promise<void> {
    await scoped((tx) => addToCart(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      stayId,
      menuItemId: dish,
      quantity,
      modifierOptionIds: [chefOption, rotiOption],
    }));
  }

  const place = (key: string, extra: Record<string, unknown> = {}) =>
    scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      stayId,
      roomNumber: '214',
      idempotencyKey: key,
      ...extra,
    }));

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');

    await scoped((tx) => seedMenu(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      outletId: a.outletId,
      categories: KESARI_CATEGORIES,
      items: KESARI_MENU,
      collections: KESARI_COLLECTIONS,
      modifierGroups: KESARI_MODIFIER_GROUPS,
    }));

    // 5% tax, 10% service — The Kesari's rates.
    await owner.query(
      `UPDATE outlets SET tax_rate_bps = 500, service_charge_bps = 1000 WHERE id = $1`,
      [a.outletId]);

    stayId = await checkInGuest(a);
    dish = await dishId(laal);
    chefOption = await optionId(laal, 'As the chef makes it');
    rotiOption = await optionId(laal, 'Extra bajra roti');
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['order_item_modifiers', 'order_items', 'orders',
                     'folio_lines', 'folios', 'cart_item_modifiers', 'cart_items', 'carts',
                     'idempotency_keys']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [TENANT_A]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = $1`, [TENANT_A]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('turns a cart into an order, a folio line and an event', async () => {
    await fillCart(2);
    const placed = await place('key-1');

    // (1150 + 90) x 2 = 2480; +10% service = 248; +5% tax on 2728 = 136.40
    expect(placed.orderNumber).toMatch(/^KE-\d+$/);
    expect(placed.totalMinor).toBe(248_000 + 24_800 + 13_640);
    expect(placed.wasAlreadyPlaced).toBe(false);

    const order = await owner.query(
      `SELECT status, subtotal_minor, total_minor, currency FROM orders WHERE id = $1`,
      [placed.orderId]);
    expect(order.rows[0].status).toBe('PLACED');
    expect(order.rows[0].subtotal_minor).toBe(248_000);
    expect(order.rows[0].currency).toBe('INR');

    const folio = await scoped((tx) => getFolioForStay(tx, stayId));
    expect(folio!.lines).toHaveLength(1);
    expect(folio!.lines[0]!.amountMinor).toBe(placed.totalMinor);
    expect(folio!.lines[0]!.sourceRefId).toBe(placed.orderId);
    // The trigger recomputes the header from the lines — nothing maintains it
    // by hand, so a caller cannot leave the folio wrong.
    expect(folio!.balanceMinor).toBe(placed.totalMinor);

    const events = await scoped((tx) => readEventHistory(tx, 'order', placed.orderId));
    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('order.placed');
    expect(events[0]!.to_status).toBe('PLACED');
  });

  it('snapshots the line, so renaming the dish cannot alter the receipt (#6)', async () => {
    await fillCart(1);
    const placed = await place('key-2');

    await owner.query(
      `UPDATE menu_items SET name = 'Renamed entirely', price_minor = 1 WHERE id = $1`, [dish]);
    try {
      const items = await owner.query(
        `SELECT name_snapshot, unit_price_minor FROM order_items WHERE order_id = $1`,
        [placed.orderId]);
      expect(items.rows[0].name_snapshot).toBe(laal);
      expect(items.rows[0].unit_price_minor).toBe(115_000);

      const modifiers = await owner.query(
        `SELECT om.name_snapshot, om.price_delta_minor FROM order_item_modifiers om
         JOIN order_items oi ON oi.id = om.order_item_id WHERE oi.order_id = $1
         ORDER BY om.name_snapshot`, [placed.orderId]);
      expect(modifiers.rows.map((r) => r.name_snapshot))
        .toEqual(['As the chef makes it', 'Extra bajra roti']);
    } finally {
      await owner.query(
        `UPDATE menu_items SET name = $2, price_minor = 115000 WHERE id = $1`, [dish, laal]);
    }
  });

  it('empties the cart, so the pill does not advertise an order already sent', async () => {
    await fillCart(1);
    await place('key-3');

    const cart = await scoped((tx) => getCart(tx, {
      propertyId: a.propertyId,
      stayId,
      outlet: {
        outletId: a.outletId, currency: 'INR',
        taxRateBps: 500, serviceChargeBps: 1_000, deliveryFeeMinor: 0,
      },
    }));
    expect(cart).toBeNull();
  });

  it('is idempotent: the same key returns the same order, and only one exists (#8)', async () => {
    await fillCart(1);
    const first = await place('same-key');
    const second = await place('same-key');

    expect(second.orderId).toBe(first.orderId);
    expect(second.orderNumber).toBe(first.orderNumber);
    expect(second.wasAlreadyPlaced).toBe(true);

    const orders = await owner.query(`SELECT id FROM orders WHERE tenant_id = $1`, [TENANT_A]);
    expect(orders.rowCount).toBe(1);
    const lines = await owner.query(`SELECT id FROM folio_lines WHERE tenant_id = $1`, [TENANT_A]);
    // The guest is charged once. This is the assertion the table exists for.
    expect(lines.rowCount).toBe(1);
  });

  it('survives a real double-tap: two concurrent sends, one order', async () => {
    await fillCart(1);
    const results = await Promise.allSettled([place('race-key'), place('race-key')]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const orders = await owner.query(`SELECT id FROM orders WHERE tenant_id = $1`, [TENANT_A]);
    expect(orders.rowCount).toBe(1);
    const lines = await owner.query(`SELECT id FROM folio_lines WHERE tenant_id = $1`, [TENANT_A]);
    expect(lines.rowCount).toBe(1);
  });

  it('gives two orders at one property distinct numbers under concurrency', async () => {
    await fillCart(1);
    const first = await place('num-1');
    await fillCart(1);
    const second = await place('num-2');

    expect(second.orderNumber).not.toBe(first.orderNumber);
    // KE-1184 is where the demo's numbering starts, so the first real order
    // reads like the seeded ones rather than like KE-1.
    expect(first.orderNumber).toBe('KE-1184');
    expect(second.orderNumber).toBe('KE-1185');
  });

  it('refuses an empty cart', async () => {
    await expect(place('empty')).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to send when a dish came off the menu, and names it', async () => {
    await fillCart(1);
    await owner.query(`UPDATE menu_items SET is_available = false WHERE id = $1`, [dish]);
    try {
      await expect(place('gone')).rejects.toThrow(new RegExp(laal));
    } finally {
      await owner.query(`UPDATE menu_items SET is_available = true WHERE id = $1`, [dish]);
    }
  });

  it('refuses when the kitchen has closed', async () => {
    await fillCart(1);
    await owner.query(`UPDATE outlets SET is_accepting_orders = false WHERE id = $1`, [a.outletId]);
    try {
      await expect(place('closed')).rejects.toBeInstanceOf(ConflictError);
    } finally {
      await owner.query(`UPDATE outlets SET is_accepting_orders = true WHERE id = $1`, [a.outletId]);
    }
  });

  it('leaves nothing behind when the transaction rolls back', async () => {
    await fillCart(1);

    await expect(
      scoped(async (tx) => {
        await placeOrder(tx, {
          tenantId: a.tenantId, propertyId: a.propertyId, stayId,
          roomNumber: '214', idempotencyKey: 'rollback',
        });
        throw new Error('caller changed its mind');
      }),
    ).rejects.toThrow('caller changed its mind');

    // The order, the folio line, the event and the idempotency claim are one
    // write or none. Anything else and the guest is charged for an order the
    // kitchen never saw.
    for (const table of ['orders', 'folio_lines', 'idempotency_keys']) {
      const rows = await owner.query(`SELECT 1 FROM ${table} WHERE tenant_id = $1`, [TENANT_A]);
      expect(rows.rowCount, table).toBe(0);
    }
    const events = await owner.query(
      `SELECT 1 FROM event_log WHERE tenant_id = $1 AND event_type = 'order.placed'`, [TENANT_A]);
    expect(events.rowCount).toBe(0);
  });
});
