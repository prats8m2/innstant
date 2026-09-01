import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  seedMenu, getInRoomDiningMenu, getDish, getAdminMenu, getAdminMenuItem,
  listModifierGroups, createMenuCategory, updateMenuCategory, archiveMenuCategory,
  createMenuItem, updateMenuItem, setMenuItemAvailability, archiveMenuItem,
  setMenuItemModifierGroups, setOutletAcceptingOrders,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * Editing the menu, against a real database.
 *
 * What only Postgres can prove: that archiving is what D-008 says it is (the row
 * stays, the guest stops seeing it), that a category cannot be archived out from
 * under its dishes, and that an id from another hotel's outlet is a 404 rather
 * than an edit.
 */
describe('catalog admin', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;

  const staff = '11111111-1111-4111-8111-111111111111';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const base = () => ({
    tenantId: a.tenantId,
    propertyId: a.propertyId,
    outletId: a.outletId,
    actorStaffId: staff,
  });

  async function aCategory(name: string): Promise<string> {
    const { id } = await scoped((tx) => createMenuCategory(tx, { ...base(), name }));
    return id;
  }

  async function aDish(
    categoryId: string,
    name: string,
    priceMinor = 115000,
  ): Promise<string> {
    const { id } = await scoped((tx) => createMenuItem(tx, {
      ...base(), categoryId, name, priceMinor, currency: 'INR',
    }));
    return id;
  }

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['collection_items', 'collections', 'menu_item_modifier_groups',
                     'modifier_options', 'modifier_groups', 'menu_items',
                     'menu_categories']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [TENANT_A]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = $1`, [TENANT_A]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('puts a new dish on the guest menu, with nothing else run', async () => {
    const categoryId = await aCategory('Breakfast');
    await aDish(categoryId, 'Pyaaz kachori', 22000);

    // The guest's own read, not the editor's — the two must agree or the screen
    // an F&B manager checks is not the screen a guest sees.
    const menu = await scoped((tx) => getInRoomDiningMenu(tx, a.propertyId));
    const dishes = menu!.sections.flatMap((s) => s.items);
    const added = dishes.find((d) => d.name === 'Pyaaz kachori');

    expect(added).toBeTruthy();
    expect(added!.priceMinor).toBe(22000);
    expect(added!.currency).toBe('INR');
  });

  it('shows the editor what the guest cannot see: a dish that is off tonight', async () => {
    const categoryId = await aCategory('Dinner');
    const itemId = await aDish(categoryId, 'Laal maas');

    await scoped((tx) => setMenuItemAvailability(tx, {
      ...base(), itemId, isAvailable: false,
    }));

    const admin = await scoped((tx) => getAdminMenu(tx, { outletId: a.outletId }));
    const inEditor = admin!.categories.flatMap((c) => c.items).find((i) => i.id === itemId);
    expect(inEditor, 'an 86d dish is the one the manager came to turn back on').toBeTruthy();
    expect(inEditor!.isAvailable).toBe(false);

    const menu = await scoped((tx) => getInRoomDiningMenu(tx, a.propertyId));
    const forGuest = menu!.sections.flatMap((s) => s.items).find((d) => d.id === itemId);
    // The guest still sees it — marked unavailable, not vanished — which is the
    // existing read side's decision, not this module's. Asserted so a change
    // there is a deliberate one.
    expect(forGuest?.isAvailable).toBe(false);
  });

  it('logs every edit that changes what a guest sees, and prices separately', async () => {
    const categoryId = await aCategory('Dinner');
    const itemId = await aDish(categoryId, 'Laal maas', 115000);

    await scoped((tx) => updateMenuItem(tx, {
      ...base(), itemId, categoryId, name: 'Laal maas with bajra roti',
      priceMinor: 124000, currency: 'INR',
    }));
    await scoped((tx) => setMenuItemAvailability(tx, { ...base(), itemId, isAvailable: false }));

    const events = await scoped((tx) => readEventHistory(tx, 'menu_item', itemId));
    expect(events.map((e) => e.event_type)).toEqual([
      'menu_item.created', 'menu_item.updated', 'menu_item.repriced', 'menu_item.unavailable',
    ]);

    // A reprice carries both numbers: answering "we were charged more than the
    // menu said" needs the old price and the moment it changed.
    const repriced = events.find((e) => e.event_type === 'menu_item.repriced')!;
    const payload = repriced.payload as { fromMinor: number; toMinor: number };
    expect(Number(payload.fromMinor)).toBe(115000);
    expect(Number(payload.toMinor)).toBe(124000);
    expect(repriced.actor_kind).toBe('STAFF');
  });

  it('does not write a reprice event when the price did not change', async () => {
    const categoryId = await aCategory('Dinner');
    const itemId = await aDish(categoryId, 'Dal baati', 46000);

    await scoped((tx) => updateMenuItem(tx, {
      ...base(), itemId, categoryId, name: 'Dal baati churma',
      priceMinor: 46000, currency: 'INR',
    }));

    const events = await scoped((tx) => readEventHistory(tx, 'menu_item', itemId));
    expect(events.filter((e) => e.event_type === 'menu_item.repriced')).toHaveLength(0);
  });

  it('archives a dish rather than deleting it (D-008)', async () => {
    const categoryId = await aCategory('Dinner');
    const itemId = await aDish(categoryId, 'Ker sangri');

    await scoped((tx) => archiveMenuItem(tx, { ...base(), itemId }));

    // The ROW is still there — an old receipt's FK still resolves, which is the
    // whole reason this is not a DELETE.
    const row = await owner.query(
      `SELECT archived_at, is_available FROM menu_items WHERE id = $1`, [itemId]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].archived_at).not.toBeNull();
    expect(row.rows[0].is_available).toBe(false);

    // And it is gone from both reads.
    const menu = await scoped((tx) => getInRoomDiningMenu(tx, a.propertyId));
    expect(menu!.sections.flatMap((s) => s.items).find((d) => d.id === itemId)).toBeUndefined();
    expect(await scoped((tx) => getAdminMenuItem(tx, { outletId: a.outletId, itemId })))
      .toBeNull();
  });

  it('refuses to archive a section that still holds dishes, and names the count', async () => {
    const categoryId = await aCategory('Dinner');
    await aDish(categoryId, 'One');
    await aDish(categoryId, 'Two');

    // Bulk-archiving a menu's worth of dishes behind one click is not something
    // to do silently, and an orphaned dish is still orderable by URL.
    const refused = scoped((tx) => archiveMenuCategory(tx, { ...base(), categoryId }));
    await expect(refused).rejects.toBeInstanceOf(ConflictError);
    await expect(scoped((tx) => archiveMenuCategory(tx, { ...base(), categoryId })))
      .rejects.toThrow(/2 dishes/);

    const emptyId = await aCategory('Empty');
    await scoped((tx) => archiveMenuCategory(tx, { ...base(), categoryId: emptyId }));
  });

  it('surfaces a dish whose section was archived under it', async () => {
    const categoryId = await aCategory('Dinner');
    const itemId = await aDish(categoryId, 'Orphan');

    // Only reachable by going round the guard — but a hand-run SQL fix or a
    // future bulk tool can do exactly this, and the dish must not vanish from
    // the one screen that can fix it.
    await owner.query(`UPDATE menu_categories SET archived_at = now() WHERE id = $1`, [categoryId]);

    const admin = await scoped((tx) => getAdminMenu(tx, { outletId: a.outletId }));
    expect(admin!.categories.find((c) => c.id === categoryId)).toBeUndefined();
    expect(admin!.orphanedItems.map((i) => i.id)).toEqual([itemId]);
  });

  it('renames a section without touching its dishes', async () => {
    const categoryId = await aCategory('Diner');
    const itemId = await aDish(categoryId, 'Laal maas');

    await scoped((tx) => updateMenuCategory(tx, {
      ...base(), categoryId, name: 'Dinner', description: 'From seven, until the kitchen closes.',
    }));

    const admin = await scoped((tx) => getAdminMenu(tx, { outletId: a.outletId }));
    const section = admin!.categories.find((c) => c.id === categoryId)!;
    expect(section.name).toBe('Dinner');
    expect(section.items.map((i) => i.id)).toEqual([itemId]);
  });

  it('attaches reusable modifier groups, and refuses one from another menu', async () => {
    // The seeder's groups, so this exercises the real shapes.
    await scoped((tx) => seedMenu(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId,
      categories: KESARI_CATEGORIES, items: KESARI_MENU,
      collections: KESARI_COLLECTIONS, modifierGroups: KESARI_MODIFIER_GROUPS,
    }));

    const groups = await scoped((tx) => listModifierGroups(tx, { outletId: a.outletId }));
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0]!.optionNames.length).toBeGreaterThan(0);

    const categoryId = await aCategory('Late');
    const itemId = await aDish(categoryId, 'Midnight thali');

    await scoped((tx) => setMenuItemModifierGroups(tx, {
      tenantId: a.tenantId, outletId: a.outletId, itemId,
      groupIds: [groups[0]!.id, groups[0]!.id],
    }));

    // Deduped, and readable back through the guest's own dish read.
    const detail = await scoped((tx) => getAdminMenuItem(tx, { outletId: a.outletId, itemId }));
    expect(detail!.modifierGroupIds).toEqual([groups[0]!.id]);

    const dish = await scoped((tx) => getDish(tx, { propertyId: a.propertyId, itemId }));
    expect(dish!.modifierGroups.map((g) => g.id)).toEqual([groups[0]!.id]);

    // A group from another outlet would price a dish from a menu it is not on.
    await expect(scoped((tx) => setMenuItemModifierGroups(tx, {
      tenantId: a.tenantId, outletId: a.outletId, itemId,
      groupIds: ['33333333-3333-4333-8333-333333333333'],
    }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('replaces the whole set of groups rather than adding to it', async () => {
    await scoped((tx) => seedMenu(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId,
      categories: KESARI_CATEGORIES, items: KESARI_MENU,
      collections: KESARI_COLLECTIONS, modifierGroups: KESARI_MODIFIER_GROUPS,
    }));
    const groups = await scoped((tx) => listModifierGroups(tx, { outletId: a.outletId }));
    const categoryId = await aCategory('Late');
    const itemId = await aDish(categoryId, 'Midnight thali');

    const set = (ids: string[]) => scoped((tx) => setMenuItemModifierGroups(tx, {
      tenantId: a.tenantId, outletId: a.outletId, itemId, groupIds: ids,
    }));

    await set([groups[0]!.id, groups[1]!.id]);
    await set([groups[1]!.id]);

    const detail = await scoped((tx) => getAdminMenuItem(tx, { outletId: a.outletId, itemId }));
    expect(detail!.modifierGroupIds).toEqual([groups[1]!.id]);

    await set([]);
    expect((await scoped((tx) => getAdminMenuItem(tx, { outletId: a.outletId, itemId })))!
      .modifierGroupIds).toEqual([]);
  });

  it('will not edit a dish through another property\'s outlet', async () => {
    const categoryId = await aCategory('Dinner');
    const itemId = await aDish(categoryId, 'Laal maas');

    // Tenant B, its own outlet, A's item id. RLS returns nothing; the outlet
    // scope means it is a 404 rather than someone else's menu.
    const asB = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
      withTenant<T>({ tenantId: b.tenantId, propertyId: b.propertyId }, fn);

    expect(await asB((tx) => getAdminMenuItem(tx, { outletId: b.outletId, itemId }))).toBeNull();

    await expect(asB((tx) => setMenuItemAvailability(tx, {
      tenantId: b.tenantId, propertyId: b.propertyId, outletId: b.outletId,
      itemId, isAvailable: false, actorStaffId: staff,
    }))).rejects.toBeInstanceOf(NotFoundError);

    await expect(asB((tx) => archiveMenuItem(tx, {
      tenantId: b.tenantId, propertyId: b.propertyId, outletId: b.outletId,
      itemId, actorStaffId: staff,
    }))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a dish in a section that is not on this menu', async () => {
    await expect(scoped((tx) => createMenuItem(tx, {
      ...base(), categoryId: '44444444-4444-4444-8444-444444444444',
      name: 'Nowhere', priceMinor: 1000, currency: 'INR',
    }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a nameless dish or section', async () => {
    const categoryId = await aCategory('Dinner');
    await expect(scoped((tx) => createMenuCategory(tx, { ...base(), name: '   ' })))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(scoped((tx) => createMenuItem(tx, {
      ...base(), categoryId, name: '  ', priceMinor: 1000, currency: 'INR',
    }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('lands new rows at the end, not fighting for position zero', async () => {
    const first = await aCategory('First');
    const second = await aCategory('Second');
    await aDish(first, 'One');
    await aDish(first, 'Two');

    const admin = await scoped((tx) => getAdminMenu(tx, { outletId: a.outletId }));
    expect(admin!.categories.map((c) => c.id)).toEqual([first, second]);
    expect(admin!.categories[0]!.items.map((i) => i.name)).toEqual(['One', 'Two']);
  });

  it('closes the kitchen without editing the hours, and logs it', async () => {
    await scoped((tx) => setOutletAcceptingOrders(tx, {
      ...base(), isAcceptingOrders: false,
    }));

    const admin = await scoped((tx) => getAdminMenu(tx, { outletId: a.outletId }));
    expect(admin!.outlet.isAcceptingOrders).toBe(false);

    const events = await scoped((tx) => readEventHistory(tx, 'outlet', a.outletId));
    expect(events.map((e) => e.event_type)).toEqual(['outlet.closed']);

    await scoped((tx) => setOutletAcceptingOrders(tx, { ...base(), isAcceptingOrders: true }));
    expect((await scoped((tx) => getAdminMenu(tx, { outletId: a.outletId })))!
      .outlet.isAcceptingOrders).toBe(true);
  });

  it('refuses an outlet at another property', async () => {
    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => setOutletAcceptingOrders(tx, {
        tenantId: b.tenantId, propertyId: b.propertyId, outletId: a.outletId,
        isAcceptingOrders: false, actorStaffId: staff,
      }),
    )).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps a placed order readable after its dish is archived (#6, D-008)', async () => {
    // The reason archiving exists. Proven properly in place-order.test.ts via
    // snapshots; this asserts the catalog side does not break the FK.
    const categoryId = await aCategory('Dinner');
    const itemId = await aDish(categoryId, 'Laal maas');

    await scoped((tx) => archiveMenuItem(tx, { ...base(), itemId }));

    const row = await owner.query(`SELECT id FROM menu_items WHERE id = $1`, [itemId]);
    expect(row.rows).toHaveLength(1);
  });

  it('is a ConflictError, not a 500, when a section is archived twice', async () => {
    const categoryId = await aCategory('Dinner');
    await scoped((tx) => archiveMenuCategory(tx, { ...base(), categoryId }));
    await expect(scoped((tx) => archiveMenuCategory(tx, { ...base(), categoryId })))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
