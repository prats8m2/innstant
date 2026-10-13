import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant } from '@/db';
import { getFolioForStay, postFolioLine, buildGuestStatement } from '@/modules/billing';
import {
  scanQrCode, resolveStaySession, requireTier, startPhoneLast4Challenge, answerChallenge,
} from '@/modules/access';
import {
  getRequestTypeByKey, raiseServiceRequest, advanceRequest,
} from '@/modules/requests';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * The guest's own bill — P3's first screen.
 *
 * `getFolioForStay()` has been written and tested since P0 while every charge
 * path posted into a folio no guest could see. What is new is the read being
 * reachable: the tier that gates it, the statement the screen renders, and the
 * guarantee that neither crosses a stay.
 */
describe('the folio a guest can reach', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let stayId: string;

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const statement = async (id = stayId) => {
    const folio = await scoped((tx) => getFolioForStay(tx, id));
    return buildGuestStatement(folio, { timeZone: 'Asia/Kolkata', currency: 'INR' });
  };

  const charge = (description: string, amountMinor: number, sourceRefId?: string) =>
    scoped((tx) => postFolioLine(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId,
      source: 'ORDER', sourceRefId: sourceRefId ?? null,
      description, amountMinor, currency: 'INR',
    }));

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
    stayId = await checkInGuest(a);
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['folio_lines', 'folios', 'service_request_items', 'service_requests',
                     'access_escalations', 'verification_challenges', 'guest_sessions',
                     'staff_vouches', 'idempotency_keys']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── The gate ────────────────────────────────────────────────────────── */

  /**
   * #9 is about BROWSING — menus, prices, POIs, free service calls. A folio is
   * none of those: it is the one screen on the guest surface whose content is
   * personal, and a sticker on a nightstand is photographable from a corridor.
   */
  it('is behind the one prompt for a bare scan', async () => {
    const scan = await scanQrCode(a.qrCode);
    expect(scan.session.accessTier).toBe('REQUEST');

    const check = await requireTier(scan.session, 'view_folio');
    expect(check.required).toBe(true);
    if (check.required) expect(check.toTier).toBe('FULL');
  });

  it('opens on the same four digits that let the guest order, and only once',
    async () => {
      const scan = await scanQrCode(a.qrCode);
      const challengeId = await startPhoneLast4Challenge(scan.session);
      const result = await answerChallenge(scan.session, challengeId, '1111');

      expect(result.ok).toBe(true);
      const verified = (await resolveStaySession(scan.cookieValue))!;
      expect(verified.accessTier).toBe('FULL');
      expect((await requireTier(verified, 'view_folio')).required).toBe(false);
    });

  it('records what the guest was trying to do when it asked', async () => {
    const scan = await scanQrCode(a.qrCode);
    await requireTier(scan.session, 'view_folio');

    const rows = await owner.query<{ triggered_by: string; to_tier: string }>(
      `SELECT triggered_by, to_tier FROM access_escalations WHERE tenant_id = $1`, [TENANT_A]);
    expect(rows.rows[0]!.triggered_by).toBe('view_folio');
    expect(rows.rows[0]!.to_tier).toBe('FULL');
  });

  /* ── What it shows ───────────────────────────────────────────────────── */

  it('reads as a bill on the first evening, before anything is charged', async () => {
    // No folio row at all — it is opened lazily by the first charge.
    expect(await scoped((tx) => getFolioForStay(tx, stayId))).toBeNull();

    const view = await statement();
    expect(view.lines).toEqual([]);
    expect(view.totalLabel).toBe('Nothing on your room yet');
    expect(view.note).toMatch(/settle it at the desk/i);
  });

  it('shows every charge in the order it was posted, and totals them', async () => {
    await charge('Room charge · Lake view', 1_800_000);
    await charge('In-room dining · KE-1180', 247_000);
    await charge('Laundry service', 45_000);

    const view = await statement();
    expect(view.lines.map((l) => l.description)).toEqual([
      'Room charge · Lake view', 'In-room dining · KE-1180', 'Laundry service',
    ]);
    expect(view.balanceMinor).toBe(2_092_000);
    expect(view.totalLabel).toBe('Total so far');
  });

  /**
   * The real path, not a hand-posted line: a chargeable request posts at
   * placement, and cancelling it credits the folio in the same transaction
   * (D-027). Both rows have to be on the guest's bill.
   */
  it('shows a charge and its credit after a cancelled request', async () => {
    const raised = await scoped(async (tx) => {
      const type = await getRequestTypeByKey(tx, { propertyId: a.propertyId, key: 'LAUNDRY' });
      return raiseServiceRequest(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
        lines: [{ requestTypeId: type!.id, quantity: 1 }],
        idempotencyKey: `folio-${Math.random()}`, accessTier: 'FULL',
      });
    });
    expect(raised.totalMinor).toBeGreaterThan(0);

    const charged = await statement();
    expect(charged.lines).toHaveLength(1);
    expect(charged.balanceMinor).toBe(raised.totalMinor);

    await scoped((tx) => advanceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId,
      requestId: raised.requestId, to: 'CANCELLED', actor: { kind: 'SYSTEM' },
      reason: 'Changed my mind',
    }));

    const credited = await statement();
    expect(credited.lines).toHaveLength(2);
    expect(credited.lines[1]!.isCredit).toBe(true);
    // Netted to nothing, with both rows still readable — which is exactly the
    // conversation a deleted row makes unwinnable.
    expect(credited.balanceMinor).toBe(0);
    expect(credited.hasCredits).toBe(true);
  });

  /**
   * The PAYMENT line goes in as the owner rather than through `postFolioLine()`,
   * and deliberately: that function's `source` union excludes PAYMENT, because a
   * payment also needs a `payments` row and posting one through the generic door
   * would leave the folio and the ledger disagreeing. Settling is a later P3
   * bullet with its own function; this test only needs the row to exist so the
   * statement can prove it does not read as a charge.
   */
  it('keeps a payment out of the charge list and off the charge total', async () => {
    await charge('Room charge · Lake view', 1_800_000);
    const folioRow = await owner.query<{ id: string }>(
      `SELECT id FROM folios WHERE stay_id = $1`, [stayId]);
    await owner.query(
      `INSERT INTO folio_lines (tenant_id, property_id, folio_id, source, description,
                                amount_minor, currency)
       VALUES ($1, $2, $3, 'PAYMENT', 'Card ending 4242', 800000, 'INR')`,
      [TENANT_A, a.propertyId, folioRow.rows[0]!.id]);

    const view = await statement();
    expect(view.lines).toHaveLength(1);
    expect(view.paidMinor).toBe(800_000);
    expect(view.balanceMinor).toBe(1_000_000);
    expect(view.totalLabel).toBe('Left to pay');
  });

  /**
   * The screen recomputes its total from the lines it drew. This proves the two
   * agree against the database's own trigger, which is the authority.
   */
  it('totals to the same number the recompute trigger reached', async () => {
    await charge('Room charge · Lake view', 1_800_000);
    await charge('Minibar', 62_000);

    const folio = await scoped((tx) => getFolioForStay(tx, stayId));
    const view = buildGuestStatement(folio, { timeZone: 'Asia/Kolkata', currency: 'INR' });
    expect(view.chargesMinor).toBe(folio!.chargesMinor);
    expect(view.balanceMinor).toBe(folio!.balanceMinor);
  });

  /* ── Isolation ───────────────────────────────────────────────────────── */

  it('another hotel cannot read this stay\'s folio', async () => {
    await charge('Room charge · Lake view', 1_800_000);

    const leaked = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => getFolioForStay(tx, stayId),
    );
    expect(leaked).toBeNull();
  });

  /**
   * #10 — the session is keyed on the stay, never the room. The next occupant of
   * 214 must not read the last one's bill, and this is the screen where that
   * would be worst.
   */
  it('a new stay in the same room starts with an empty bill', async () => {
    await charge('Room charge · Lake view', 1_800_000);
    expect((await statement()).lines).toHaveLength(1);

    await owner.query(
      `UPDATE stays SET status = 'CHECKED_OUT', checked_out_at = now() WHERE id = $1`, [stayId]);
    const nextStayId = await checkInGuest(a);
    expect(nextStayId).not.toBe(stayId);

    const fresh = await statement(nextStayId);
    expect(fresh.lines).toEqual([]);
    expect(fresh.totalLabel).toBe('Nothing on your room yet');

    // Put the fixture back for whatever runs next.
    await owner.query(`UPDATE stays SET status = 'CHECKED_OUT' WHERE id = $1`, [nextStayId]);
    await owner.query(
      `UPDATE stays SET status = 'CHECKED_IN', checked_out_at = NULL WHERE id = $1`, [stayId]);
  });
});
