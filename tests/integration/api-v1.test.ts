import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant } from '@/db';
import {
  seedMenu, getMenu,
  KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import { createVisitLink, setVisitDetails, destinationLabelFor } from '@/modules/visit';
import { quickAddDish, placeOrder, advanceOrder, visitContext } from '@/modules/ordering';
import { scanVisitLink } from '@/modules/access';
import { guestCredentialFrom, visitSessionFrom, BEARER_PREFIX } from '@/lib/api-auth';
import { GUEST_SESSION_COOKIE } from '@/modules/access';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, type Fixture,
} from './setup';
import type {
  ApiMenu, ApiOrderSummary, ApiReorderSuggestion, ApiReorderResult,
} from '@/lib/api-contract';

/**
 * The mobile API's auth seam. D-080.
 *
 * The routes themselves are exercised over HTTP — they are thin, and what is
 * worth a test here is the thing underneath them that is NOT thin: that a
 * bearer token and a cookie resolve to the SAME session, with the same
 * revocation and the same expiry, because there is only one session model.
 *
 * If this file ever needs a second session table to pass, the design has gone
 * wrong somewhere upstream of it.
 */
describe('/api/v1 credentials', () => {
  let owner: pg.Client;
  let a: Fixture;
  let token = '';

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
      tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId,
      categories: KESARI_CATEGORIES, items: KESARI_MENU,
      collections: KESARI_COLLECTIONS, modifierGroups: KESARI_MODIFIER_GROUPS,
    }));

    const link = await scoped((tx) => createVisitLink(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId,
      kind: 'ONLINE', label: 'api test',
    }));
    token = (await scanVisitLink(link.publicCode)).cookieValue;
  });

  const req = (headers: Record<string, string>) =>
    new Request('http://localhost/api/v1/menu', { headers });

  it('reads a bearer token', async () => {
    const session = await visitSessionFrom(req({ authorization: `${BEARER_PREFIX}${token}` }));
    expect(session?.kind).toBe('VISIT');
  });

  it('resolves a bearer and a cookie to the same session', async () => {
    const viaHeader = await visitSessionFrom(req({ authorization: `${BEARER_PREFIX}${token}` }));
    const viaCookie = await visitSessionFrom(
      req({ cookie: `${GUEST_SESSION_COOKIE}=${token}` }),
    );

    // The same row, not merely two working sessions. One session model is the
    // whole point: revoke it and both die, which a stateless token could not
    // promise.
    expect(viaHeader!.id).toBe(viaCookie!.id);
    expect(viaHeader!.visitId).toBe(viaCookie!.visitId);
  });

  it('prefers the header when both are present', async () => {
    // An explicit credential beats an ambient one. A browser that still holds
    // a stale cookie must not override the token a caller just chose to send.
    const credential = await guestCredentialFrom(req({
      authorization: `${BEARER_PREFIX}${token}`,
      cookie: `${GUEST_SESSION_COOKIE}=something-else`,
    }));
    expect(credential).toBe(token);
  });

  it('refuses a malformed, empty or absent credential', async () => {
    expect(await visitSessionFrom(req({}))).toBeNull();
    expect(await visitSessionFrom(req({ authorization: 'Bearer ' }))).toBeNull();
    expect(await visitSessionFrom(req({ authorization: 'Bearer nonsense' }))).toBeNull();
    // A real tenant id with a token that was never issued.
    expect(await visitSessionFrom(req({
      authorization: `${BEARER_PREFIX}${a.tenantId}.never-issued`,
    }))).toBeNull();
    // The right token in the wrong scheme.
    expect(await visitSessionFrom(req({ authorization: token }))).toBeNull();
  });

  it('dies with the visit, exactly as the cookie does', async () => {
    const { closeVisit } = await import('@/modules/visit');
    const session = (await visitSessionFrom(req({ authorization: `${BEARER_PREFIX}${token}` })))!;

    await scoped((tx) => closeVisit(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      visitId: session.visitId,
      reason: 'test',
    }));

    // #10 — a credential whose context is gone resolves to nothing, whichever
    // envelope it arrived in. This is what a JWT would have thrown away.
    expect(await visitSessionFrom(req({ authorization: `${BEARER_PREFIX}${token}` }))).toBeNull();
  });

  it('a stay session is not a visit session on this API', async () => {
    // A room sticker needs somebody actually checked in before it resolves —
    // a scan against an empty room is `QrNotUsableError`, which is the
    // occupancy guard doing its job rather than anything to do with this API.
    await checkInGuest(a);

    // `/api/v1` is the restaurant app's. A browser's room cookie wandering in
    // resolves to nothing rather than to a half-working screen.
    const roomScan = await import('@/modules/access').then((m) => m.scanQrCode(a.qrCode));
    expect(await visitSessionFrom(req({
      authorization: `${BEARER_PREFIX}${roomScan.cookieValue}`,
    }))).toBeNull();
  });
});


/**
 * What the home screen reads, against a real menu. Round 1.
 *
 * The route handlers are thin and the rules under them are unit-tested, so
 * what is worth a database here is the JOIN of the two: that `featured` names
 * dishes the SAME payload is serving, and that a live order carries enough to
 * draw a card without a second request. Both are additions to `/v1` and both
 * are therefore promises that cannot be taken back.
 */
describe('/api/v1 home screen payloads', () => {
  let owner: pg.Client;
  let a: Fixture;
  let token = '';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const bearer = (path: string) =>
    new Request(`http://localhost${path}`, {
      headers: { authorization: `${BEARER_PREFIX}${token}` },
    });

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
      tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId,
      categories: KESARI_CATEGORIES, items: KESARI_MENU,
      collections: KESARI_COLLECTIONS, modifierGroups: KESARI_MODIFIER_GROUPS,
    }));

    const link = await scoped((tx) => createVisitLink(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, outletId: a.outletId,
      kind: 'ONLINE', label: 'home test',
    }));
    token = (await scanVisitLink(link.publicCode)).cookieValue;
  });

  it('leads the menu with three dishes it is already serving', async () => {
    const { GET } = await import('@/app/api/v1/menu/route');
    const menu: ApiMenu = await (await GET(bearer('/api/v1/menu'))).json();

    expect(menu.featured.length).toBeGreaterThan(0);
    expect(menu.featured.length).toBeLessThanOrEqual(3);

    // The strip is a VIEW of `sections`, not extra inventory. A featured dish
    // the menu below is not showing would be a dish nobody can tap through to.
    const servedIds = new Set(menu.sections.flatMap((s) => s.items.map((d) => d.id)));
    for (const entry of menu.featured) {
      expect(servedIds.has(entry.dish.id), `${entry.dish.name} is not in sections`).toBe(true);
      expect(entry.dish.isAvailable).toBe(true);
      // The tag is the section's SHORT LABEL, which is what the app renders
      // verbatim — "Chef Bhairav" over a dish name, never "Chef Bhairav's
      // table", which is a sentence that got cut off.
      expect(menu.sections.some((s) => s.label === entry.section)).toBe(true);
    }

    // On this menu laal maas belongs to three sections. The strip is a sample
    // of the menu, not one dish wearing three hats.
    expect(new Set(menu.featured.map((e) => e.dish.id)).size).toBe(menu.featured.length);
    expect(new Set(menu.featured.map((e) => e.section)).size).toBe(menu.featured.length);
  });

  it('gives a live order everything a card needs, in one request', async () => {
    const session = (await visitSessionFrom(
      new Request('http://localhost/api/v1/orders', {
        headers: { authorization: `${BEARER_PREFIX}${token}` },
      }),
    ))!;
    const context = visitContext(session.visitId);

    const dish = await scoped(async (tx) => {
      const menu = await getMenu(tx, {
        propertyId: a.propertyId, outletId: a.outletId,
        at: { dayOfWeek: new Date().getUTCDay(), minutes: 21 * 60 },
      });
      const quick = menu!.sections.flatMap((s) => s.items).find((i) => i.canQuickAdd);
      if (!quick) throw new Error('the seeded menu has no quick-addable dish');
      return quick.id;
    });

    await scoped((tx) => quickAddDish(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context,
      outletId: a.outletId, menuItemId: dish,
    }));

    const visit = await scoped((tx) => setVisitDetails(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, visitId: session.visitId,
      name: 'Priya Sharma', phone: '+91 98290 33333', fulfilment: 'TAKEAWAY',
    }));

    await scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context,
      outletId: a.outletId,
      fulfilment: visit.fulfilment,
      destinationLabel: destinationLabelFor(visit),
      idempotencyKey: crypto.randomUUID(),
      accessTier: session.accessTier,
      guestSessionId: session.id,
    }));

    const { GET } = await import('@/app/api/v1/orders/route');
    const orders: ApiOrderSummary[] = await (await GET(bearer('/api/v1/orders'))).json();

    const live = orders.find((o) => o.isLive);
    expect(live, 'the order just placed is not live').toBeDefined();

    // The pill and the headline, so the card never says "PLACED" at anybody.
    expect(live!.statusLabel.length).toBeGreaterThan(0);
    expect(live!.headline.length).toBeGreaterThan(0);
    expect(live!.statusLabel).not.toMatch(/[A-Z]{3,}|_/);

    // FIVE segments, from the payload. ACCEPTED and PREPARING are one step, so
    // an app that counted statuses would draw six and light the wrong one.
    expect(live!.stepCount).toBe(5);
    expect(live!.stepIndex).toBeGreaterThanOrEqual(1);
    expect(live!.stepIndex).toBeLessThanOrEqual(live!.stepCount);

    // A quantity of one is not worth saying — and it reads the same here as it
    // does on the account-scoped list, which it did not before this round.
    expect(live!.summary).not.toMatch(/^1× /);

    // The three ETA parts travel together or not at all, so the card and the
    // tracking screen compose one sentence the same way.
    const hasEta = live!.etaLabel !== null;
    expect(live!.etaFrom !== null).toBe(hasEta);
  });

  /**
   * "Same as last time" — offered only once there IS a last time, and only
   * when the whole of it can be rebuilt from today's menu.
   *
   * The two assertions that matter are the pair: a live order is not a
   * reorder (nothing has been delivered yet, so the block must not draw), and
   * the same order once DELIVERED comes back whole, with the lines in a cart.
   */
  it('offers the last delivered order back, and only once it is delivered', async () => {
    const session = (await visitSessionFrom(
      new Request('http://localhost/api/v1/orders', {
        headers: { authorization: `${BEARER_PREFIX}${token}` },
      }),
    ))!;
    const context = visitContext(session.visitId);

    const dish = await scoped(async (tx) => {
      const menu = await getMenu(tx, {
        propertyId: a.propertyId, outletId: a.outletId,
        at: { dayOfWeek: new Date().getUTCDay(), minutes: 21 * 60 },
      });
      const quick = menu!.sections.flatMap((s) => s.items).find((i) => i.canQuickAdd);
      if (!quick) throw new Error('the seeded menu has no quick-addable dish');
      return quick.id;
    });

    await scoped((tx) => quickAddDish(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context,
      outletId: a.outletId, menuItemId: dish,
    }));

    const visit = await scoped((tx) => setVisitDetails(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, visitId: session.visitId,
      name: 'Priya Sharma', phone: '+91 98290 33333', fulfilment: 'TAKEAWAY',
    }));

    const placed = await scoped((tx) => placeOrder(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, context,
      outletId: a.outletId,
      fulfilment: visit.fulfilment,
      destinationLabel: destinationLabelFor(visit),
      idempotencyKey: crypto.randomUUID(),
      accessTier: session.accessTier,
      guestSessionId: session.id,
    }));

    const route = await import('@/app/api/v1/orders/reorder/route');

    // Still cooking. "Same as last time" about an order nobody has eaten yet
    // would be the app offering back the thing already on its way.
    const whileLive: ApiReorderSuggestion =
      await (await route.GET(bearer('/api/v1/orders/reorder'))).json();
    expect(whileLive.reorder).toBeNull();

    for (const to of ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERED'] as const) {
      await scoped((tx) => advanceOrder(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId,
        orderId: placed.orderId, to, actor: { kind: 'SYSTEM' },
      }));
    }

    const offered: ApiReorderSuggestion =
      await (await route.GET(bearer('/api/v1/orders/reorder'))).json();
    expect(offered.reorder?.orderId).toBe(placed.orderId);
    expect(offered.reorder?.orderNumber).toBe(placed.orderNumber);
    expect(offered.reorder?.summary.length).toBeGreaterThan(0);
    // "12 Oct", in the property's timezone — never an ISO instant.
    expect(offered.reorder?.placedOn).not.toMatch(/T\d{2}:/);
    // Formatted once, server-side (#5).
    expect(offered.reorder?.total.text.startsWith('₹')).toBe(true);

    // Placement deleted the cart, so what is in it afterwards is exactly what
    // the reorder put there.
    const replayed: ApiReorderResult = await (await route.POST(new Request(
      'http://localhost/api/v1/orders/reorder',
      {
        method: 'POST',
        headers: {
          authorization: `${BEARER_PREFIX}${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ orderId: placed.orderId }),
      },
    ))).json();

    expect(replayed.cart.itemCount).toBeGreaterThan(0);
    expect(replayed.cart.lines.map((line) => line.menuItemId)).toContain(dish);
  });
});
