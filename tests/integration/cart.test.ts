import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant } from '@/db';
import {
  seedMenu, getInRoomDiningMenu, getDish,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import { addToCart, getCart, setCartItemQuantity, removeCartItem } from '@/modules/ordering';
import type { CartOutletConfig } from '@/modules/ordering';
import { ValidationError, ConflictError, NotFoundError } from '@/lib/errors';
import { ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * The cart, against a real Postgres under RLS.
 *
 * The unit tests in `totals.test.ts` prove the arithmetic; these prove the
 * things only a database can: the one-cart-per-(stay, outlet) constraint under
 * concurrency, line merging, and that a cart line belonging to another stay is
 * not editable even with its id in hand.
 */
describe('cart', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let stayId: string;
  let outlet: CartOutletConfig;
  const laal = 'Laal maas with bajra roti';

  async function stayFor(fixture: Fixture, roomId = fixture.roomId): Promise<string> {
    const r = await owner.query<{ id: string }>(`
      INSERT INTO stays (tenant_id, property_id, room_id, guest_id, status,
                         checked_in_at, scheduled_checkout_at)
      VALUES ($1,$2,$3,$4,'CHECKED_IN', now(), now() + interval '2 days') RETURNING id`,
      [fixture.tenantId, fixture.propertyId, roomId, fixture.guestId]);
    return r.rows[0]!.id;
  }

  /**
   * A second room, because D-007 allows only one active stay per room — two
   * CHECKED_IN stays in 214 is exactly the thing the schema forbids, and the
   * neighbour test below needs a real neighbour.
   */
  async function neighbourRoom(): Promise<string> {
    const r = await owner.query<{ id: string }>(`
      INSERT INTO rooms (tenant_id, property_id, floor_id, room_type_id, number, status)
      VALUES ($1,$2,$3,$4,'215','AVAILABLE') RETURNING id`,
      [a.tenantId, a.propertyId, a.floorId, a.roomTypeId]);
    return r.rows[0]!.id;
  }

  /** The dish id for a name on tenant A's menu. */
  async function dishId(name: string): Promise<string> {
    return withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, async (tx) => {
      const menu = await getInRoomDiningMenu(tx, a.propertyId);
      const item = menu!.sections.flatMap((s) => s.items).find((i) => i.name === name);
      if (!item) throw new Error(`no dish named ${name}`);
      return item.id;
    });
  }

  async function optionId(dish: string, option: string): Promise<string> {
    return withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, async (tx) => {
      const detail = await getDish(tx, { propertyId: a.propertyId, itemId: await dishId(dish) });
      const found = detail!.modifierGroups.flatMap((g) => g.options).find((o) => o.name === option);
      if (!found) throw new Error(`no option named ${option}`);
      return found.id;
    });
  }

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');

    for (const fixture of [a, b]) {
      await withTenant({ tenantId: fixture.tenantId, propertyId: fixture.propertyId }, (tx) =>
        seedMenu(tx, {
          tenantId: fixture.tenantId,
          propertyId: fixture.propertyId,
          outletId: fixture.outletId,
          categories: KESARI_CATEGORIES,
          items: KESARI_MENU,
          collections: KESARI_COLLECTIONS,
          modifierGroups: KESARI_MODIFIER_GROUPS,
        }));
    }

    stayId = await stayFor(a);
    outlet = {
      outletId: a.outletId,
      currency: 'INR',
      taxRateBps: 500,
      serviceChargeBps: 1_000,
      deliveryFeeMinor: 0,
    };
  });

  beforeEach(async () => {
    await owner.query(`DELETE FROM carts WHERE stay_id = $1`, [stayId]);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  const add = (input: Parameters<typeof addToCart>[1]) =>
    withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) => addToCart(tx, input));

  const read = () =>
    withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      getCart(tx, { propertyId: a.propertyId, stayId, outlet }));

  it('reports no cart at all before the first add', async () => {
    // Distinct from an empty cart — the screen says different things.
    expect(await read()).toBeNull();
  });

  it('adds a dish and prices the line with its modifiers', async () => {
    const roti = await optionId(laal, 'Extra bajra roti');
    const chef = await optionId(laal, 'As the chef makes it');

    await add({
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: await dishId(laal),
      quantity: 2,
      modifierOptionIds: [roti, chef],
    });

    const cart = await read();
    expect(cart!.lines).toHaveLength(1);
    // (1150 + 90) x 2 — modifiers price into the line before quantity.
    expect(cart!.lines[0]!.lineTotalMinor).toBe(248_000);
    expect(cart!.itemCount).toBe(2);
    expect(cart!.totals.subtotal.amountMinor).toBe(248_000);
  });

  it('merges an identical add rather than listing the dish twice', async () => {
    const chef = await optionId(laal, 'As the chef makes it');
    const item = await dishId(laal);
    const line = {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: item, quantity: 1, modifierOptionIds: [chef],
    };

    await add(line);
    await add(line);

    const cart = await read();
    expect(cart!.lines).toHaveLength(1);
    expect(cart!.lines[0]!.quantity).toBe(2);
  });

  it('keeps a different modifier choice as its own line', async () => {
    const item = await dishId(laal);
    const chef = await optionId(laal, 'As the chef makes it');
    const gentle = await optionId(laal, 'Gentle');

    await add({ tenantId: a.tenantId, propertyId: a.propertyId, stayId, menuItemId: item, quantity: 1, modifierOptionIds: [chef] });
    await add({ tenantId: a.tenantId, propertyId: a.propertyId, stayId, menuItemId: item, quantity: 1, modifierOptionIds: [gentle] });

    const cart = await read();
    expect(cart!.lines).toHaveLength(2);
  });

  it('keeps a different note as its own line', async () => {
    const item = await dishId(laal);
    const chef = await optionId(laal, 'As the chef makes it');
    const base = { tenantId: a.tenantId, propertyId: a.propertyId, stayId, menuItemId: item, quantity: 1, modifierOptionIds: [chef] };

    await add(base);
    await add({ ...base, notes: 'No coriander' });

    const cart = await read();
    expect(cart!.lines).toHaveLength(2);
    expect(cart!.lines.map((l) => l.notes)).toContain('No coriander');
  });

  it('refuses a modifier that is not on the dish', async () => {
    const foreign = await optionId('Kesar lassi', 'Cold');

    await expect(add({
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: await dishId(laal), quantity: 1, modifierOptionIds: [foreign],
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses to skip a required group', async () => {
    // Chilli is required, min 1. The screen preselects it; form data is not a
    // guarantee that it stayed selected.
    await expect(add({
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: await dishId(laal), quantity: 1, modifierOptionIds: [],
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses two picks in a single-select group', async () => {
    await expect(add({
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: await dishId(laal), quantity: 1,
      modifierOptionIds: [await optionId(laal, 'Gentle'), await optionId(laal, 'Extra fiery')],
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a dish the kitchen has pulled', async () => {
    const item = await dishId(laal);
    await owner.query(`UPDATE menu_items SET is_available = false WHERE id = $1`, [item]);
    try {
      await expect(add({
        tenantId: a.tenantId, propertyId: a.propertyId, stayId,
        menuItemId: item, quantity: 1,
        modifierOptionIds: [await optionId(laal, 'As the chef makes it')],
      })).rejects.toBeInstanceOf(ConflictError);
    } finally {
      await owner.query(`UPDATE menu_items SET is_available = true WHERE id = $1`, [item]);
    }
  });

  it('shows a line that went unavailable but does not charge for it', async () => {
    const item = await dishId(laal);
    await add({
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: item, quantity: 1,
      modifierOptionIds: [await optionId(laal, 'As the chef makes it')],
    });

    // Carts hold live prices, not snapshots — the kitchen pulling a dish has to
    // reach the guest, and it has to reach the total.
    await owner.query(`UPDATE menu_items SET is_available = false WHERE id = $1`, [item]);
    try {
      const cart = await read();
      expect(cart!.lines).toHaveLength(1);
      expect(cart!.lines[0]!.isAvailable).toBe(false);
      expect(cart!.totals.subtotal.amountMinor).toBe(0);
      expect(cart!.itemCount).toBe(0);
    } finally {
      await owner.query(`UPDATE menu_items SET is_available = true WHERE id = $1`, [item]);
    }
  });

  it('follows a live reprice, because a cart is not a receipt', async () => {
    const item = await dishId(laal);
    await add({
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: item, quantity: 1,
      modifierOptionIds: [await optionId(laal, 'As the chef makes it')],
    });

    await owner.query(`UPDATE menu_items SET price_minor = 999_00 WHERE id = $1`, [item]);
    try {
      const cart = await read();
      expect(cart!.lines[0]!.unitPriceMinor).toBe(99_900);
    } finally {
      await owner.query(`UPDATE menu_items SET price_minor = 115_000 WHERE id = $1`, [item]);
    }
  });

  it('treats quantity zero as removal', async () => {
    await add({
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: await dishId(laal), quantity: 3,
      modifierOptionIds: [await optionId(laal, 'As the chef makes it')],
    });
    const cart = await read();

    await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      setCartItemQuantity(tx, { stayId, cartItemId: cart!.lines[0]!.id, quantity: 0 }));

    expect((await read())!.lines).toHaveLength(0);
  });

  it('will not let one stay edit another stay’s line', async () => {
    await add({
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: await dishId(laal), quantity: 1,
      modifierOptionIds: [await optionId(laal, 'As the chef makes it')],
    });
    const cart = await read();
    const otherStay = await stayFor(a, await neighbourRoom());

    // Same tenant, same property, real line id — and still not theirs. RLS
    // confines this to the hotel; the stay check confines it to the guest.
    await expect(withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      removeCartItem(tx, { stayId: otherStay, cartItemId: cart!.lines[0]!.id })))
      .rejects.toBeInstanceOf(NotFoundError);
  });

  it('opens exactly one cart when two adds race', async () => {
    // A guest double-tapping "Add to order" on hotel wifi is the most common
    // duplicate in this product, and it is not hypothetical (#8).
    const item = await dishId(laal);
    const chef = await optionId(laal, 'As the chef makes it');
    const line = {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: item, quantity: 1, modifierOptionIds: [chef],
    };

    const results = await Promise.allSettled([add(line), add(line)]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const carts = await owner.query(`SELECT id FROM carts WHERE stay_id = $1`, [stayId]);
    expect(carts.rowCount).toBe(1);
  });

  it('cannot be read from another tenant', async () => {
    await add({
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: await dishId(laal), quantity: 1,
      modifierOptionIds: [await optionId(laal, 'As the chef makes it')],
    });

    const leaked = await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId }, (tx) =>
      getCart(tx, {
        propertyId: b.propertyId,
        stayId,
        outlet: { ...outlet, outletId: b.outletId },
      }));

    expect(leaked).toBeNull();
  });

  it('marks the no-extra choice so a line does not read "· Nothing"', async () => {
    const item = await dishId(laal);
    await add({
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: item, quantity: 1,
      modifierOptionIds: [
        await optionId(laal, 'As the chef makes it'),
        await optionId(laal, 'Nothing'),
      ],
    });

    const cart = await read();
    const modifiers = cart!.lines[0]!.modifiers;

    // Both are stored — the guest chose them, and the kitchen ticket is built
    // from what was chosen, not from what the screen felt like showing.
    expect(modifiers).toHaveLength(2);

    const nothing = modifiers.find((m) => m.name === 'Nothing')!;
    const chilli = modifiers.find((m) => m.name === 'As the chef makes it')!;

    // "Nothing" costs nothing and its group can be left empty: no-op.
    expect(nothing.isNoOp).toBe(true);
    // The chilli choice also costs nothing, but its group is REQUIRED — the
    // kitchen needs it, so it is not a no-op.
    expect(chilli.isNoOp).toBe(false);
  });
});