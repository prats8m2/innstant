import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  seedMenu, getInRoomDiningMenu, getDish, getAdminMenu, getAdminMenuItem,
  listModifierGroups, createMenuCategory, updateMenuCategory, archiveMenuCategory,
  createMenuItem, updateMenuItem, setMenuItemAvailability, archiveMenuItem,
  setMenuItemModifierGroups, setOutletAcceptingOrders,
  getOutletSettings, updateOutletSettings, setOutletHours, getOutletHours,
  outletOpenState, listCollections, createCollection, updateCollection,
  archiveCollection, setCollectionItems,
  listModifierGroupsForAdmin, createModifierGroup, updateModifierGroup,
  archiveModifierGroup, createModifierOption, updateModifierOption,
  archiveModifierOption, setMenuItemAvailabilityWindows,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import { addToCart, getCart, stayContext } from '@/modules/ordering';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * Wednesday 21:00 property-local, passed to every menu read.
 *
 * The collection windows are applied now (`isWithinWindow`), so a menu read
 * without a time is a menu read at an unknown hour — and "After 10pm" is
 * seeded 22:00–01:00. 21:00 keeps it hidden and every other section showing,
 * whatever the clock on the machine running the suite says.
 */
const AT_NINE_PM = { dayOfWeek: 3, minutes: 21 * 60 };


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
    const menu = await scoped((tx) => getInRoomDiningMenu(tx, a.propertyId, AT_NINE_PM));
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

    const menu = await scoped((tx) => getInRoomDiningMenu(tx, a.propertyId, AT_NINE_PM));
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
    const menu = await scoped((tx) => getInRoomDiningMenu(tx, a.propertyId, AT_NINE_PM));
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

  describe('a dish with its own schedule', () => {
    const menuAt = (hhmm: string, dayOfWeek = 3) => {
      const [h, m] = hhmm.split(':').map(Number) as [number, number];
      return scoped((tx) => getInRoomDiningMenu(tx, a.propertyId, {
        dayOfWeek, minutes: h * 60 + m,
      }));
    };

    const availableAt = async (itemId: string, hhmm: string, dayOfWeek = 3) => {
      const menu = await menuAt(hhmm, dayOfWeek);
      return menu!.sections.flatMap((s) => s.items).find((i) => i.id === itemId)?.isAvailable;
    };

    it('is on all day when it has no schedule', async () => {
      const categoryId = await aCategory('All day');
      const itemId = await aDish(categoryId, 'Club sandwich');

      // The default, and the one that must not be got backwards: no rows means
      // always, not never.
      expect(await availableAt(itemId, '04:00')).toBe(true);
      expect(await availableAt(itemId, '21:00')).toBe(true);
    });

    it('stops when its window does', async () => {
      const categoryId = await aCategory('Breakfast');
      const itemId = await aDish(categoryId, 'Kachori and chai');

      await scoped((tx) => setMenuItemAvailabilityWindows(tx, {
        ...base(), itemId,
        windows: [{ dayOfWeek: null, startsAt: '07:00', endsAt: '10:30' }],
      }));

      expect(await availableAt(itemId, '08:00')).toBe(true);
      expect(await availableAt(itemId, '10:29')).toBe(true);
      expect(await availableAt(itemId, '10:30')).toBe(false);
      expect(await availableAt(itemId, '21:00')).toBe(false);
      // Still ON the menu — a guest sees it and sees that it is not available,
      // which is the existing read's decision for `is_available` too.
      const menu = await menuAt('21:00');
      expect(menu!.sections.flatMap((s) => s.items).map((i) => i.id)).toContain(itemId);
    });

    it('can be on twice a day', async () => {
      const categoryId = await aCategory('Two sittings');
      const itemId = await aDish(categoryId, 'Thali');

      await scoped((tx) => setMenuItemAvailabilityWindows(tx, {
        ...base(), itemId,
        windows: [
          { dayOfWeek: null, startsAt: '12:00', endsAt: '15:00' },
          { dayOfWeek: null, startsAt: '19:00', endsAt: '22:30' },
        ],
      }));

      expect(await availableAt(itemId, '13:00')).toBe(true);
      expect(await availableAt(itemId, '17:00')).toBe(false);
      expect(await availableAt(itemId, '20:00')).toBe(true);
    });

    it('can be on one day of the week', async () => {
      const categoryId = await aCategory('Sunday');
      const itemId = await aDish(categoryId, 'Sunday biryani');

      await scoped((tx) => setMenuItemAvailabilityWindows(tx, {
        ...base(), itemId,
        windows: [{ dayOfWeek: 0, startsAt: '12:00', endsAt: '16:00' }],
      }));

      expect(await availableAt(itemId, '13:00', 0)).toBe(true);
      expect(await availableAt(itemId, '13:00', 3)).toBe(false);
    });

    it('stops the ORDER, not just the display', async () => {
      const categoryId = await aCategory('Breakfast');
      const itemId = await aDish(categoryId, 'Morning-only kachori');
      await scoped((tx) => setMenuItemAvailabilityWindows(tx, {
        ...base(), itemId,
        windows: [{ dayOfWeek: null, startsAt: '07:00', endsAt: '10:30' }],
      }));

      const stayId = await checkInGuest(a);
      await scoped((tx) => addToCart(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, context: stayContext(stayId),
        menuItemId: itemId, quantity: 1, modifierOptionIds: [],
      }));

      /**
       * The cart is priced with the property's clock, so the line reads as
       * unavailable outside the window and `placeOrder()` refuses it — the same
       * path that stops a dish taken off the menu mid-choice. Which of the two
       * happens depends on the hour this suite runs at, and both are correct.
       */
      const priced = await scoped((tx) => getCart(tx, {
        propertyId: a.propertyId, context: stayContext(stayId), at: { dayOfWeek: 3, minutes: 21 * 60 },
        outlet: {
          outletId: a.outletId, currency: 'INR',
          taxRateBps: 0, serviceChargeBps: 0, deliveryFeeMinor: 0,
        },
      }));
      expect(priced!.lines[0]!.isAvailable).toBe(false);
      // And it does not price into the total: a guest is not charged for a dish
      // the kitchen will not cook.
      expect(priced!.totals.subtotal.amountMinor).toBe(0);

      const inWindow = await scoped((tx) => getCart(tx, {
        propertyId: a.propertyId, context: stayContext(stayId), at: { dayOfWeek: 3, minutes: 8 * 60 },
        outlet: {
          outletId: a.outletId, currency: 'INR',
          taxRateBps: 0, serviceChargeBps: 0, deliveryFeeMinor: 0,
        },
      }));
      expect(inWindow!.lines[0]!.isAvailable).toBe(true);
      expect(inWindow!.totals.subtotal.amountMinor).toBeGreaterThan(0);
    });

    it('replaces the schedule, and an empty one means always', async () => {
      const categoryId = await aCategory('Breakfast');
      const itemId = await aDish(categoryId, 'Kachori');

      await scoped((tx) => setMenuItemAvailabilityWindows(tx, {
        ...base(), itemId,
        windows: [{ dayOfWeek: null, startsAt: '07:00', endsAt: '10:30' }],
      }));
      expect(await availableAt(itemId, '21:00')).toBe(false);

      await scoped((tx) => setMenuItemAvailabilityWindows(tx, { ...base(), itemId, windows: [] }));
      expect(await availableAt(itemId, '21:00')).toBe(true);

      const detail = await scoped((tx) => getAdminMenuItem(tx, {
        outletId: a.outletId, itemId,
      }));
      expect(detail!.availabilityWindows).toEqual([]);
    });

    it('reads back what the editor needs to show', async () => {
      const categoryId = await aCategory('Breakfast');
      const itemId = await aDish(categoryId, 'Kachori');
      await scoped((tx) => setMenuItemAvailabilityWindows(tx, {
        ...base(), itemId,
        windows: [{ dayOfWeek: 0, startsAt: '12:00', endsAt: '16:00' }],
      }));

      const detail = await scoped((tx) => getAdminMenuItem(tx, {
        outletId: a.outletId, itemId,
      }));
      expect(detail!.availabilityWindows).toEqual([
        { dayOfWeek: 0, startsAt: '12:00', endsAt: '16:00' },
      ]);

      // And `crosses_midnight` is stored truthfully rather than left default.
      const row = await owner.query(
        `SELECT crosses_midnight FROM menu_item_availability_windows WHERE menu_item_id = $1`,
        [itemId]);
      expect(row.rows[0].crosses_midnight).toBe(false);
    });

    it('stores crossesMidnight for a window that runs past midnight', async () => {
      const categoryId = await aCategory('Late');
      const itemId = await aDish(categoryId, 'Midnight maggi');
      await scoped((tx) => setMenuItemAvailabilityWindows(tx, {
        ...base(), itemId,
        windows: [{ dayOfWeek: null, startsAt: '23:00', endsAt: '02:00' }],
      }));

      const row = await owner.query(
        `SELECT crosses_midnight FROM menu_item_availability_windows WHERE menu_item_id = $1`,
        [itemId]);
      expect(row.rows[0].crosses_midnight).toBe(true);

      expect(await availableAt(itemId, '23:30')).toBe(true);
      expect(await availableAt(itemId, '01:00')).toBe(true);
      expect(await availableAt(itemId, '03:00')).toBe(false);
    });

    it('refuses a zero-length window, which would hide the dish', async () => {
      const categoryId = await aCategory('Breakfast');
      const itemId = await aDish(categoryId, 'Kachori');

      await expect(scoped((tx) => setMenuItemAvailabilityWindows(tx, {
        ...base(), itemId,
        windows: [{ dayOfWeek: null, startsAt: '10:00', endsAt: '10:00' }],
      }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses a schedule on another property\'s dish', async () => {
      const categoryId = await aCategory('Breakfast');
      const itemId = await aDish(categoryId, 'Kachori');

      await expect(withTenant(
        { tenantId: b.tenantId, propertyId: b.propertyId },
        (tx) => setMenuItemAvailabilityWindows(tx, {
          tenantId: b.tenantId, propertyId: b.propertyId, outletId: b.outletId,
          itemId, windows: [], actorStaffId: staff,
        }),
      )).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('option groups', () => {
    const list = () => scoped((tx) => listModifierGroupsForAdmin(tx, { outletId: a.outletId }));

    async function aGroup(
      name: string,
      opts: { min?: number; max?: number; required?: boolean } = {},
    ): Promise<string> {
      const { id } = await scoped((tx) => createModifierGroup(tx, {
        ...base(), name,
        minSelections: opts.min ?? 0,
        maxSelections: opts.max ?? 1,
        isRequired: opts.required ?? false,
      }));
      return id;
    }

    const anOption = async (
      groupId: string,
      name: string,
      priceDeltaMinor = 0,
      extra: { isDefault?: boolean; isAvailable?: boolean } = {},
    ) => (await scoped((tx) => createModifierOption(tx, {
      ...base(), groupId, name, priceDeltaMinor, currency: 'INR',
      isDefault: extra.isDefault ?? false,
      isAvailable: extra.isAvailable ?? true,
    }))).id;

    it('reaches the guest dish screen, priced', async () => {
      const categoryId = await aCategory('Dinner');
      const itemId = await aDish(categoryId, 'Laal maas', 115_000);

      const groupId = await aGroup('Add a roti', { max: 1 });
      await anOption(groupId, 'Nothing', 0, { isDefault: true });
      await anOption(groupId, 'Extra bajra roti', 12_000);

      await scoped((tx) => setMenuItemModifierGroups(tx, {
        tenantId: a.tenantId, outletId: a.outletId, itemId, groupIds: [groupId],
      }));

      // The guest's own read — the screen where the total moves as you choose.
      const dish = await scoped((tx) => getDish(tx, { propertyId: a.propertyId, itemId }));
      const group = dish!.modifierGroups.find((g) => g.name === 'Add a roti')!;
      expect(group.options.map((o) => [o.name, o.priceDeltaMinor]))
        .toEqual([['Nothing', 0], ['Extra bajra roti', 12_000]]);
      expect(group.options.find((o) => o.isDefault)!.name).toBe('Nothing');
    });

    it('counts the dishes carrying a group, which is why it is shared', async () => {
      const categoryId = await aCategory('Dinner');
      const one = await aDish(categoryId, 'One');
      const two = await aDish(categoryId, 'Two');

      const groupId = await aGroup('Chilli');
      await anOption(groupId, 'Gentle');

      for (const itemId of [one, two]) {
        await scoped((tx) => setMenuItemModifierGroups(tx, {
          tenantId: a.tenantId, outletId: a.outletId, itemId, groupIds: [groupId],
        }));
      }

      expect((await list()).find((g) => g.id === groupId)!.dishCount).toBe(2);
    });

    it('lets an option take money OFF, because "no roti" can', async () => {
      const groupId = await aGroup('Roti');
      await anOption(groupId, 'As it comes');
      const cheaper = await anOption(groupId, 'Without the roti', -5_000);

      const option = (await list())
        .find((g) => g.id === groupId)!.options.find((o) => o.id === cheaper)!;
      expect(option.priceDeltaMinor).toBe(-5_000);
    });

    it('logs a repriced option with both deltas', async () => {
      const groupId = await aGroup('Chilli');
      const optionId = await anOption(groupId, 'Extra fiery', 0);

      await scoped((tx) => updateModifierOption(tx, {
        ...base(), groupId, optionId, name: 'Extra fiery', priceDeltaMinor: 4_000,
        currency: 'INR', isDefault: false, isAvailable: true,
      }));

      const events = await scoped((tx) => readEventHistory(tx, 'modifier_group', groupId));
      const repriced = events.find((e) => e.event_type === 'modifier_option.repriced')!;
      const payload = repriced.payload as { fromMinor: number; toMinor: number };
      expect(Number(payload.fromMinor)).toBe(0);
      expect(Number(payload.toMinor)).toBe(4_000);
    });

    it('does not log a reprice when only the name changed', async () => {
      const groupId = await aGroup('Chilli');
      const optionId = await anOption(groupId, 'Fiery', 4_000);

      await scoped((tx) => updateModifierOption(tx, {
        ...base(), groupId, optionId, name: 'Extra fiery', priceDeltaMinor: 4_000,
        currency: 'INR', isDefault: false, isAvailable: true,
      }));

      const events = await scoped((tx) => readEventHistory(tx, 'modifier_group', groupId));
      expect(events.filter((e) => e.event_type === 'modifier_option.repriced')).toHaveLength(0);
    });

    it('keeps one default in a single-choice group', async () => {
      const groupId = await aGroup('Chilli', { max: 1 });
      const gentle = await anOption(groupId, 'Gentle', 0, { isDefault: true });
      const fiery = await anOption(groupId, 'Extra fiery', 0, { isDefault: true });

      // Two preselected mutually exclusive choices is not a state a screen can
      // render. The last one set wins.
      const options = (await list()).find((g) => g.id === groupId)!.options;
      expect(options.filter((o) => o.isDefault).map((o) => o.id)).toEqual([fiery]);
      expect(options.find((o) => o.id === gentle)!.isDefault).toBe(false);
    });

    it('allows several defaults where several may be chosen', async () => {
      const groupId = await aGroup('Add', { max: 3 });
      await anOption(groupId, 'Extra ghee', 3_000, { isDefault: true });
      await anOption(groupId, 'Steamed rice', 8_000, { isDefault: true });

      expect((await list()).find((g) => g.id === groupId)!.options
        .filter((o) => o.isDefault)).toHaveLength(2);
    });

    it('refuses to narrow a group to one choice while two are default', async () => {
      const groupId = await aGroup('Add', { max: 3 });
      await anOption(groupId, 'Extra ghee', 0, { isDefault: true });
      await anOption(groupId, 'Steamed rice', 0, { isDefault: true });

      await expect(scoped((tx) => updateModifierGroup(tx, {
        ...base(), groupId, name: 'Add', minSelections: 0, maxSelections: 1,
        isRequired: false,
      }))).rejects.toBeInstanceOf(ConflictError);
    });

    it('refuses a required group a guest can skip', async () => {
      // A "required" badge over a group satisfied by choosing nothing is a lie.
      await expect(scoped((tx) => createModifierGroup(tx, {
        ...base(), name: 'Broken', minSelections: 0, maxSelections: 2, isRequired: true,
      }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses a minimum above the maximum, and a maximum of zero', async () => {
      await expect(scoped((tx) => createModifierGroup(tx, {
        ...base(), name: 'Backwards', minSelections: 3, maxSelections: 2, isRequired: false,
      }))).rejects.toBeInstanceOf(ValidationError);

      await expect(scoped((tx) => createModifierGroup(tx, {
        ...base(), name: 'Nothing to choose', minSelections: 0, maxSelections: 0,
        isRequired: false,
      }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('will not archive the last option in a group', async () => {
      const groupId = await aGroup('Chilli');
      const only = await anOption(groupId, 'Gentle');

      // `getDish()` joins options INNER, so a group with none vanishes from the
      // dish entirely — a required choice would disappear rather than error.
      await expect(scoped((tx) => archiveModifierOption(tx, {
        ...base(), groupId, optionId: only,
      }))).rejects.toBeInstanceOf(ConflictError);
    });

    it('archives an option out of the guest read while keeping the row', async () => {
      const categoryId = await aCategory('Dinner');
      const itemId = await aDish(categoryId, 'Laal maas');
      const groupId = await aGroup('Chilli');
      await anOption(groupId, 'Gentle');
      const fiery = await anOption(groupId, 'Extra fiery', 4_000);
      await scoped((tx) => setMenuItemModifierGroups(tx, {
        tenantId: a.tenantId, outletId: a.outletId, itemId, groupIds: [groupId],
      }));

      await scoped((tx) => archiveModifierOption(tx, { ...base(), groupId, optionId: fiery }));

      const dish = await scoped((tx) => getDish(tx, { propertyId: a.propertyId, itemId }));
      expect(dish!.modifierGroups[0]!.options.map((o) => o.name)).toEqual(['Gentle']);

      // D-008: the row is still there, so a past order's snapshot has something
      // to point at.
      const row = await owner.query(
        `SELECT archived_at FROM modifier_options WHERE id = $1`, [fiery]);
      expect(row.rows[0].archived_at).not.toBeNull();
    });

    it('refuses to archive a group dishes carry, until told to detach it', async () => {
      const categoryId = await aCategory('Dinner');
      const itemId = await aDish(categoryId, 'Laal maas');
      const groupId = await aGroup('Chilli');
      await anOption(groupId, 'Gentle');
      await scoped((tx) => setMenuItemModifierGroups(tx, {
        tenantId: a.tenantId, outletId: a.outletId, itemId, groupIds: [groupId],
      }));

      await expect(scoped((tx) => archiveModifierGroup(tx, { ...base(), groupId })))
        .rejects.toThrow(/1 dish carries this group/);

      const { detachedFrom } = await scoped((tx) => archiveModifierGroup(tx, {
        ...base(), groupId, detachFromDishes: true,
      }));
      expect(detachedFrom).toBe(1);

      // Gone from the dish, and the dish is otherwise untouched.
      const dish = await scoped((tx) => getDish(tx, { propertyId: a.propertyId, itemId }));
      expect(dish!.modifierGroups).toEqual([]);
      expect(dish!.dish.name).toBe('Laal maas');
    });

    it('archives a group nothing carries without ceremony', async () => {
      const groupId = await aGroup('Unused');
      await anOption(groupId, 'Whatever');

      const { detachedFrom } = await scoped((tx) => archiveModifierGroup(tx, {
        ...base(), groupId,
      }));
      expect(detachedFrom).toBe(0);
      expect((await list()).find((g) => g.id === groupId)).toBeUndefined();
    });

    it('will not touch a group through another property\'s outlet', async () => {
      const groupId = await aGroup('Ours');
      await anOption(groupId, 'Gentle');

      await expect(withTenant(
        { tenantId: b.tenantId, propertyId: b.propertyId },
        (tx) => updateModifierGroup(tx, {
          tenantId: b.tenantId, propertyId: b.propertyId, outletId: b.outletId,
          groupId, name: 'Theirs', minSelections: 0, maxSelections: 1,
          isRequired: false, actorStaffId: staff,
        }),
      )).rejects.toBeInstanceOf(NotFoundError);

      await expect(withTenant(
        { tenantId: b.tenantId, propertyId: b.propertyId },
        (tx) => createModifierOption(tx, {
          tenantId: b.tenantId, propertyId: b.propertyId, outletId: b.outletId,
          groupId, name: 'Sneaky', priceDeltaMinor: 0, currency: 'INR',
          isDefault: false, isAvailable: true, actorStaffId: staff,
        }),
      )).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('editorial collections', () => {
    const collections = () => scoped((tx) => listCollections(tx, { outletId: a.outletId }));
    const menuAt = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map(Number) as [number, number];
      return scoped((tx) => getInRoomDiningMenu(tx, a.propertyId, {
        dayOfWeek: 3, minutes: h * 60 + m,
      }));
    };

    async function aCollectionWith(
      name: string,
      itemIds: string[],
      extra: { availableFrom?: string; availableUntil?: string; isActive?: boolean } = {},
    ): Promise<string> {
      const { id } = await scoped((tx) => createCollection(tx, { ...base(), name, ...extra }));
      await scoped((tx) => setCollectionItems(tx, {
        tenantId: a.tenantId, outletId: a.outletId, collectionId: id, menuItemIds: itemIds,
      }));
      return id;
    }

    it('becomes a section on the guest menu, ahead of the categories', async () => {
      const categoryId = await aCategory('Dinner');
      const dish = await aDish(categoryId, 'Laal maas');
      await aCollectionWith('Chef’s table', [dish]);

      const menu = await menuAt('21:00');
      const kinds = menu!.sections.map((s) => s.kind);
      expect(kinds.indexOf('COLLECTION')).toBe(0);

      const section = menu!.sections.find((s) => s.title === 'Chef’s table')!;
      expect(section.items.map((i) => i.name)).toEqual(['Laal maas']);
    });

    it('keeps the curated order, not the alphabet', async () => {
      const categoryId = await aCategory('Dinner');
      const first = await aDish(categoryId, 'Zeera aloo');
      const second = await aDish(categoryId, 'Aam ras');
      await aCollectionWith('Running order', [first, second]);

      // "What Bhairav cooks when the family visits" is a sequence. Sorting it
      // alphabetically would silently rewrite the GM's editorial decision.
      const menu = await menuAt('21:00');
      expect(menu!.sections.find((s) => s.title === 'Running order')!.items.map((i) => i.name))
        .toEqual(['Zeera aloo', 'Aam ras']);
    });

    it('honours its window, on the property clock', async () => {
      const categoryId = await aCategory('Late');
      const dish = await aDish(categoryId, 'Midnight thali');
      await aCollectionWith('After 10pm', [dish], {
        availableFrom: '22:00', availableUntil: '01:00',
      });

      const titlesAt = async (hhmm: string) =>
        (await menuAt(hhmm))!.sections.map((s) => s.title);

      expect(await titlesAt('09:00')).not.toContain('After 10pm');
      expect(await titlesAt('22:30')).toContain('After 10pm');
      expect(await titlesAt('00:30')).toContain('After 10pm');
      expect(await titlesAt('01:30')).not.toContain('After 10pm');
    });

    it('is invisible when switched off, and still editable', async () => {
      const categoryId = await aCategory('Dinner');
      const dish = await aDish(categoryId, 'Laal maas');
      const id = await aCollectionWith('Quietly off', [dish], { isActive: false });

      expect((await menuAt('21:00'))!.sections.map((s) => s.title))
        .not.toContain('Quietly off');
      // The editor still sees it — it is the one someone came to switch back on.
      expect((await collections()).find((c) => c.id === id)).toBeTruthy();
    });

    it('is skipped rather than drawn empty when nothing is in it', async () => {
      await aCollectionWith('Nothing yet', []);

      // An empty heading with a blurb under it reads as a loading failure.
      expect((await menuAt('21:00'))!.sections.map((s) => s.title))
        .not.toContain('Nothing yet');
      expect((await collections()).map((c) => c.name)).toContain('Nothing yet');
    });

    it('lets one dish sit in two collections, as the design does', async () => {
      const categoryId = await aCategory('Dinner');
      const dish = await aDish(categoryId, 'Laal maas');
      await aCollectionWith('From the rooftop', [dish]);
      await aCollectionWith('Chef’s table', [dish]);

      const menu = await menuAt('21:00');
      const withLaal = menu!.sections.filter((s) =>
        s.items.some((i) => i.name === 'Laal maas'));
      expect(withLaal.length).toBeGreaterThanOrEqual(2);
    });

    it('replaces the membership rather than adding to it', async () => {
      const categoryId = await aCategory('Dinner');
      const one = await aDish(categoryId, 'One');
      const two = await aDish(categoryId, 'Two');
      const id = await aCollectionWith('Swap', [one, two]);

      await scoped((tx) => setCollectionItems(tx, {
        tenantId: a.tenantId, outletId: a.outletId, collectionId: id, menuItemIds: [two],
      }));

      const found = (await collections()).find((c) => c.id === id)!;
      expect(found.items.map((i) => i.name)).toEqual(['Two']);
    });

    it('drops an archived dish out of the collection it was in', async () => {
      const categoryId = await aCategory('Dinner');
      const dish = await aDish(categoryId, 'Going away');
      const id = await aCollectionWith('Holds it', [dish]);

      await scoped((tx) => archiveMenuItem(tx, { ...base(), itemId: dish }));

      // The membership row survives (D-008 deletes nothing), so the reads have
      // to exclude it — otherwise the editor lists a dish that is gone and the
      // guest gets an empty section with a heading.
      expect((await collections()).find((c) => c.id === id)!.items).toEqual([]);
      expect((await menuAt('21:00'))!.sections.map((s) => s.title)).not.toContain('Holds it');
    });

    it('refuses a dish that is not on this menu', async () => {
      const id = await aCollectionWith('Strict', []);
      await expect(scoped((tx) => setCollectionItems(tx, {
        tenantId: a.tenantId, outletId: a.outletId, collectionId: id,
        menuItemIds: ['55555555-5555-4555-8555-555555555555'],
      }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses half a window', async () => {
      // "Showing from 22:00, forever" reads as a mistake, and every collection
      // that has a window has both ends.
      await expect(scoped((tx) => createCollection(tx, {
        ...base(), name: 'Half', availableFrom: '22:00',
      }))).rejects.toBeInstanceOf(ValidationError);

      await expect(scoped((tx) => createCollection(tx, {
        ...base(), name: 'Zero-length', availableFrom: '22:00', availableUntil: '22:00',
      }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('archives without taking its dishes off the menu', async () => {
      const categoryId = await aCategory('Dinner');
      const dish = await aDish(categoryId, 'Stays');
      const id = await aCollectionWith('Going', [dish]);

      await scoped((tx) => archiveCollection(tx, { ...base(), collectionId: id }));

      expect((await collections()).find((c) => c.id === id)).toBeUndefined();
      // A collection is a view over dishes. The dish is still orderable.
      const menu = await menuAt('21:00');
      expect(menu!.sections.flatMap((s) => s.items).map((i) => i.name)).toContain('Stays');

      const events = await scoped((tx) => readEventHistory(tx, 'collection', id));
      expect(events.map((e) => e.event_type))
        .toEqual(['collection.created', 'collection.archived']);
    });

    it('will not edit a collection through another property\'s outlet', async () => {
      const id = await aCollectionWith('Ours', []);

      await expect(withTenant(
        { tenantId: b.tenantId, propertyId: b.propertyId },
        (tx) => updateCollection(tx, {
          tenantId: b.tenantId, propertyId: b.propertyId, outletId: b.outletId,
          collectionId: id, name: 'Theirs now', actorStaffId: staff,
        }),
      )).rejects.toBeInstanceOf(NotFoundError);

      await expect(withTenant(
        { tenantId: b.tenantId, propertyId: b.propertyId },
        (tx) => setCollectionItems(tx, {
          tenantId: b.tenantId, outletId: b.outletId, collectionId: id, menuItemIds: [],
        }),
      )).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('outlet settings and hours', () => {
    const settings = () => scoped((tx) => getOutletSettings(tx, {
      propertyId: a.propertyId, outletId: a.outletId,
    }));

    it('stores rates as basis points and fees as minor units (#5)', async () => {
      await scoped((tx) => updateOutletSettings(tx, {
        ...base(), name: 'In-room dining',
        taxRateBps: 550, serviceChargeBps: 1000,
        deliveryFeeMinor: 5_000, minimumOrderMinor: 20_000,
        prepTimeMinutes: 40,
      }));

      const after = await settings();
      expect(after!.taxRateBps).toBe(550);
      expect(after!.serviceChargeBps).toBe(1000);
      expect(after!.deliveryFeeMinor).toBe(5_000);
      expect(after!.minimumOrderMinor).toBe(20_000);
      expect(after!.prepTimeMinutes).toBe(40);
    });

    it('logs a settings change with both values, for a dispute a fortnight later', async () => {
      const before = await settings();
      await scoped((tx) => updateOutletSettings(tx, {
        ...base(), name: before!.name,
        taxRateBps: 1800, serviceChargeBps: before!.serviceChargeBps,
        deliveryFeeMinor: before!.deliveryFeeMinor,
        minimumOrderMinor: before!.minimumOrderMinor,
        prepTimeMinutes: before!.prepTimeMinutes,
      }));

      const events = await scoped((tx) => readEventHistory(tx, 'outlet', a.outletId));
      const updated = events.find((e) => e.event_type === 'outlet.settings_updated')!;
      const changed = (updated.payload as { changed: Record<string, { from: number; to: number }> })
        .changed;

      expect(Object.keys(changed)).toEqual(['taxRateBps']);
      expect(Number(changed.taxRateBps!.from)).toBe(before!.taxRateBps);
      expect(Number(changed.taxRateBps!.to)).toBe(1800);
    });

    it('refuses a rate above 100% and a negative fee', async () => {
      const ok = {
        ...base(), name: 'In-room dining', taxRateBps: 0, serviceChargeBps: 0,
        deliveryFeeMinor: 0, minimumOrderMinor: 0, prepTimeMinutes: 30,
      };
      await expect(scoped((tx) => updateOutletSettings(tx, { ...ok, taxRateBps: 10_001 })))
        .rejects.toBeInstanceOf(ValidationError);
      await expect(scoped((tx) => updateOutletSettings(tx, { ...ok, deliveryFeeMinor: -1 })))
        .rejects.toBeInstanceOf(ValidationError);
      await expect(scoped((tx) => updateOutletSettings(tx, { ...ok, prepTimeMinutes: 0 })))
        .rejects.toBeInstanceOf(ValidationError);
    });

    it('replaces the week, so an unticked day becomes a day with no row', async () => {
      const everyDay = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek, opensAt: '07:00', closesAt: '01:00', crossesMidnight: true,
      }));
      await scoped((tx) => setOutletHours(tx, { ...base(), hours: everyDay }));
      expect(await scoped((tx) => getOutletHours(tx, a.outletId))).toHaveLength(7);

      // Closed on Tuesdays: the row is gone, not zeroed.
      await scoped((tx) => setOutletHours(tx, {
        ...base(), hours: everyDay.filter((h) => h.dayOfWeek !== 2),
      }));
      const hours = await scoped((tx) => getOutletHours(tx, a.outletId));
      expect(hours).toHaveLength(6);
      expect(hours.find((h) => h.dayOfWeek === 2)).toBeUndefined();

      // And the guest-facing logic agrees, on the same rows.
      expect(outletOpenState(hours, { dayOfWeek: 2, minutes: 21 * 60 }).isOpen).toBe(false);
      expect(outletOpenState(hours, { dayOfWeek: 3, minutes: 21 * 60 }).isOpen).toBe(true);
    });

    it('accepts an empty week as "closed every day"', async () => {
      await scoped((tx) => setOutletHours(tx, { ...base(), hours: [] }));
      expect(await scoped((tx) => getOutletHours(tx, a.outletId))).toEqual([]);
    });

    it('refuses hours that would read as closed when they are not', async () => {
      // closesAt before opensAt without the flag: the open-state logic skips
      // the window, so the kitchen silently reads as shut. Caught on write.
      await expect(scoped((tx) => setOutletHours(tx, {
        ...base(),
        hours: [{ dayOfWeek: 1, opensAt: '19:00', closesAt: '02:00', crossesMidnight: false }],
      }))).rejects.toBeInstanceOf(ValidationError);

      // And the flag with a closing time LATER in the day is the same mistake
      // upside down.
      await expect(scoped((tx) => setOutletHours(tx, {
        ...base(),
        hours: [{ dayOfWeek: 1, opensAt: '07:00', closesAt: '23:00', crossesMidnight: true }],
      }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses two sets of hours for one day, and a day out of range', async () => {
      await expect(scoped((tx) => setOutletHours(tx, {
        ...base(),
        hours: [
          { dayOfWeek: 1, opensAt: '07:00', closesAt: '11:00', crossesMidnight: false },
          { dayOfWeek: 1, opensAt: '19:00', closesAt: '23:00', crossesMidnight: false },
        ],
      }))).rejects.toBeInstanceOf(ValidationError);

      await expect(scoped((tx) => setOutletHours(tx, {
        ...base(),
        hours: [{ dayOfWeek: 7, opensAt: '07:00', closesAt: '11:00', crossesMidnight: false }],
      }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('refuses a time that is not a time', async () => {
      await expect(scoped((tx) => setOutletHours(tx, {
        ...base(),
        hours: [{ dayOfWeek: 1, opensAt: 'seven', closesAt: '11:00', crossesMidnight: false }],
      }))).rejects.toBeInstanceOf(ValidationError);
    });

    it('will not touch another property\'s outlet', async () => {
      await expect(withTenant(
        { tenantId: b.tenantId, propertyId: b.propertyId },
        (tx) => setOutletHours(tx, {
          tenantId: b.tenantId, propertyId: b.propertyId, outletId: a.outletId,
          hours: [], actorStaffId: staff,
        }),
      )).rejects.toBeInstanceOf(NotFoundError);

      await expect(withTenant(
        { tenantId: b.tenantId, propertyId: b.propertyId },
        (tx) => updateOutletSettings(tx, {
          tenantId: b.tenantId, propertyId: b.propertyId, outletId: a.outletId,
          name: 'Theirs', taxRateBps: 0, serviceChargeBps: 0,
          deliveryFeeMinor: 0, minimumOrderMinor: 0, prepTimeMinutes: 30,
          actorStaffId: staff,
        }),
      )).rejects.toBeInstanceOf(NotFoundError);
    });
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
