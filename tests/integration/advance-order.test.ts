import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  seedMenu, getInRoomDiningMenu, getDish,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import {
  addToCart, placeOrder, advanceOrder, kitchenTickets, runnerTickets, openTicketCount,
} from '@/modules/ordering';
import { getFolioForStay, reverseFolioLinesForSource } from '@/modules/billing';
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
 * Moving an order through the machine, against a real database.
 *
 * The unit tests in `transitions.test.ts` prove the table. These prove the
 * things only Postgres can: that the compare-and-set actually stops two
 * tablets bumping one ticket, and that the event log follows every hop.
 */
describe('advanceOrder', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let stayId: string;
  let dish = '';
  let chefOption = '';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const staff = { kind: 'STAFF' as const, staffUserId: '11111111-1111-4111-8111-111111111111' };

  async function anOrder(key: string): Promise<{ orderId: string; orderNumber: string }> {
    await scoped((tx) => addToCart(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: dish, quantity: 1, modifierOptionIds: [chefOption],
    }));
    const placed = await scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      roomNumber: '214', idempotencyKey: key, accessTier: 'CHARGE',
    }));
    return { orderId: placed.orderId, orderNumber: placed.orderNumber };
  }

  const advance = (orderId: string, to: Parameters<typeof advanceOrder>[1]['to'], extra = {}) =>
    scoped((tx) => advanceOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, orderId, to, actor: staff, ...extra,
    }));

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

    stayId = await checkInGuest(a);

    const ids = await scoped(async (tx) => {
      const menu = await getInRoomDiningMenu(tx, a.propertyId, AT_NINE_PM);
      const item = menu!.sections.flatMap((s) => s.items)
        .find((i) => i.name === 'Laal maas with bajra roti')!;
      const detail = await getDish(tx, { propertyId: a.propertyId, itemId: item.id });
      const chef = detail!.modifierGroups.flatMap((g) => g.options)
        .find((o) => o.name === 'As the chef makes it')!;
      return { dish: item.id, chef: chef.id };
    });
    dish = ids.dish;
    chefOption = ids.chef;
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['order_item_modifiers', 'order_items', 'orders', 'folio_lines', 'folios',
                     'cart_item_modifiers', 'cart_items', 'carts', 'idempotency_keys']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [TENANT_A]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = $1`, [TENANT_A]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('walks a ticket from placed to closed, stamping each step', async () => {
    const { orderId } = await anOrder('walk');

    for (const to of ['ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CLOSED'] as const) {
      const result = await advance(orderId, to);
      expect(result.to).toBe(to);
    }

    const row = await owner.query(
      `SELECT status, accepted_at, preparing_at, ready_at, out_for_delivery_at,
              delivered_at, closed_at FROM orders WHERE id = $1`, [orderId]);
    const order = row.rows[0];
    expect(order.status).toBe('CLOSED');
    // DATA-MODEL §6 — the columns make the SLA dashboard cheap, the log makes
    // it provable, and they are written in the same transaction.
    for (const column of ['accepted_at', 'preparing_at', 'ready_at',
                          'out_for_delivery_at', 'delivered_at', 'closed_at']) {
      expect(order[column], column).not.toBeNull();
    }
  });

  it('writes an event for every hop, in order (#7)', async () => {
    const { orderId } = await anOrder('events');
    await advance(orderId, 'ACCEPTED');
    await advance(orderId, 'PREPARING');

    const events = await scoped((tx) => readEventHistory(tx, 'order', orderId));
    expect(events.map((e) => e.event_type)).toEqual([
      'order.placed', 'order.accepted', 'order.preparing',
    ]);
    expect(events[2]!.from_status).toBe('ACCEPTED');
    expect(events[2]!.to_status).toBe('PREPARING');
    expect(events[2]!.actor_kind).toBe('STAFF');
  });

  it('records one transition when two tablets bump the same ticket', async () => {
    const { orderId } = await anOrder('race');
    await advance(orderId, 'ACCEPTED');

    // Two screens in a kitchen, one ticket, the same button, the same instant.
    // Both callers get what they asked for — the ticket IS preparing — but the
    // transition happened once, so the log and the timestamp say so once.
    const results = await Promise.allSettled([
      advance(orderId, 'PREPARING'),
      advance(orderId, 'PREPARING'),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const events = await scoped((tx) => readEventHistory(tx, 'order', orderId));
    expect(events.filter((e) => e.event_type === 'order.preparing')).toHaveLength(1);
  });

  it('interrupts only when the ticket actually diverged', async () => {
    const { orderId } = await anOrder('diverged');
    await advance(orderId, 'ACCEPTED');
    await advance(orderId, 'CANCELLED', { reason: 'Guest rang the desk.' });

    // A cook who was mid-tap when the front desk cancelled needs to be told —
    // this is the case the conflict message exists for.
    await expect(advance(orderId, 'PREPARING')).rejects.toBeInstanceOf(ConflictError);
  });

  it('treats a repeated tap as a no-op rather than an error', async () => {
    const { orderId } = await anOrder('double-tap');
    await advance(orderId, 'ACCEPTED');
    const again = await advance(orderId, 'ACCEPTED');

    // The second tap wanted the state it already has. Telling a busy kitchen
    // off for it is noise.
    expect(again.to).toBe('ACCEPTED');
    const events = await scoped((tx) => readEventHistory(tx, 'order', orderId));
    expect(events.filter((e) => e.event_type === 'order.accepted')).toHaveLength(1);
  });

  it('refuses a hop the machine does not allow', async () => {
    const { orderId } = await anOrder('illegal');
    await expect(advance(orderId, 'DELIVERED')).rejects.toBeInstanceOf(ConflictError);
  });

  it('will not reject without a reason the guest can be told', async () => {
    const { orderId } = await anOrder('no-reason');
    await expect(advance(orderId, 'REJECTED')).rejects.toBeInstanceOf(ValidationError);

    const rejected = await advance(orderId, 'REJECTED', { reason: 'No sole left tonight.' });
    expect(rejected.to).toBe('REJECTED');

    const row = await owner.query(`SELECT rejection_reason FROM orders WHERE id = $1`, [orderId]);
    expect(row.rows[0].rejection_reason).toBe('No sole left tonight.');
  });

  it('says an order is already finished rather than that the hop is illegal', async () => {
    const { orderId, orderNumber } = await anOrder('terminal');
    await advance(orderId, 'CANCELLED', { reason: 'Guest changed their mind.' });

    // "KE-1184 is already cancelled" is actionable; "cannot go from CANCELLED
    // to ACCEPTED" is a state machine talking to a cook.
    await expect(advance(orderId, 'ACCEPTED'))
      .rejects.toThrow(new RegExp(`${orderNumber} is already cancelled`));
  });

  it('refuses an order at another property', async () => {
    const { orderId } = await anOrder('other-property');
    await expect(
      withTenant({ tenantId: b.tenantId, propertyId: b.propertyId }, (tx) =>
        advanceOrder(tx, {
          tenantId: b.tenantId, propertyId: b.propertyId, orderId, to: 'ACCEPTED', actor: staff,
        })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('builds the kitchen rail oldest first, from snapshots', async () => {
    const first = await anOrder('rail-1');
    await new Promise((r) => setTimeout(r, 15));
    const second = await anOrder('rail-2');

    const tickets = await scoped((tx) => kitchenTickets(tx, { outletId: a.outletId }));
    // Newest-first starves the ticket that has waited longest — which is
    // exactly the one the guest is about to ring about.
    expect(tickets.map((t) => t.orderNumber)).toEqual([first.orderNumber, second.orderNumber]);

    const ticket = tickets[0]!;
    expect(ticket.roomNumber).toBe('214');
    expect(ticket.lines[0]!.name).toBe('Laal maas with bajra roti');
    expect(ticket.lines[0]!.modifiers).toEqual(['As the chef makes it']);
    expect(ticket.status).toBe('PLACED');
  });

  it('drops a ticket off the rail when it leaves the kitchen', async () => {
    const { orderId } = await anOrder('rail-drop');
    expect(await scoped((tx) => openTicketCount(tx, a.outletId))).toBe(1);

    await advance(orderId, 'ACCEPTED');
    await advance(orderId, 'PREPARING');
    await advance(orderId, 'READY');
    expect(await scoped((tx) => openTicketCount(tx, a.outletId))).toBe(1);

    // READY is still the kitchen's until someone carries it.
    const runner = await scoped((tx) => runnerTickets(tx, { outletId: a.outletId }));
    expect(runner).toHaveLength(1);

    await advance(orderId, 'DELIVERED');
    expect(await scoped((tx) => openTicketCount(tx, a.outletId))).toBe(0);
  });

  describe('the runner queue', () => {
    const queue = () => scoped((tx) => runnerTickets(tx, { outletId: a.outletId }));
    const runner = '22222222-2222-4222-8222-222222222222';

    it('puts trays still waiting before trays already being carried', async () => {
      const first = await anOrder('queue-first');
      const second = await anOrder('queue-second');

      for (const { orderId } of [first, second]) {
        await advance(orderId, 'ACCEPTED');
        await advance(orderId, 'PREPARING');
        await advance(orderId, 'READY');
      }

      // Someone takes the OLDER one up. The kitchen's rail would still list it
      // first — by placed_at — but a runner walking to the pass wants the tray
      // they can actually pick up at the top.
      await advance(first.orderId, 'OUT_FOR_DELIVERY', { assignedRunnerId: runner });

      const tickets = await queue();
      expect(tickets.map((t) => t.orderNumber))
        .toEqual([second.orderNumber, first.orderNumber]);
      expect(tickets[0]!.status).toBe('READY');
      expect(tickets[1]!.status).toBe('OUT_FOR_DELIVERY');
    });

    it('records who is carrying a tray, and only on the pickup', async () => {
      const { orderId } = await anOrder('queue-assign');
      await advance(orderId, 'ACCEPTED');
      await advance(orderId, 'PREPARING');
      await advance(orderId, 'READY');
      expect((await queue())[0]!.assignedRunnerId).toBeNull();

      await advance(orderId, 'OUT_FOR_DELIVERY', { assignedRunnerId: runner });
      expect((await queue())[0]!.assignedRunnerId).toBe(runner);

      // Handing over must not reassign the tray to whoever tapped: the SLA
      // report reads this column to answer who carried it.
      await advance(orderId, 'DELIVERED');
      const row = await owner.query(
        `SELECT assigned_runner_id, delivered_at FROM orders WHERE id = $1`, [orderId]);
      expect(row.rows[0].assigned_runner_id).toBe(runner);
      expect(row.rows[0].delivered_at).not.toBeNull();
    });

    it('is empty once the tray is handed over', async () => {
      const { orderId } = await anOrder('queue-empty');
      await advance(orderId, 'ACCEPTED');
      await advance(orderId, 'PREPARING');
      await advance(orderId, 'READY');
      await advance(orderId, 'OUT_FOR_DELIVERY', { assignedRunnerId: runner });
      await advance(orderId, 'DELIVERED');

      expect(await queue()).toHaveLength(0);
      // And the charge stays: delivered is the one ending where the hotel is
      // owed the money.
      const folio = await scoped((tx) => getFolioForStay(tx, stayId));
      expect(folio!.chargesMinor).toBeGreaterThan(0);
    });
  });

  /**
   * The money half of a rejection.
   *
   * `placeOrder()` posts the folio line at placement so "Charged to room 214"
   * is true when the guest presses Send. These prove the other half: an order
   * the kitchen cannot make leaves nothing behind on the bill — which is also
   * what lets the guest's tracking screen say "nothing has been charged"
   * (src/modules/ordering/track.ts).
   */
  describe('the folio, when an order does not happen', () => {
    const folio = () => scoped((tx) => getFolioForStay(tx, stayId));

    it('credits the charge back in the same transaction as the rejection', async () => {
      const { orderId, orderNumber } = await anOrder('reject-credit');

      const charged = await folio();
      expect(charged!.chargesMinor).toBeGreaterThan(0);
      const chargeMinor = charged!.chargesMinor;

      await advance(orderId, 'REJECTED', { reason: 'Out of sole tonight.' });

      const after = await folio();
      // Net zero, and the ORIGINAL charge is still there. DATA-MODEL §5: a
      // correction is a negative ADJUSTMENT row, never an edit — at 7am on
      // checkout day both sides can see what happened.
      expect(after!.chargesMinor).toBe(0);
      expect(after!.balanceMinor).toBe(0);

      const forOrder = after!.lines.filter((l) => l.sourceRefId === orderId);
      expect(forOrder).toHaveLength(2);
      expect(forOrder.map((l) => l.source).sort()).toEqual(['ADJUSTMENT', 'ORDER']);
      const credit = forOrder.find((l) => l.source === 'ADJUSTMENT')!;
      expect(credit.amountMinor).toBe(-chargeMinor);
      // The guest reads this line on their bill; it has to name what it undoes.
      expect(credit.description).toContain(orderNumber);
    });

    it('writes the credit to the event log, with who did it', async () => {
      const { orderId } = await anOrder('reject-event');
      await advance(orderId, 'REJECTED', { reason: 'The tandoor is down.' });

      const events = await scoped((tx) => readEventHistory(tx, 'order', orderId));
      const reversal = events.find((e) => e.event_type === 'order.charge_reversed');
      expect(reversal, 'a credit that is not in the log cannot be audited').toBeTruthy();
      expect(reversal!.actor_kind).toBe('STAFF');
      expect(Number((reversal!.payload as { amountMinor: number }).amountMinor)).toBeLessThan(0);
    });

    it('credits a cancellation the same way', async () => {
      const { orderId } = await anOrder('cancel-credit');
      await advance(orderId, 'CANCELLED', { reason: 'Guest rang the desk.' });

      const after = await folio();
      expect(after!.chargesMinor).toBe(0);
      expect(after!.lines.filter((l) => l.sourceRefId === orderId)).toHaveLength(2);
    });

    it('credits once when two tablets reject the same ticket at once (#8)', async () => {
      const { orderId } = await anOrder('reject-race');
      const chargeMinor = (await folio())!.chargesMinor;

      // Two kitchen screens, one ticket, the same instant. The compare-and-set
      // decides the transition; the credit must not be posted twice behind it.
      const results = await Promise.allSettled([
        advance(orderId, 'REJECTED', { reason: 'Out of sole.' }),
        advance(orderId, 'REJECTED', { reason: 'Out of sole.' }),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      const after = await folio();
      const credits = after!.lines.filter((l) => l.source === 'ADJUSTMENT');
      expect(credits).toHaveLength(1);
      expect(credits[0]!.amountMinor).toBe(-chargeMinor);
      // Double-crediting is worse than not crediting: it pays the guest to be
      // rejected, and it is invisible until someone reconciles the day.
      expect(after!.chargesMinor).toBe(0);
    });

    it('does not credit twice when the credit is asked for again', async () => {
      const { orderId } = await anOrder('reverse-twice');
      const chargeMinor = (await folio())!.chargesMinor;
      await advance(orderId, 'REJECTED', { reason: 'Out of sole.' });

      // Calling the reversal directly, as a desk screen or a repair script
      // might. It nets against what is posted, so there is nothing left to do.
      const again = await scoped((tx) => reverseFolioLinesForSource(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, stayId,
        sourceRefId: orderId, description: 'Reversed again',
      }));
      expect(again).toBeNull();

      const after = await folio();
      expect(after!.chargesMinor).toBe(0);
      expect(after!.lines.filter((l) => l.source === 'ADJUSTMENT')).toHaveLength(1);
      expect(after!.lines.find((l) => l.source === 'ADJUSTMENT')!.amountMinor).toBe(-chargeMinor);
    });

    it('leaves other orders on the folio alone', async () => {
      const { orderId: rejected } = await anOrder('one-of-two-a');
      const { orderId: kept } = await anOrder('one-of-two-b');
      const both = (await folio())!.chargesMinor;

      await advance(rejected, 'REJECTED', { reason: 'Out of sole.' });

      const after = await folio();
      // Exactly the rejected order's share came off, and the other dinner is
      // still chargeable. A reversal that nets the whole folio would zero a
      // bill the hotel is owed.
      expect(after!.chargesMinor).toBe(both / 2);
      expect(after!.lines.filter((l) => l.sourceRefId === kept)).toHaveLength(1);
    });
  });

  it('carries the kitchen the allergy that applied on the night', async () => {
    await owner.query(
      `UPDATE guest_property_profiles SET dietary_flags = '["NUT_ALLERGY"]'::jsonb
       WHERE property_id = $1`, [a.propertyId]);
    const { orderId } = await anOrder('allergy');

    const tickets = await scoped((tx) => kitchenTickets(tx, { outletId: a.outletId }));
    expect(tickets.find((t) => t.id === orderId)!.dietaryFlags).toEqual(['NUT_ALLERGY']);

    // Copied onto the order at placement (DATA-MODEL §4) — changing the profile
    // now must not rewrite a ticket the kitchen is already cooking from.
    await owner.query(
      `UPDATE guest_property_profiles SET dietary_flags = '[]'::jsonb WHERE property_id = $1`,
      [a.propertyId]);
    const after = await scoped((tx) => kitchenTickets(tx, { outletId: a.outletId }));
    expect(after.find((t) => t.id === orderId)!.dietaryFlags).toEqual(['NUT_ALLERGY']);
  });
});
