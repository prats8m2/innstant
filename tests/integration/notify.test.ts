import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, subscribeToChannel, closeNotifyConnection, notifyStatus } from '@/db';
import {
  seedMenu, getInRoomDiningMenu, getDish,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import {
  addToCart, placeOrder, advanceOrder, ORDER_CHANNEL, type OrderChangedPayload,
} from '@/modules/ordering';
import { ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, type Fixture } from './setup';

/**
 * `pg_notify` → LISTEN → in-process fan-out.
 *
 * The claim being tested is the one that makes this the right primitive: a
 * notification is delivered on COMMIT and never before, so a screen cannot be
 * told about a transition that then rolls back.
 */
describe('order notifications', () => {
  let owner: pg.Client;
  let a: Fixture;
  let stayId: string;
  let dish = '';
  let chefOption = '';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  /**
   * Collects notifications until `count` match, or the timeout expires.
   *
   * The filter is not optional in practice. A notification arrives some
   * milliseconds AFTER the commit that produced it, so an order created during
   * setup can land in a collector subscribed immediately afterwards — which is
   * how this suite started failing the moment placement began notifying.
   */
  function collect(
    count: number,
    options: { timeoutMs?: number; where?: (e: OrderChangedPayload) => boolean } = {},
  ) {
    const { timeoutMs = 8_000, where = () => true } = options;
    const received: OrderChangedPayload[] = [];
    let resolve!: () => void;
    const done = new Promise<void>((r) => { resolve = r; });
    const timer = setTimeout(() => resolve(), timeoutMs);

    const subscription = subscribeToChannel(ORDER_CHANNEL, (raw) => {
      const payload = raw as OrderChangedPayload;
      if (!where(payload)) return;
      received.push(payload);
      if (received.length >= count) {
        clearTimeout(timer);
        resolve();
      }
    });

    return {
      received,
      /** Wait until the database is actually LISTENing before provoking it. */
      ready: subscription.ready,
      async settle() {
        await done;
        clearTimeout(timer);
        subscription.unsubscribe();
        return received;
      },
    };
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
    stayId = await checkInGuest(a);

    const ids = await scoped(async (tx) => {
      const menu = await getInRoomDiningMenu(tx, a.propertyId);
      const item = menu!.sections.flatMap((s) => s.items)
        .find((i) => i.name === 'Laal maas with bajra roti')!;
      const detail = await getDish(tx, { propertyId: a.propertyId, itemId: item.id });
      return {
        dish: item.id,
        chef: detail!.modifierGroups.flatMap((g) => g.options)
          .find((o) => o.name === 'As the chef makes it')!.id,
      };
    });
    dish = ids.dish;
    chefOption = ids.chef;
  });

  afterAll(async () => {
    await closeNotifyConnection();
    await cleanup(owner);
    await owner.end();
  });

  async function anOrder(key: string): Promise<string> {
    await scoped((tx) => addToCart(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      menuItemId: dish, quantity: 1, modifierOptionIds: [chefOption],
    }));
    const placed = await scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      roomNumber: '214', idempotencyKey: key, accessTier: 'CHARGE',
    }));
    return placed.orderId;
  }

  it('delivers a transition to a listening process', async () => {
    const orderId = await anOrder('notify-1');
    const collector = collect(1, { where: (e) => e.orderId === orderId && e.status === 'ACCEPTED' });
    await collector.ready;

    await scoped((tx) => advanceOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, orderId,
      to: 'ACCEPTED', actor: { kind: 'SYSTEM' },
    }));

    const [event] = await collector.settle();
    expect(event).toBeDefined();
    expect(event!.orderId).toBe(orderId);
    expect(event!.status).toBe('ACCEPTED');
    expect(event!.outletId).toBe(a.outletId);
    expect(event!.propertyId).toBe(a.propertyId);
  });

  it('carries routing and status, and nothing a subscriber should not see', async () => {
    const orderId = await anOrder('notify-payload');
    const collector = collect(1, { where: (e) => e.orderId === orderId && e.status === 'ACCEPTED' });
    await collector.ready;

    await scoped((tx) => advanceOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, orderId,
      to: 'ACCEPTED', actor: { kind: 'SYSTEM' },
    }));

    const [event] = await collector.settle();
    // Every process listening on this database hears this. No money, no guest
    // name, no dish — the screen re-reads what it is allowed to see.
    expect(Object.keys(event!).sort()).toEqual([
      'orderId', 'orderNumber', 'outletId', 'propertyId', 'stayId', 'status', 'tenantId',
    ].sort());
    expect(JSON.stringify(event)).not.toMatch(/Laal maas|Anjali|minor/i);
  });

  it('says nothing at all when the transaction rolls back', async () => {
    const orderId = await anOrder('notify-rollback');
    const collector = collect(1, {
      timeoutMs: 2_500,
      where: (e) => e.orderId === orderId && e.status === 'ACCEPTED',
    });
    await collector.ready;

    await expect(
      scoped(async (tx) => {
        await advanceOrder(tx, {
          tenantId: a.tenantId, propertyId: a.propertyId, orderId,
          to: 'ACCEPTED', actor: { kind: 'SYSTEM' },
        });
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    // THE claim. Postgres holds notifications until COMMIT, so a kitchen screen
    // cannot be told about a transition that never happened — which an
    // out-of-band publish after the await could not promise.
    expect(await collector.settle()).toEqual([]);
  });

  it('delivers every hop, in order', async () => {
    const orderId = await anOrder('notify-many');
    const collector = collect(3, { where: (e) => e.orderId === orderId && e.status !== 'PLACED' });
    await collector.ready;

    for (const to of ['ACCEPTED', 'PREPARING', 'READY'] as const) {
      await scoped((tx) => advanceOrder(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, orderId,
        to, actor: { kind: 'SYSTEM' },
      }));
    }

    const events = await collector.settle();
    expect(events.map((e) => e.status)).toEqual(['ACCEPTED', 'PREPARING', 'READY']);
  });

  it('reports the listener as connected once something is subscribed', async () => {
    const collector = collect(1, { timeoutMs: 500 });
    await collector.ready;
    await collector.settle();
    expect(notifyStatus().channels).toContain(ORDER_CHANNEL);
  });

  it('announces the order arriving, not only what happens to it after', async () => {
    const collector = collect(1, { where: (e) => e.status === 'PLACED' });
    await collector.ready;

    const orderId = await anOrder('notify-placed');

    // A ticket appearing IS the event a kitchen is waiting for. Notifying only
    // on later transitions means every hop is live except the one that matters.
    const [event] = await collector.settle();
    expect(event?.orderId).toBe(orderId);
    expect(event?.status).toBe('PLACED');
  });
});