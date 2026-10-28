import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  seedMenu, getInRoomDiningMenu, getDish, createOffer, updateOffer, archiveOffer, listOffers,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import { addToCart, getCart, placeOrder, stayContext } from '@/modules/ordering';
import { NotFoundError, ValidationError } from '@/lib/errors';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * Automatic offers (D-085), through the money path: the menu read, the cart,
 * placeOrder()'s snapshot, and the folio it posts to. Placement reads the
 * real clock, so the offers placed under here have no schedule; schedules
 * are tested through the menu read at a chosen moment.
 */
const AT_NINE_PM = { dayOfWeek: 3, minutes: 21 * 60, date: '2026-10-28' };

describe('menu offers', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let stayId: string;
  const staff = '11111111-1111-4111-8111-111111111111';
  const laal = 'Laal maas with bajra roti';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);
  const base = () => ({
    tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId, actorStaffId: staff,
  });

  const menuAt = (at: { dayOfWeek: number; minutes: number; date?: string }) =>
    scoped((tx) => getInRoomDiningMenu(tx, a.propertyId, at));
  const dishAt = async (name: string, at = AT_NINE_PM) =>
    (await menuAt(at))!.sections.flatMap((s) => s.items).find((i) => i.name === name)!;

  let dish = '';
  let category = '';
  let chef = '';
  let roti = '';

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
    await scoped((tx) => seedMenu(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId,
      categories: KESARI_CATEGORIES, items: KESARI_MENU,
      collections: KESARI_COLLECTIONS, modifierGroups: KESARI_MODIFIER_GROUPS,
    }));
    await owner.query(
      `UPDATE outlets SET tax_rate_bps = 500, service_charge_bps = 1000 WHERE id = $1`,
      [a.outletId]);
    stayId = await checkInGuest(a);

    const found = await dishAt(laal);
    dish = found.id;
    category = (await owner.query<{ category_id: string }>(
      `SELECT category_id FROM menu_items WHERE id = $1`, [dish])).rows[0]!.category_id;
    const detail = await scoped((tx) => getDish(tx, { propertyId: a.propertyId, itemId: dish }));
    const options = detail!.modifierGroups.flatMap((g) => g.options);
    chef = options.find((o) => o.name === 'As the chef makes it')!.id;
    roti = options.find((o) => o.name === 'Extra bajra roti')!.id;
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['order_item_modifiers', 'order_items', 'orders', 'folio_lines', 'folios',
                     'cart_item_modifiers', 'cart_items', 'carts', 'idempotency_keys', 'menu_offers']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [a.tenantId, b.tenantId]);
    }
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('shows the offer price, the list price, and what it is called', async () => {
    await scoped((tx) => createOffer(tx, {
      ...base(), name: 'Chef’s week', scope: 'DISH', menuItemId: dish, kind: 'PERCENT', percentBps: 2000,
    }));
    const found = await dishAt(laal);
    expect(found).toMatchObject({
      priceMinor: 92_000, listPriceMinor: 115_000, offer: { name: 'Chef’s week', label: '20% off' },
    });
    // The dish page reads the same price.
    const detail = await scoped((tx) => getDish(tx, { propertyId: a.propertyId, itemId: dish, at: AT_NINE_PM }));
    expect(detail!.dish.priceMinor).toBe(92_000);
  });

  it('runs on its schedule: a happy hour is the list price outside it', async () => {
    await scoped((tx) => createOffer(tx, {
      ...base(), name: 'Happy hour', scope: 'MENU', kind: 'PERCENT', percentBps: 2500,
      availableFrom: '15:00', availableUntil: '18:00',
    }));
    expect((await dishAt(laal, { ...AT_NINE_PM, minutes: 16 * 60 })).priceMinor).toBe(86_250);
    expect(await dishAt(laal, AT_NINE_PM)).toMatchObject({ priceMinor: 115_000, offer: null });
  });

  it('never stacks: the best one of a dish, a section and a menu offer wins', async () => {
    await scoped(async (tx) => {
      await createOffer(tx, { ...base(), name: 'Everything 10%', scope: 'MENU', kind: 'PERCENT', percentBps: 1000 });
      await createOffer(tx, { ...base(), name: 'Mains ₹300', scope: 'CATEGORY', categoryId: category, kind: 'AMOUNT', amountMinor: 30_000 });
      await createOffer(tx, { ...base(), name: 'Laal 20%', scope: 'DISH', menuItemId: dish, kind: 'PERCENT', percentBps: 2000 });
    });
    expect(await dishAt(laal)).toMatchObject({ priceMinor: 85_000, offer: { name: 'Mains ₹300' } });
  });

  it('prices the cart, places the order, and the receipt says why', async () => {
    await scoped((tx) => createOffer(tx, {
      ...base(), name: 'Chef’s week', scope: 'DISH', menuItemId: dish, kind: 'PERCENT', percentBps: 2000,
    }));
    await scoped((tx) => addToCart(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context: stayContext(stayId),
      menuItemId: dish, quantity: 2, modifierOptionIds: [chef, roti],
    }));

    const cart = await scoped((tx) => getCart(tx, {
      propertyId: a.propertyId, context: stayContext(stayId), at: AT_NINE_PM,
      outlet: { outletId: a.outletId, currency: 'INR', taxRateBps: 500, serviceChargeBps: 1000, deliveryFeeMinor: 0 },
    }));
    // The offer comes off the dish (₹1,150 → ₹920), not the roti (₹90).
    expect(cart!.lines[0]).toMatchObject({ unitPriceMinor: 92_000, listPriceMinor: 115_000 });
    expect(cart!.lines[0]!.lineTotalMinor).toBe((92_000 + 9_000) * 2);

    const placed = await scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context: stayContext(stayId),
      destinationLabel: 'Room 214', idempotencyKey: 'offer-1', accessTier: 'CHARGE',
    }));

    const line = (await owner.query(
      `SELECT unit_price_minor, list_price_minor, offer_name_snapshot, line_total_minor
         FROM order_items WHERE order_id = $1`, [placed.orderId])).rows[0];
    expect(line).toMatchObject({
      unit_price_minor: 92_000, list_price_minor: 115_000,
      offer_name_snapshot: 'Chef’s week', line_total_minor: 202_000,
    });

    // The bill is the discounted one: subtotal ₹2,020, +10% service, +5% tax on both.
    const order = (await owner.query(
      `SELECT subtotal_minor, total_minor FROM orders WHERE id = $1`, [placed.orderId])).rows[0];
    expect(order.subtotal_minor).toBe(202_000);
    expect(order.total_minor).toBe(202_000 + 20_200 + 11_110);

    // Renaming the offer, or archiving it, does not rewrite the receipt (#6).
    const [offer] = await scoped((tx) => listOffers(tx, { outletId: a.outletId }));
    await scoped((tx) => archiveOffer(tx, { ...base(), offerId: offer!.id }));
    const after = (await owner.query(
      `SELECT unit_price_minor, offer_name_snapshot FROM order_items WHERE order_id = $1`,
      [placed.orderId])).rows[0];
    expect(after).toMatchObject({ unit_price_minor: 92_000, offer_name_snapshot: 'Chef’s week' });
    // And the next guest pays the list price again.
    expect((await dishAt(laal)).priceMinor).toBe(115_000);
  });

  it('places twice on one key as one order at the offer price', async () => {
    await scoped((tx) => createOffer(tx, {
      ...base(), name: 'Everything 10%', scope: 'MENU', kind: 'PERCENT', percentBps: 1000,
    }));
    await scoped((tx) => addToCart(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context: stayContext(stayId),
      menuItemId: dish, quantity: 1, modifierOptionIds: [chef],
    }));
    const place = () => scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context: stayContext(stayId),
      destinationLabel: 'Room 214', idempotencyKey: 'offer-twice', accessTier: 'CHARGE',
    }));
    const results = await Promise.allSettled([place(), place()]);
    const ids = new Set(results.filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<{ orderId: string }>).value.orderId));
    expect(ids.size).toBe(1);
    const lines = (await owner.query(
      `SELECT unit_price_minor FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.tenant_id = $1`, [a.tenantId])).rows;
    expect(lines).toEqual([{ unit_price_minor: 103_500 }]);
  });

  it('refuses an offer that cannot mean anything', async () => {
    const refuse = (patch: Record<string, unknown>) => expect(scoped((tx) => createOffer(tx, {
      ...base(), name: 'Bad', scope: 'MENU', kind: 'PERCENT', percentBps: 1000, ...patch,
    } as Parameters<typeof createOffer>[1]))).rejects.toBeInstanceOf(ValidationError);

    await refuse({ name: '  ' });
    await refuse({ percentBps: 0 });
    await refuse({ percentBps: 10_001 });
    await refuse({ kind: 'AMOUNT', percentBps: null, amountMinor: 0 });
    await refuse({ scope: 'DISH', menuItemId: null });
    await refuse({ scope: 'DISH', menuItemId: '55555555-5555-4555-8555-555555555555' });
    await refuse({ availableFrom: '15:00' });
    await refuse({ startsOn: '2026-11-05', endsOn: '2026-11-01' });
  });

  it('records what the offer was, every time it changes', async () => {
    const { id } = await scoped((tx) => createOffer(tx, {
      ...base(), name: 'Happy hour', scope: 'MENU', kind: 'PERCENT', percentBps: 2000,
    }));
    await scoped((tx) => updateOffer(tx, {
      ...base(), offerId: id, name: 'Happy hour', scope: 'MENU', kind: 'PERCENT', percentBps: 2500,
    }));
    await scoped((tx) => archiveOffer(tx, { ...base(), offerId: id }));
    const events = await scoped((tx) => readEventHistory(tx, 'menu_offer', id));
    expect(events.map((e) => e.event_type))
      .toEqual(['menu_offer.created', 'menu_offer.updated', 'menu_offer.archived']);
    expect((events[1]!.payload as { percentBps: number }).percentBps).toBe(2500);
  });

  it('is invisible to another property, and cannot be aimed at its dishes', async () => {
    await scoped((tx) => createOffer(tx, {
      ...base(), name: 'Ours', scope: 'MENU', kind: 'PERCENT', percentBps: 1000,
    }));
    const theirs = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => listOffers(tx, { outletId: a.outletId }),
    );
    expect(theirs).toEqual([]);

    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => createOffer(tx, {
        tenantId: b.tenantId, propertyId: b.propertyId, outletId: b.outletId, actorStaffId: staff,
        name: 'Theirs', scope: 'DISH', menuItemId: dish, kind: 'PERCENT', percentBps: 1000,
      }),
    )).rejects.toBeInstanceOf(ValidationError);

    const [ours] = await scoped((tx) => listOffers(tx, { outletId: a.outletId }));
    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => archiveOffer(tx, {
        tenantId: b.tenantId, propertyId: b.propertyId, outletId: b.outletId,
        offerId: ours!.id, actorStaffId: staff,
      }),
    )).rejects.toBeInstanceOf(NotFoundError);
  });
});
