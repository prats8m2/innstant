import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  recordPayment, settleFolio, paymentsForStay, postFolioLine, getFolioForStay,
  buildGuestStatement,
} from '@/modules/billing';
import { createStay, checkOutStay } from '@/modules/stay';
import { atLocalHourOnSameDay } from '@/lib/clock';
import {
  ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * Taking the money at the desk, and closing the account.
 *
 * The claim that needs a real database is the PAIR. A payment is a `payments`
 * row and a `folio_lines` row that have to exist together: the first alone
 * leaves a paid bill still showing its full balance, and the second alone leaves
 * a settled bill with no record of how — which is the row a chargeback is
 * answered with. `postFolioLine()` refuses `PAYMENT` for exactly this reason.
 */
describe('settling a bill at the desk', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let gm = '';
  let stayId = '';

  const TZ = 'Asia/Kolkata';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const charge = (amountMinor: number, description = 'Dinner') =>
    scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      source: 'ORDER', description, amountMinor, currency: 'INR',
    }));

  const take = (amountMinor: number, over: Record<string, unknown> = {}) =>
    scoped((tx) => recordPayment(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      amountMinor, currency: 'INR', method: 'CARD',
      staffUserId: gm, idempotencyKey: `pay-${Math.random()}`,
      ...over,
    }));

  const folio = () => scoped((tx) => getFolioForStay(tx, stayId));

  const folioRow = async () => (await owner.query<{ status: string; settled_at: Date | null }>(
    `SELECT status, settled_at FROM folios WHERE stay_id = $1`, [stayId])).rows[0]!;

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');

    const gmRow = await owner.query<{ id: string }>(
      `SELECT su.id FROM staff_users su
       JOIN staff_property_roles spr ON spr.staff_user_id = su.id
       JOIN roles r ON r.id = spr.role_id
       WHERE spr.property_id = $1 AND r.key = 'PROPERTY_ADMIN' LIMIT 1`, [a.propertyId]);
    gm = gmRow.rows[0]!.id;
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['payments', 'folio_lines', 'folios', 'integration_outbox',
                     'checkout_requests', 'guest_sessions', 'stays',
                     'guest_property_profiles', 'guests', 'idempotency_keys']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    await owner.query(`SET session_replication_role = origin`);

    const created = await scoped((tx) => createStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, roomId: a.roomId,
      guest: { fullName: 'Iqbal Qureshi', phone: '+919820044444' },
      scheduledCheckoutAt: atLocalHourOnSameDay(new Date(Date.now() + 86_400_000), 11, TZ),
      actor: { kind: 'STAFF', staffUserId: gm },
    }));
    stayId = created.stayId;
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── The pair ────────────────────────────────────────────────────────── */

  it('writes the ledger row and the folio line together', async () => {
    await charge(1_318_000);
    const paid = await take(1_318_000);

    expect(paid.balanceMinor).toBe(0);

    // The ledger: how the money actually arrived.
    const ledger = await owner.query<{ provider: string; method: string; status: string }>(
      `SELECT provider, method, status FROM payments WHERE id = $1`, [paid.paymentId]);
    expect(ledger.rows[0]).toMatchObject({
      provider: 'DESK', method: 'CARD', status: 'CAPTURED',
    });

    // The folio line: what the trigger sums into payments_minor.
    const line = await owner.query<{ source: string; amount_minor: number }>(
      `SELECT source, amount_minor FROM folio_lines WHERE id = $1`, [paid.folioLineId]);
    expect(line.rows[0]).toMatchObject({ source: 'PAYMENT', amount_minor: 1_318_000 });

    // And they point at each other, so a dispute resolves from either end.
    const link = await owner.query<{ source_ref_id: string }>(
      `SELECT source_ref_id FROM folio_lines WHERE id = $1`, [paid.folioLineId]);
    expect(link.rows[0]!.source_ref_id).toBe(paid.paymentId);
  });

  /**
   * The generic door stays shut, at runtime and not only in the types.
   *
   * `PostFolioLineInput['source']` excludes PAYMENT, and a cast walks past a
   * union — which on a money path is not enough. Getting through here would
   * produce a folio line with no `payments` row: a bill that says it was paid
   * with no record of how, which is the row a chargeback is answered with.
   */
  it('will not let a payment through postFolioLine', async () => {
    await charge(100_000);
    const source = 'PAYMENT' as unknown as 'ORDER';

    await expect(scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      source, description: 'sneaky', amountMinor: 100_000, currency: 'INR',
    }))).rejects.toThrow(/use recordPayment/);

    // Nothing moved: not the ledger, and not the balance.
    const rows = await owner.query(
      `SELECT id FROM payments WHERE tenant_id = $1`, [TENANT_A]);
    expect(rows.rows).toHaveLength(0);
    expect((await folio())!.balanceMinor).toBe(100_000);
  });

  it('moves the balance the trigger maintains, not one it was handed', async () => {
    await charge(1_318_000);
    await take(800_000);

    const summary = (await folio())!;
    expect(summary.chargesMinor).toBe(1_318_000);
    expect(summary.paymentsMinor).toBe(800_000);
    expect(summary.balanceMinor).toBe(518_000);
  });

  it('reads on the guest\'s own bill as a payment, not a charge', async () => {
    await charge(1_318_000);
    await take(1_318_000, { method: 'CARD', reference: '4242' });

    const statement = buildGuestStatement(await folio(), {
      timeZone: TZ, currency: 'INR',
    });
    // One charge line. The payment is summed, not listed among what they bought.
    expect(statement.lines).toHaveLength(1);
    expect(statement.paidMinor).toBe(1_318_000);
    expect(statement.settled).toBe(true);
    expect(statement.totalLabel).toBe('Settled');
  });

  it('names the method on the line the guest reads', async () => {
    await charge(100_000);
    await take(100_000, { method: 'UPI', reference: 'iqbal@okhdfc' });

    const lines = (await folio())!.lines;
    expect(lines.find((l) => l.source === 'PAYMENT')!.description)
      .toBe('UPI · iqbal@okhdfc');
  });

  /* ── Refusals ────────────────────────────────────────────────────────── */

  it('refuses a payment against a stay with no bill', async () => {
    await expect(take(100_000)).rejects.toThrow(/no bill for this stay yet/i);
  });

  it('refuses nothing, and refuses a negative', async () => {
    await charge(100_000);
    for (const amount of [0, -100]) {
      await expect(take(amount)).rejects.toThrow(/how much was taken/i);
    }
  });

  /** A payment in a different currency from the bill it pays is not a payment (#5). */
  it('refuses a payment in the wrong currency', async () => {
    await charge(100_000);
    await expect(take(100_000, { currency: 'USD' }))
      .rejects.toThrow(/has to be in the same currency/i);
  });

  it('refuses to take more money once the bill is closed', async () => {
    await charge(100_000);
    await take(100_000);
    await scoped((tx) => settleFolio(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: gm,
    }));

    await expect(take(100_000)).rejects.toThrow(/already settled/i);
  });

  /**
   * A deposit before any charge is a real thing, and so is a fat-fingered
   * ₹130,000 for a ₹13,000 bill. Overpaying is allowed and visible rather than
   * refused: the balance goes negative and the guest's own screen says "We owe
   * you" (buildGuestStatement), which is the honest state.
   */
  it('allows an overpayment and says who owes whom', async () => {
    await charge(100_000);
    const paid = await take(150_000);

    expect(paid.balanceMinor).toBe(-50_000);
    const statement = buildGuestStatement(await folio(), { timeZone: TZ, currency: 'INR' });
    expect(statement.totalLabel).toBe('We owe you');
  });

  /* ── #8 ──────────────────────────────────────────────────────────────── */

  /** A desk double-clicking "Take ₹13,180" must not take it twice. */
  it('takes one payment for two clicks of the same button', async () => {
    await charge(1_318_000);
    const key = `pay-${Math.random()}`;

    const first = await take(1_318_000, { idempotencyKey: key });
    const second = await take(1_318_000, { idempotencyKey: key });

    expect(second.wasAlreadyTaken).toBe(true);
    expect(second.paymentId).toBe(first.paymentId);

    const rows = await owner.query(`SELECT id FROM payments WHERE tenant_id = $1`, [TENANT_A]);
    expect(rows.rows).toHaveLength(1);
    expect((await folio())!.balanceMinor).toBe(0);
  });

  it('two desks taking the same payment at once take it once', async () => {
    await charge(1_318_000);
    const key = `pay-${Math.random()}`;

    const results = await Promise.allSettled([
      take(1_318_000, { idempotencyKey: key }),
      take(1_318_000, { idempotencyKey: key }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);

    const rows = await owner.query(`SELECT id FROM payments WHERE tenant_id = $1`, [TENANT_A]);
    expect(rows.rows).toHaveLength(1);
  });

  /* ── Closing the account ─────────────────────────────────────────────── */

  it('closes a square bill and stamps when', async () => {
    await charge(100_000);
    await take(100_000);

    const result = await scoped((tx) => settleFolio(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: gm,
    }));
    expect(result.alreadySettled).toBe(false);

    const row = await folioRow();
    expect(row.status).toBe('SETTLED');
    expect(row.settled_at).not.toBeNull();
  });

  it('refuses to close a bill with money on it', async () => {
    await charge(100_000);
    await expect(scoped((tx) => settleFolio(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: gm,
    }))).rejects.toThrow(/still money on this bill/i);
  });

  it('refuses to close an overpaid bill', async () => {
    await charge(100_000);
    await take(150_000);
    await expect(scoped((tx) => settleFolio(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: gm,
    }))).rejects.toThrow(/overpaid/i);
  });

  /**
   * A folio hits zero mid-stay all the time — D-027's reversal nets a rejected
   * order back to nothing — and that guest is still here and still ordering.
   * SETTLED is a decision about the stay, not arithmetic about the balance.
   */
  it('does not close itself when the balance happens to reach zero', async () => {
    await charge(100_000);
    await scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      source: 'ADJUSTMENT', description: 'Reversed', amountMinor: -100_000, currency: 'INR',
    }));

    expect((await folio())!.balanceMinor).toBe(0);
    expect((await folioRow()).status).toBe('OPEN');
  });

  it('is idempotent, so two people closing one bill write one event', async () => {
    await charge(100_000);
    await take(100_000);
    await scoped((tx) => settleFolio(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: gm,
    }));
    const again = await scoped((tx) => settleFolio(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: gm,
    }));

    expect(again.alreadySettled).toBe(true);
    const folioId = (await folio())!.id;
    const history = await scoped((tx) => readEventHistory(tx, 'folio', folioId));
    expect(history.filter((e) => e.event_type === 'folio.settled')).toHaveLength(1);
  });

  /* ── Checkout closes it ──────────────────────────────────────────────── */

  /**
   * D-035 left this open on purpose: "checking out does not take the money —
   * settlement is the card machine". It still does not take it, but it now
   * CLOSES the account when the money is already in.
   */
  it('checking out closes a bill that has been paid', async () => {
    await charge(1_318_000);
    await take(1_318_000);

    const result = await scoped((tx) => checkOutStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: gm,
    }));

    expect(result.balanceMinor).toBe(0);
    expect(result.folioSettled).toBe(true);
    expect((await folioRow()).status).toBe('SETTLED');
  });

  it('checking out leaves an unpaid bill open, with the balance on the event', async () => {
    await charge(1_318_000);

    const result = await scoped((tx) => checkOutStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: gm,
    }));

    expect(result.balanceMinor).toBe(1_318_000);
    expect(result.folioSettled).toBe(false);
    // Still collectable, still visible, and the departure recorded what was owed.
    expect((await folioRow()).status).toBe('OPEN');
    const history = await scoped((tx) => readEventHistory(tx, 'stay', stayId));
    const out = history.find((e) => e.event_type === 'stay.checked_out')!;
    expect((out.payload as Record<string, unknown>).folioSettled).toBe(false);
  });

  /* ── The audit trail ─────────────────────────────────────────────────── */

  it('logs who took how much, how', async () => {
    await charge(100_000);
    await take(100_000, { method: 'CASH' });

    const folioId = (await folio())!.id;
    const history = await scoped((tx) => readEventHistory(tx, 'folio', folioId));
    const taken = history.find((e) => e.event_type === 'folio.payment_taken')!;
    const payload = taken.payload as Record<string, unknown>;

    expect(payload.amountMinor).toBe(100_000);
    expect(payload.method).toBe('CASH');
    expect(payload.balanceMinor).toBe(0);
    expect(taken.actor_kind).toBe('STAFF');
  });

  it('lists every payment for a dispute', async () => {
    await charge(300_000);
    await take(100_000, { method: 'CASH' });
    await take(200_000, { method: 'CARD' });

    const taken = await scoped((tx) =>
      paymentsForStay(tx, { propertyId: a.propertyId, stayId }));
    expect(taken.map((p) => p.method)).toEqual(['CASH', 'CARD']);
    expect(taken.reduce((sum, p) => sum + p.amountMinor, 0)).toBe(300_000);
  });

  /* ── Isolation ───────────────────────────────────────────────────────── */

  it('another hotel cannot take money against this stay', async () => {
    await charge(100_000);

    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => recordPayment(tx, {
        tenantId: b.tenantId, propertyId: a.propertyId, stayId,
        amountMinor: 100_000, currency: 'INR', method: 'CASH',
        staffUserId: gm, idempotencyKey: `x-${Math.random()}`,
      }),
    )).rejects.toThrow();

    expect((await folio())!.balanceMinor).toBe(100_000);
  });
});
