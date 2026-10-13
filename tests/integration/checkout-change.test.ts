import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  getCheckoutOptions, requestCheckoutChange, cancelCheckoutRequest,
  decideCheckoutRequest, listCheckoutRequests,
} from '@/modules/stay';
import { getFolioForStay } from '@/modules/billing';
import { scanQrCode, resolveStaySession } from '@/modules/access';
import { atLocalHourOnSameDay, localTimeAt } from '@/lib/clock';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * Changing when a guest leaves.
 *
 * The claim worth a real database is the approval: one transaction that moves
 * the stay, posts the fee, extends every live session on the room and writes the
 * log. Any of those happening without the others is discovered by the guest —
 * paying for a room whose app stopped working, or leaving at 6pm with nothing on
 * the bill.
 */
describe('changing when a guest leaves', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let stayId: string;
  let gm = '';

  const TZ = 'Asia/Kolkata';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  /**
   * Tomorrow, property-local, rather than a fixed calendar date.
   *
   * A stay due out on a date in the past mints guest sessions that are already
   * expired — `expires_at = scheduled_checkout_at + grace` — so
   * `resolveStaySession()` returns null and the session assertions test
   * nothing. That is a real property of the product and it made the first
   * version of this file fail in a way that looked like a session bug.
   */
  const tomorrowAt = (hour: number) =>
    atLocalHourOnSameDay(new Date(Date.now() + 86_400_000), hour, TZ);

  /** The local hour an instant falls on, which is what the rules are about. */
  const hourOf = (at: Date) => Math.floor(localTimeAt(at, TZ).minutes / 60);

  let DUE_OUT: Date;

  const options = (now = new Date()) => scoped((tx) => getCheckoutOptions(tx, {
    propertyId: a.propertyId, stayId, timeZone: TZ, now,
  }));

  const ask = async (hour: number) => {
    const opts = await options();
    const offer = opts.offers.find((o) => o.hour === hour)!;
    expect(offer, `no tier at ${hour}:00`).toBeTruthy();
    return scoped((tx) => requestCheckoutChange(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      requestedCheckoutAt: offer.checkoutAt,
      feeMinor: offer.feeMinor, currency: offer.currency,
    }));
  };

  const decide = (
    id: string,
    to: 'APPROVED' | 'DECLINED',
    extra: { overriddenFeeMinor?: number | null; declineReason?: string } = {},
  ) => scoped((tx) => decideCheckoutRequest(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId,
    checkoutRequestId: id, to, staffUserId: gm, timeZone: TZ, ...extra,
  }));

  const stayRow = async () => (await owner.query<{ scheduled_checkout_at: Date }>(
    `SELECT scheduled_checkout_at FROM stays WHERE id = $1`, [stayId])).rows[0]!;

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
    stayId = await checkInGuest(a);

    const gmRow = await owner.query<{ id: string }>(
      `SELECT su.id FROM staff_users su
       JOIN staff_property_roles spr ON spr.staff_user_id = su.id
       JOIN roles r ON r.id = spr.role_id
       WHERE spr.property_id = $1 AND r.key = 'PROPERTY_ADMIN' LIMIT 1`, [a.propertyId]);
    gm = gmRow.rows[0]!.id;
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['checkout_requests', 'checkout_fee_tiers', 'folio_lines', 'folios',
                     'guest_sessions', 'access_escalations', 'verification_challenges']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    await owner.query(`SET session_replication_role = origin`);

    // 11am tomorrow, property-local — deterministic offers, live sessions.
    DUE_OUT = tomorrowAt(11);
    await owner.query(
      `UPDATE stays SET scheduled_checkout_at = $1, status = 'CHECKED_IN' WHERE id = $2`,
      [DUE_OUT, stayId]);

    for (const [propertyId, tenantId] of [[a.propertyId, TENANT_A], [b.propertyId, TENANT_B]]) {
      await owner.query(
        `INSERT INTO checkout_fee_tiers (tenant_id, property_id, hour, fee_minor, currency)
         VALUES ($1, $2, 14, 250000, 'INR'), ($1, $2, 18, 500000, 'INR')`,
        [tenantId, propertyId]);
    }
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── What is offered ─────────────────────────────────────────────────── */

  it('offers the property\'s tiers against this stay\'s own checkout', async () => {
    const opts = await options();
    expect(opts.offers.map((o) => o.title)).toEqual([
      'Late checkout, 2pm', 'Late checkout, 6pm',
    ]);
    expect(opts.offers[0]!.sub).toBe('Three extra hours');
    expect(opts.pending).toBeNull();
  });

  it('offers nothing to a guest already due out later than every tier', async () => {
    await owner.query(
      `UPDATE stays SET scheduled_checkout_at = $1 WHERE id = $2`,
      [tomorrowAt(20), stayId]);
    expect((await options()).offers).toEqual([]);
  });

  /* ── Asking ──────────────────────────────────────────────────────────── */

  it('records what the guest agreed to, and charges nothing yet', async () => {
    const asked = await ask(14);
    expect(asked.wasAlreadyRequested).toBe(false);
    expect(asked.feeMinor).toBe(250_000);

    // The promise the screen makes: nothing is charged until the desk says yes.
    expect(await scoped((tx) => getFolioForStay(tx, stayId))).toBeNull();

    const opts = await options();
    expect(opts.pending?.status).toBe('REQUESTED');
    expect(opts.pending?.feeMinor).toBe(250_000);
  });

  /**
   * #8 — a guest double-tapping on hotel wifi is the most common duplicate in
   * this product. Here the guard is a partial unique index rather than a key,
   * so it holds however the second row arrives: a second tap, a second tab, or
   * a second device.
   */
  it('absorbs a double tap into one request', async () => {
    const first = await ask(14);
    const second = await ask(14);

    expect(second.wasAlreadyRequested).toBe(true);
    expect(second.id).toBe(first.id);

    const rows = await owner.query(
      `SELECT id FROM checkout_requests WHERE stay_id = $1`, [stayId]);
    expect(rows.rowCount).toBe(1);
  });

  it('will not let a second, different request open alongside the first', async () => {
    await ask(14);
    const second = await ask(18);
    // The same open row comes back — the desk decides one thing at a time.
    expect(second.wasAlreadyRequested).toBe(true);
    expect(second.feeMinor).toBe(250_000);
  });

  it('refuses to take a request for a stay that is not checked in', async () => {
    await owner.query(`UPDATE stays SET status = 'CHECKED_OUT' WHERE id = $1`, [stayId]);
    await expect(ask(14)).rejects.toThrow(/not currently checked in/i);
  });

  /* ── Approving ───────────────────────────────────────────────────────── */

  /**
   * The whole point of the feature, in one transaction.
   */
  it('moves the stay, posts the fee and extends the sessions, together', async () => {
    // A live session, minted before the change, expiring at checkout + grace.
    const scan = await scanQrCode(a.qrCode);
    const before = (await resolveStaySession(scan.cookieValue))!;
    expect(before.expiresAt.getTime()).toBe(DUE_OUT.getTime() + 120 * 60_000);

    const asked = await ask(18);
    const result = await decide(asked.id, 'APPROVED');

    expect(result.feeMinor).toBe(500_000);
    expect(result.sessionsExtended).toBe(1);

    // The claim is about the HOTEL's 6pm, not about a UTC offset.
    const moved = (await stayRow()).scheduled_checkout_at;
    expect(hourOf(moved)).toBe(18);

    const folio = await scoped((tx) => getFolioForStay(tx, stayId));
    expect(folio!.lines).toHaveLength(1);
    expect(folio!.lines[0]!.source).toBe('CHECKOUT_FEE');
    expect(folio!.lines[0]!.amountMinor).toBe(500_000);
    // The hotel's 6pm on the guest's own bill.
    expect(folio!.lines[0]!.description).toBe('Late checkout · 6pm');

    // And the phone in the room keeps working until the new time.
    const after = (await resolveStaySession(scan.cookieValue))!;
    expect(after.expiresAt.getTime()).toBe(moved.getTime() + 120 * 60_000);
    expect(after.scheduledCheckoutAt.getTime()).toBe(moved.getTime());
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  it('lets the desk charge less than was agreed, and keeps both numbers', async () => {
    const asked = await ask(14);
    const result = await decide(asked.id, 'APPROVED', { overriddenFeeMinor: 100_000 });

    expect(result.feeMinor).toBe(100_000);
    const folio = await scoped((tx) => getFolioForStay(tx, stayId));
    expect(folio!.lines[0]!.amountMinor).toBe(100_000);

    const row = await owner.query<{ fee_minor: number; overridden_fee_minor: number }>(
      `SELECT fee_minor, overridden_fee_minor FROM checkout_requests WHERE id = $1`, [asked.id]);
    // "Why is this ₹1,000 when the app said ₹2,500" has to be answerable.
    expect(row.rows[0]!.fee_minor).toBe(250_000);
    expect(row.rows[0]!.overridden_fee_minor).toBe(100_000);
  });

  /**
   * The one a `||` would get wrong: waiving is an override of ZERO, and falling
   * back to the agreed fee there charges the guest the ₹2,500 just written off.
   */
  it('waives the fee entirely when the desk says zero', async () => {
    const asked = await ask(14);
    const result = await decide(asked.id, 'APPROVED', { overriddenFeeMinor: 0 });

    expect(result.feeMinor).toBe(0);
    // No line at all, rather than a zero-rupee line nobody can explain.
    expect(await scoped((tx) => getFolioForStay(tx, stayId))).toBeNull();
    // The stay still moved — the guest got what they asked for, free.
    expect(hourOf((await stayRow()).scheduled_checkout_at)).toBe(14);
  });

  it('charges nothing for a guest who is simply leaving now', async () => {
    const leaving = await scoped((tx) => requestCheckoutChange(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      requestedCheckoutAt: new Date(), feeMinor: 0, currency: 'INR',
    }));
    await decide(leaving.id, 'APPROVED');
    expect(await scoped((tx) => getFolioForStay(tx, stayId))).toBeNull();
  });

  /* ── Declining and withdrawing ───────────────────────────────────────── */

  it('declines without moving anything or charging anything', async () => {
    const asked = await ask(14);
    await decide(asked.id, 'DECLINED', { declineReason: 'The room turns over at 1pm.' });

    expect((await stayRow()).scheduled_checkout_at.getTime()).toBe(DUE_OUT.getTime());
    expect(await scoped((tx) => getFolioForStay(tx, stayId))).toBeNull();

    const opts = await options();
    expect(opts.pending?.status).toBe('DECLINED');
    // Their words, verbatim — the guest reads this.
    expect(opts.pending?.declineReason).toBe('The room turns over at 1pm.');
  });

  it('refuses a decline with no reason — the guest reads it', async () => {
    const asked = await ask(14);
    await expect(decide(asked.id, 'DECLINED')).rejects.toThrow(/Say why/i);
  });

  it('lets the guest withdraw before the desk looks, and ask again after', async () => {
    const asked = await ask(14);
    await scoped((tx) => cancelCheckoutRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, checkoutRequestId: asked.id,
    }));

    // The index only guards REQUESTED, so a withdrawn one frees the slot.
    const again = await ask(18);
    expect(again.wasAlreadyRequested).toBe(false);
    expect(again.id).not.toBe(asked.id);
  });

  it('will not let a guest withdraw a decision the desk already made', async () => {
    const asked = await ask(14);
    await decide(asked.id, 'APPROVED');

    await expect(scoped((tx) => cancelCheckoutRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, checkoutRequestId: asked.id,
    }))).rejects.toThrow(/already been decided/i);
  });

  /**
   * Approving moved the stay, posted a fee and extended every session. Undoing
   * that is a credit and a second decision, not a transition.
   */
  it('will not un-approve', async () => {
    const asked = await ask(14);
    await decide(asked.id, 'APPROVED');
    await expect(decide(asked.id, 'DECLINED', { declineReason: 'changed my mind' }))
      .rejects.toThrow(/cannot be declined/i);
  });

  it('two people at the desk deciding at once produce one decision', async () => {
    const asked = await ask(14);

    const [first, second] = await Promise.allSettled([
      decide(asked.id, 'APPROVED'),
      decide(asked.id, 'DECLINED', { declineReason: 'No room.' }),
    ]);

    const won = [first, second].filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);

    // Exactly one fee line, whichever won — never two, never one of each.
    const folio = await scoped((tx) => getFolioForStay(tx, stayId));
    expect(folio?.lines.length ?? 0).toBeLessThanOrEqual(1);
  });

  /* ── The desk's queue ────────────────────────────────────────────────── */

  it('shows the desk who is asking, for what, and who they are', async () => {
    await ask(14);
    const queue = await scoped((tx) => listCheckoutRequests(tx, { propertyId: a.propertyId }));

    expect(queue).toHaveLength(1);
    expect(queue[0]!.roomNumber).toBe('214');
    expect(queue[0]!.guestName).toBeTruthy();
    expect(queue[0]!.feeMinor).toBe(250_000);
    expect(queue[0]!.scheduledCheckoutAt.getTime()).toBe(DUE_OUT.getTime());
  });

  it('empties as they are answered', async () => {
    const asked = await ask(14);
    await decide(asked.id, 'APPROVED');

    expect(await scoped((tx) =>
      listCheckoutRequests(tx, { propertyId: a.propertyId }))).toEqual([]);
    expect(await scoped((tx) =>
      listCheckoutRequests(tx, { propertyId: a.propertyId, statuses: ['APPROVED'] })))
      .toHaveLength(1);
  });

  /* ── The audit trail ─────────────────────────────────────────────────── */

  it('logs both numbers when the desk overrides one', async () => {
    const asked = await ask(14);
    await decide(asked.id, 'APPROVED', { overriddenFeeMinor: 0 });

    const history = await scoped((tx) => readEventHistory(tx, 'checkout_request', asked.id));
    const approved = history.find((e) => e.event_type === 'checkout_request.approved')!;
    const payload = approved.payload as Record<string, unknown>;

    expect(payload.agreedFeeMinor).toBe(250_000);
    expect(payload.chargedFeeMinor).toBe(0);
    expect(payload.overridden).toBe(true);
    expect(approved.actor_kind).toBe('STAFF');
  });

  /* ── Isolation ───────────────────────────────────────────────────────── */

  it('another hotel cannot see or decide this one\'s requests', async () => {
    const asked = await ask(14);

    expect(await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => listCheckoutRequests(tx, { propertyId: a.propertyId }),
    )).toEqual([]);

    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => decideCheckoutRequest(tx, {
        tenantId: b.tenantId, propertyId: a.propertyId, checkoutRequestId: asked.id,
        to: 'APPROVED', staffUserId: gm, timeZone: TZ,
      }),
    )).rejects.toThrow();

    expect((await stayRow()).scheduled_checkout_at.getTime()).toBe(DUE_OUT.getTime());
  });

  it('another hotel\'s tiers are not offered here', async () => {
    await owner.query(
      `INSERT INTO checkout_fee_tiers (tenant_id, property_id, hour, fee_minor, currency)
       VALUES ($1, $2, 20, 900000, 'INR')`, [TENANT_B, b.propertyId]);
    expect((await options()).offers.map((o) => o.hour)).toEqual([14, 18]);
  });
});
