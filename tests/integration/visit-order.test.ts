import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { withTenant, readEventHistory, resolveVisitLink } from '@/db';
import {
  seedMenu, getInRoomDiningMenu,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import {
  quickAddDish, getCart, placeOrder, getOrderForContext, listOrdersForContext,
  visitContext, kitchenTickets,
} from '@/modules/ordering';
import {
  createVisitLink, openVisit, setVisitDetails, destinationLabelFor,
  listVisitLinks, revokeVisitLink,
} from '@/modules/visit';
import { scanVisitLink, resolveVisitSession, resolveStaySession, QrNotUsableError } from '@/modules/access';
import { ValidationError } from '@/lib/errors';
import { ownerClient, seedTenant, cleanup, TENANT_A, type Fixture } from './setup';

/**
 * Ordering with no room. D-079.
 *
 * The room flow has a stay behind every cart, every order and every session,
 * and five of the non-negotiables lean on it. This suite is the proof that the
 * sibling path holds the same guarantees without one:
 *
 *   #6 the receipt is snapshotted — INCLUDING where the tray goes, which is
 *      the column this feature added.
 *   #7 every transition writes `event_log` in the same transaction.
 *   #8 the whole thing is idempotent under a real double-tap.
 *   #10 a session resolves to its own context and to nothing else.
 *
 * And the one thing that is DELIBERATELY different: no folio line. A visit
 * pays per order, at the counter or at the door.
 */
const AT_NINE_PM = { dayOfWeek: 3, minutes: 21 * 60 };

describe('ordering through a property link', () => {
  let owner: pg.Client;
  let a: Fixture;
  let dish = '';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  beforeEach(async () => {
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

    /**
     * A dish the menu list can add on its own — one whose required choices all
     * have a default the kitchen is willing to make.
     *
     * The fixture below adds it with `quickAddDish()`, which is the exact path
     * the stepper on the menu card takes. `addToCart()` with no modifiers would
     * fail a required group's minimum, correctly: `canQuickAdd` means defaults
     * EXIST, not that there is nothing to choose.
     */
    dish = await scoped(async (tx) => {
      const menu = await getInRoomDiningMenu(tx, a.propertyId, AT_NINE_PM);
      const quick = menu!.sections.flatMap((s) => s.items).find((i) => i.canQuickAdd);
      if (!quick) throw new Error('the seeded menu has no quick-addable dish');
      return quick.id;
    });
  });

  /** A link of the given kind, and the code it carries. */
  async function link(
    kind: 'TABLE' | 'COUNTER' | 'ONLINE',
    tableLabel: string | null = null,
  ): Promise<string> {
    const created = await scoped((tx) => createVisitLink(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      outletId: a.outletId,
      kind,
      label: `${kind} link`,
      tableLabel,
    }));
    return created.publicCode;
  }

  /* ── The link itself ──────────────────────────────────────────────────── */

  it('a table link carries its table, and a counter link may not', async () => {
    await link('TABLE', 'Courtyard 4');

    await expect(
      link('TABLE', null),
    ).rejects.toThrow(ValidationError);

    await expect(
      link('COUNTER', 'Courtyard 4'),
    ).rejects.toThrow(ValidationError);
  });

  it('resolves pre-tenant, returning routing ids and nothing else', async () => {
    const code = await link('TABLE', 'Courtyard 4');

    // The one unscoped lookup on this path, outside withTenant() — this is how
    // a request with no cookie learns which tenant it belongs to.
    const routing = await resolveVisitLink(code);

    expect(routing).toMatchObject({
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      outletId: a.outletId,
      kind: 'TABLE',
      tableLabel: 'Courtyard 4',
      revokedAt: null,
    });
    // Nothing about a customer, an order or a total crosses this boundary.
    expect(Object.keys(routing!).sort()).toEqual([
      'kind', 'outletId', 'propertyId', 'revokedAt', 'tableLabel', 'tenantId',
      'version', 'visitLinkId',
    ]);
  });

  it('a revoked link stops opening, and says nothing about why', async () => {
    const code = await link('ONLINE');
    const [row] = await scoped((tx) => listVisitLinks(tx, { propertyId: a.propertyId }));

    await scoped((tx) => revokeVisitLink(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      visitLinkId: row!.id,
    }));

    await expect(scanVisitLink(code)).rejects.toThrow(QrNotUsableError);
  });

  /* ── The session ──────────────────────────────────────────────────────── */

  it('opens at CHARGE with nobody identified, and stays anonymous', async () => {
    const code = await link('TABLE', 'Courtyard 4');
    const scan = await scanVisitLink(code);

    expect(scan.session.kind).toBe('VISIT');
    // The whole of D-079's access argument: there is no room to post to, so
    // there is nothing for a prompt to defend — but nobody has proved anything.
    expect(scan.session.accessTier).toBe('CHARGE');
    expect(scan.session.isAnonymous).toBe(true);
    expect(scan.session.customerName).toBeNull();
    expect(scan.session.tableLabel).toBe('Courtyard 4');
    expect(scan.next).toBe(`/p/${code}/menu`);
  });

  it('a visit session is not a stay session, and vice versa', async () => {
    const code = await link('COUNTER');
    const scan = await scanVisitLink(code);

    // #10, one level up. The narrowing helpers are what keep every `/r/*`
    // screen from rendering a session that has no room behind it.
    expect(await resolveVisitSession(scan.cookieValue)).not.toBeNull();
    expect(await resolveStaySession(scan.cookieValue)).toBeNull();
  });

  it('each open of a table tent is its own visit', async () => {
    const code = await link('TABLE', 'Courtyard 4');
    const first = await scanVisitLink(code);
    const second = await scanVisitLink(code);

    // Two people at two tables scanning the same design of tent must not share
    // a cart — and two rounds at one table are two visits, not one ticket.
    expect(first.session.visitId).not.toBe(second.session.visitId);
  });

  /* ── Identifying ──────────────────────────────────────────────────────── */

  it('refuses a delivery with no address, and a name that is not one', async () => {
    const code = await link('ONLINE');
    const scan = await scanVisitLink(code);

    const details = {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      visitId: scan.session.visitId,
      name: 'Priya',
      phone: '+91 98290 11111',
      fulfilment: 'DELIVERY' as const,
    };

    await expect(
      scoped((tx) => setVisitDetails(tx, details)),
    ).rejects.toThrow(ValidationError);

    await expect(
      scoped((tx) => setVisitDetails(tx, { ...details, fulfilment: 'TAKEAWAY', name: 'P' })),
    ).rejects.toThrow(ValidationError);

    await expect(
      scoped((tx) => setVisitDetails(tx, { ...details, fulfilment: 'TAKEAWAY', phone: '12' })),
    ).rejects.toThrow(ValidationError);
  });

  it('a table tent overrules a posted fulfilment', async () => {
    const code = await link('TABLE', 'Courtyard 4');
    const scan = await scanVisitLink(code);

    const visit = await scoped((tx) => setVisitDetails(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      visitId: scan.session.visitId,
      name: 'Priya',
      phone: '+91 98290 11111',
      // A stale page, or somebody with a devtools console. The link's own kind
      // wins: a form is a suggestion.
      fulfilment: 'DELIVERY',
      deliveryAddress: '12 MG Road',
    }));

    expect(visit.fulfilment).toBe('DINE_IN');
    expect(visit.deliveryAddress).toBeNull();
    expect(destinationLabelFor(visit)).toBe('Courtyard 4');
  });

  it('matches an existing guest on (tenant, phone)', async () => {
    const phone = '+91 98290 22222';

    const one = await scoped(async (tx) => {
      const visit = await openVisit(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId,
        fulfilment: 'TAKEAWAY',
      });
      return setVisitDetails(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, visitId: visit.id,
        name: 'Priya Sharma', phone, fulfilment: 'TAKEAWAY',
      });
    });

    const two = await scoped(async (tx) => {
      const visit = await openVisit(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId,
        fulfilment: 'TAKEAWAY',
      });
      return setVisitDetails(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, visitId: visit.id,
        // The same person, a week later, typing their name differently.
        name: 'priya', phone, fulfilment: 'TAKEAWAY',
      });
    });

    // EXTENSION-POINTS §2 — one person, one `guests` row, no merge script later.
    const guestIds = await scoped(async (tx) => {
      const rows = await tx.execute<{ guest_id: string }>(
        sql`SELECT guest_id FROM visits WHERE id IN (${one.id}, ${two.id})`,
      );
      return rows.rows.map((r) => r.guest_id);
    });
    expect(new Set(guestIds).size).toBe(1);
  });

  /* ── The order ────────────────────────────────────────────────────────── */

  /** A named visit with one dish in its cart, ready to send. */
  async function readyToSend(
    kind: 'TABLE' | 'COUNTER' | 'ONLINE',
    tableLabel: string | null = null,
    fulfilment: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' = 'TAKEAWAY',
  ) {
    const code = await link(kind, tableLabel);
    const scan = await scanVisitLink(code);
    const context = visitContext(scan.session.visitId);

    // Twice, which is what two taps of the plus on a menu card does.
    for (let i = 0; i < 2; i += 1) {
      await scoped((tx) => quickAddDish(tx, {
        tenantId: a.tenantId,
        propertyId: a.propertyId,
        context,
        outletId: a.outletId,
        menuItemId: dish,
      }));
    }

    const visit = await scoped((tx) => setVisitDetails(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      visitId: scan.session.visitId,
      name: 'Priya Sharma',
      phone: '+91 98290 33333',
      fulfilment,
      deliveryAddress: fulfilment === 'DELIVERY' ? '12 MG Road, 2nd floor' : null,
    }));

    return { scan, context, visit };
  }

  it('places an order, snapshots where it goes, and posts no folio line', async () => {
    const { scan, context, visit } = await readyToSend('TABLE', 'Courtyard 4', 'DINE_IN');

    const placed = await scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      context,
      outletId: a.outletId,
      fulfilment: visit.fulfilment,
      destinationLabel: destinationLabelFor(visit),
      idempotencyKey: crypto.randomUUID(),
      accessTier: scan.session.accessTier,
      guestSessionId: scan.session.id,
    }));

    expect(placed.wasAlreadyPlaced).toBe(false);

    const order = await scoped((tx) => getOrderForContext(tx, { context, orderId: placed.orderId }));
    expect(order!.lines).toHaveLength(1);
    expect(order!.lines[0]!.quantity).toBe(2);

    // #6 applied to the destination — the cook reads this, not a join.
    const ticket = (await scoped((tx) => kitchenTickets(tx, { outletId: a.outletId })))
      .find((t) => t.id === placed.orderId);
    expect(ticket).toBeDefined();
    expect(ticket!.destination).toBe('Courtyard 4');
    expect(ticket!.fulfilment).toBe('DINE_IN');
    // The room is NULL, which is the honest answer and what keeps this order
    // off the front desk's room board.
    expect(ticket!.roomNumber).toBeNull();

    // #7 — the transition is in the log, in the same transaction.
    const history = await scoped((tx) => readEventHistory(tx, 'order', placed.orderId));
    expect(history.map((e) => e.event_type)).toContain('order.placed');

    // The deliberate absence. A visit has no stay, so there is no folio to
    // open, nothing to settle at a checkout that never happens, and the order's
    // own total is the record of what is owed.
    const folios = await scoped(async (tx) => {
      const rows = await tx.execute<{ n: string }>(sql`SELECT count(*) AS n FROM folios`);
      return Number(rows.rows[0]!.n);
    });
    expect(folios).toBe(0);
    expect(scan.session.visitId).toBe(visit.id);
  });

  it('a delivery ticket carries the address', async () => {
    const { scan, context, visit } = await readyToSend('ONLINE', null, 'DELIVERY');

    const placed = await scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context,
      outletId: a.outletId,
      fulfilment: visit.fulfilment,
      destinationLabel: destinationLabelFor(visit),
      idempotencyKey: crypto.randomUUID(),
      accessTier: scan.session.accessTier,
    }));

    const ticket = (await scoped((tx) => kitchenTickets(tx, { outletId: a.outletId })))
      .find((t) => t.id === placed.orderId);
    expect(ticket!.destination).toBe('Delivery · 12 MG Road, 2nd floor');
    expect(ticket!.fulfilment).toBe('DELIVERY');
  });

  it('is idempotent under a double-tap', async () => {
    const { scan, context, visit } = await readyToSend('COUNTER');
    const key = crypto.randomUUID();

    const input = {
      tenantId: a.tenantId, propertyId: a.propertyId, context,
      outletId: a.outletId,
      fulfilment: visit.fulfilment,
      destinationLabel: destinationLabelFor(visit),
      idempotencyKey: key,
      accessTier: scan.session.accessTier,
    };

    const first = await scoped((tx) => placeOrder(tx, input));
    const second = await scoped((tx) => placeOrder(tx, input));

    // #8. The most common duplicate in this product is a second tap on a slow
    // connection, and it is no less common on a pavement than in a room.
    expect(second.wasAlreadyPlaced).toBe(true);
    expect(second.orderId).toBe(first.orderId);

    const orders = await scoped((tx) => listOrdersForContext(tx, { context }));
    expect(orders).toHaveLength(1);
  });

  it('empties its own cart and nobody else’s', async () => {
    const mine = await readyToSend('COUNTER');
    const theirs = await readyToSend('COUNTER');

    await scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context: mine.context,
      outletId: a.outletId,
      fulfilment: mine.visit.fulfilment,
      destinationLabel: destinationLabelFor(mine.visit),
      idempotencyKey: crypto.randomUUID(),
      accessTier: mine.scan.session.accessTier,
    }));

    const outlet = {
      outletId: a.outletId, currency: 'INR' as const,
      taxRateBps: 0, serviceChargeBps: 0, deliveryFeeMinor: 0,
    };

    // The partial unique indexes in 0008 are what make these two separate carts
    // at all — a composite index over a nullable column constrains nothing.
    expect(await scoped((tx) => getCart(tx, {
      propertyId: a.propertyId, context: mine.context, outlet,
    }))).toBeNull();
    expect(await scoped((tx) => getCart(tx, {
      propertyId: a.propertyId, context: theirs.context, outlet,
    }))).not.toBeNull();
  });

  it('one visit cannot read another’s order', async () => {
    const mine = await readyToSend('COUNTER');
    const theirs = await readyToSend('COUNTER');

    const placed = await scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context: mine.context,
      outletId: a.outletId,
      fulfilment: mine.visit.fulfilment,
      destinationLabel: destinationLabelFor(mine.visit),
      idempotencyKey: crypto.randomUUID(),
      accessTier: mine.scan.session.accessTier,
    }));

    // The order id travels in a URL. RLS confines it to the tenant; the context
    // check is what confines it to the one customer.
    expect(await scoped((tx) => getOrderForContext(tx, {
      context: theirs.context, orderId: placed.orderId,
    }))).toBeNull();
    expect(await scoped((tx) => getOrderForContext(tx, {
      context: mine.context, orderId: placed.orderId,
    }))).not.toBeNull();
  });
});
