import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant } from '@/db';
import {
  seedMenu, KESARI_MENU, KESARI_CATEGORIES, KESARI_COLLECTIONS, KESARI_MODIFIER_GROUPS,
} from '@/modules/catalog';
import { createVisitLink } from '@/modules/visit';
import { scanVisitLink } from '@/modules/access';
import { guestCredentialFrom, visitSessionFrom, BEARER_PREFIX } from '@/lib/api-auth';
import { GUEST_SESSION_COOKIE } from '@/modules/access';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, type Fixture,
} from './setup';

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
