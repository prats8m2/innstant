import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import type pg from 'pg';
import { withTenant, enqueueOutbox, pendingOutbox } from '@/db';
import {
  createStay, checkOutStay, notifyPms, drainPmsOutbox, pmsAdapterFor, ManualAdapter,
  requestCheckoutChange, decideCheckoutRequest,
  type PmsAdapter, type PmsEvent,
} from '@/modules/stay';
import { atLocalHourOnSameDay } from '@/lib/clock';
import {
  ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * The boundary to reservation data (D-011).
 *
 * Two claims worth a real database. That a manual property writes NOTHING —
 * because a queue nothing drains is write-only rows at table scale. And that
 * when a property does have a system of record, the local write commits, the
 * message is queued in the same transaction, and a PMS that is down delays it
 * rather than failing it.
 */
describe('telling a system of record', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let gm = '';

  const TZ = 'Asia/Kolkata';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const tomorrowAt = (hour: number) =>
    atLocalHourOnSameDay(new Date(Date.now() + 86_400_000), hour, TZ);

  const checkIn = (over: Record<string, unknown> = {}) => scoped((tx) => createStay(tx, {
    tenantId: a.tenantId,
    propertyId: a.propertyId,
    roomId: a.roomId,
    guest: { fullName: 'Iqbal Qureshi', phone: '+919820044444' },
    scheduledCheckoutAt: tomorrowAt(11),
    actor: { kind: 'STAFF', staffUserId: gm },
    ...over,
  }));

  const queued = () => scoped((tx) => pendingOutbox(tx, { propertyId: a.propertyId }));

  const rowsFor = async () => (await owner.query<{
    operation: string; status: string; attempts: number; last_error: string | null;
    next_attempt_at: Date;
  }>(
    `SELECT operation, status, attempts, last_error, next_attempt_at
     FROM integration_outbox WHERE tenant_id = $1 ORDER BY created_at`, [TENANT_A],
  )).rows;

  /** An adapter that says yes, for a property that pretends to run Opera. */
  function fakeAdapter(behaviour: (event: PmsEvent) => void = () => {}): PmsAdapter & {
    seen: PmsEvent[];
  } {
    const seen: PmsEvent[] = [];
    return {
      kind: 'OPERA',
      deliversOutbound: true,
      seen,
      async deliver(event: PmsEvent) {
        seen.push(event);
        behaviour(event);
      },
    };
  }

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
    vi.restoreAllMocks();
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['integration_outbox', 'checkout_requests', 'checkout_fee_tiers',
                     'folio_lines', 'folios', 'guest_sessions', 'stays',
                     'guest_property_profiles', 'guests']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = ANY($1)`, [[TENANT_A, TENANT_B]]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── A manual property ───────────────────────────────────────────────── */

  it('resolves to the manual adapter, which has nowhere to deliver', () => {
    const adapter = pmsAdapterFor({ propertyId: a.propertyId });
    expect(adapter.kind).toBe('MANUAL');
    expect(adapter.deliversOutbound).toBe(false);
  });

  /**
   * The whole reason `ManualAdapter` exists rather than a `null` check: a hotel
   * whose front desk IS this product has nowhere to push to, so nothing is
   * written. A row per folio line for a queue with no consumer is write-only
   * rows at table scale.
   */
  it('writes nothing at all for a property with no system of record', async () => {
    const stay = await checkIn();
    await scoped((tx) => checkOutStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId, staffUserId: gm,
    }));

    expect(await rowsFor()).toEqual([]);
  });

  /**
   * A no-op `deliver()` would let a mis-resolved adapter look like successful
   * delivery to a PMS that does not exist — the row marked DELIVERED with
   * nothing on the other end.
   */
  it('refuses to pretend it delivered something', async () => {
    await expect(ManualAdapter.deliver({
      kind: 'STAY_EXTENDED',
      stay: { stayId: 'x', sourceRefId: null, roomNumber: '214' },
      scheduledCheckoutAt: new Date().toISOString(),
      reason: 'LATE_CHECKOUT',
    })).rejects.toThrow(/nowhere to deliver/i);
  });

  /* ── A property that does have one ───────────────────────────────────── */

  /**
   * The same call sites, unedited — only the adapter's answer changes. That is
   * the seam: `OperaAdapter` flips `deliversOutbound` and `createStay()`,
   * `checkOutStay()` and `decideCheckoutRequest()` start filling the outbox.
   */
  it('queues a check-in once the property has somewhere to push to', async () => {
    vi.spyOn(await import('@/modules/stay/pms'), 'pmsAdapterFor')
      .mockReturnValue(fakeAdapter());

    await checkIn();

    const rows = await rowsFor();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.operation).toBe('STAY_CHECKED_IN');
    expect(rows[0]!.status).toBe('PENDING');
  });

  /**
   * In the SAME transaction as the thing it describes. A queued "checked out"
   * that survives a rolled-back checkout is a message about something that did
   * not happen.
   */
  it('rolls the message back with the write it describes', async () => {
    vi.spyOn(await import('@/modules/stay/pms'), 'pmsAdapterFor')
      .mockReturnValue(fakeAdapter());

    await expect(scoped(async (tx) => {
      await notifyPms(tx, {
        tenantId: a.tenantId,
        propertyId: a.propertyId,
        event: {
          kind: 'STAY_EXTENDED',
          stay: { stayId: 'x', sourceRefId: null, roomNumber: '214' },
          scheduledCheckoutAt: new Date().toISOString(),
          reason: 'LATE_CHECKOUT',
        },
      });
      throw new Error('the write failed after the enqueue');
    })).rejects.toThrow();

    expect(await rowsFor()).toEqual([]);
  });

  it('queues both halves of an approved late checkout', async () => {
    vi.spyOn(await import('@/modules/stay/pms'), 'pmsAdapterFor')
      .mockReturnValue(fakeAdapter());

    const stay = await checkIn();
    const asked = await scoped((tx) => requestCheckoutChange(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId,
      requestedCheckoutAt: tomorrowAt(14), feeMinor: 250_000, currency: 'INR',
    }));
    await scoped((tx) => decideCheckoutRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, checkoutRequestId: asked.id,
      to: 'APPROVED', staffUserId: gm, timeZone: TZ,
    }));

    // A PMS that knows the stay moved but not that money was taken produces a
    // bill that does not reconcile.
    const operations = (await rowsFor()).map((row) => row.operation);
    expect(operations).toEqual(['STAY_CHECKED_IN', 'STAY_EXTENDED', 'CHARGE_POSTED']);
  });

  /* ── Draining ────────────────────────────────────────────────────────── */

  it('hands each row to the adapter and marks it delivered', async () => {
    const adapter = fakeAdapter();
    vi.spyOn(await import('@/modules/stay/pms'), 'pmsAdapterFor').mockReturnValue(adapter);

    const stay = await checkIn();
    await scoped((tx) => checkOutStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId, staffUserId: gm,
    }));

    const result = await drainPmsOutbox({
      tenantId: a.tenantId, propertyId: a.propertyId, adapter,
    });

    expect(result).toMatchObject({ attempted: 2, delivered: 2, failed: 0 });
    expect(adapter.seen.map((e) => e.kind))
      .toEqual(['STAY_CHECKED_IN', 'STAY_CHECKED_OUT']);
    expect((await rowsFor()).every((row) => row.status === 'DELIVERED')).toBe(true);
    expect(await queued()).toEqual([]);
  });

  /**
   * DATA-MODEL §8: a hotel's Opera instance being down must never fail a guest's
   * order. The local write already committed; this is only about when the
   * message gets through.
   */
  it('a PMS that is down delays the message and records why', async () => {
    const adapter = fakeAdapter(() => { throw new Error('ECONNREFUSED opera.example:443'); });
    vi.spyOn(await import('@/modules/stay/pms'), 'pmsAdapterFor').mockReturnValue(adapter);

    await checkIn();
    const now = new Date();
    const result = await drainPmsOutbox({
      tenantId: a.tenantId, propertyId: a.propertyId, adapter, now,
    });

    expect(result).toMatchObject({ attempted: 1, delivered: 0, failed: 1, exhausted: 0 });

    const [row] = await rowsFor();
    expect(row!.status).toBe('PENDING');
    expect(row!.attempts).toBe(1);
    expect(row!.last_error).toContain('ECONNREFUSED');
    // Backed off — the next pass steps over it until the wait is up.
    expect(row!.next_attempt_at.getTime()).toBeGreaterThan(now.getTime());
    expect(await scoped((tx) =>
      pendingOutbox(tx, { propertyId: a.propertyId, now }))).toEqual([]);
  });

  it('tries again once the wait is up, and succeeds', async () => {
    let down = true;
    const adapter = fakeAdapter(() => {
      if (down) throw new Error('ECONNREFUSED');
    });
    vi.spyOn(await import('@/modules/stay/pms'), 'pmsAdapterFor').mockReturnValue(adapter);

    await checkIn();
    await drainPmsOutbox({ tenantId: a.tenantId, propertyId: a.propertyId, adapter });

    down = false;
    const later = new Date(Date.now() + 60 * 60_000);
    const result = await drainPmsOutbox({
      tenantId: a.tenantId, propertyId: a.propertyId, adapter, now: later,
    });

    expect(result.delivered).toBe(1);
    expect((await rowsFor())[0]!.status).toBe('DELIVERED');
  });

  /**
   * "Checked out" arriving before "checked in" is worse than both arriving late,
   * so a failure ends the pass rather than stepping over the row.
   */
  it('stops at the first failure rather than reordering what follows', async () => {
    const adapter = fakeAdapter((event) => {
      if (event.kind === 'STAY_CHECKED_IN') throw new Error('ECONNREFUSED');
    });
    vi.spyOn(await import('@/modules/stay/pms'), 'pmsAdapterFor').mockReturnValue(adapter);

    const stay = await checkIn();
    await scoped((tx) => checkOutStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId: stay.stayId, staffUserId: gm,
    }));

    const result = await drainPmsOutbox({
      tenantId: a.tenantId, propertyId: a.propertyId, adapter,
    });

    expect(result).toMatchObject({ attempted: 1, delivered: 0, failed: 1 });
    // The checkout was never offered — it is still waiting behind the check-in.
    expect(adapter.seen.map((e) => e.kind)).toEqual(['STAY_CHECKED_IN']);
    const rows = await rowsFor();
    expect(rows[1]!.status).toBe('PENDING');
    expect(rows[1]!.attempts).toBe(0);
  });

  /**
   * A queue that retries for ever hides the outage that caused it. Ten attempts
   * is about a day on this curve; past that a human has to look.
   */
  it('gives up after ten attempts and says so', async () => {
    const adapter = fakeAdapter(() => { throw new Error('still down'); });
    vi.spyOn(await import('@/modules/stay/pms'), 'pmsAdapterFor').mockReturnValue(adapter);

    await checkIn();

    let now = new Date();
    for (let pass = 0; pass < 10; pass += 1) {
      await drainPmsOutbox({ tenantId: a.tenantId, propertyId: a.propertyId, adapter, now });
      now = new Date(now.getTime() + 8 * 60 * 60_000);
    }

    const [row] = await rowsFor();
    expect(row!.status).toBe('FAILED');
    expect(row!.attempts).toBe(10);
    // And it stays out of the queue rather than being retried for ever.
    expect(await scoped((tx) =>
      pendingOutbox(tx, { propertyId: a.propertyId, now }))).toEqual([]);
  });

  /* ── Isolation ───────────────────────────────────────────────────────── */

  it('drains one property\'s queue and not another\'s', async () => {
    await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId }, (tx) =>
      enqueueOutbox(tx, {
        tenantId: b.tenantId, propertyId: b.propertyId,
        target: 'OPERA', operation: 'STAY_CHECKED_IN', payload: {},
      }));

    const adapter = fakeAdapter();
    const result = await drainPmsOutbox({
      tenantId: a.tenantId, propertyId: a.propertyId, adapter,
    });

    expect(result.attempted).toBe(0);
    const theirs = await owner.query(
      `SELECT status FROM integration_outbox WHERE tenant_id = $1`, [TENANT_B]);
    expect(theirs.rows[0]!.status).toBe('PENDING');
  });
});
