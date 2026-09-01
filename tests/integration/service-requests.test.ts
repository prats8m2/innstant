import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  getRequestCatalog, getRequestTypeByKey, raiseServiceRequest, advanceRequest,
  getRequestsForStay, getRequestForStay, getOpenRequests, CALL_SERVICE_KEY,
} from '@/modules/requests';
import { getFolioForStay } from '@/modules/billing';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture,
} from './setup';

/**
 * P2's first slice, against a real database.
 *
 * The same four invariants placement is held to, on a path where MOST requests
 * are free — which is the difference that matters. A guest asking for towels
 * must get towels with no prompt (#9); a guest asking for laundry is charging
 * the room and gets the same treatment a dinner does (D-012).
 */
describe('service requests', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let stayId: string;

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  /**
   * A REAL staff id, resolved in beforeAll.
   *
   * `service_requests.assigned_staff_id` has an actual FK to `staff_users` —
   * unlike `orders.assigned_runner_id`, which does not — so a made-up uuid here
   * fails with a 23503 that reads like a bug in the module.
   */
  let staff: { kind: 'STAFF'; staffUserId: string };

  async function typeIdFor(key: string): Promise<string> {
    const found = await scoped((tx) => getRequestTypeByKey(tx, {
      propertyId: a.propertyId, key,
    }));
    if (!found) throw new Error(`no request type ${key}`);
    return found.id;
  }

  const raise = (
    key: string,
    opts: {
      quantity?: number;
      idempotencyKey?: string;
      accessTier?: 'BROWSE' | 'REQUEST' | 'CHARGE' | 'FULL';
      guestNote?: string;
      photoUrl?: string;
      lines?: Array<{ key: string; quantity: number }>;
    } = {},
  ) => scoped(async (tx) => {
    const lines = opts.lines
      ? await Promise.all(opts.lines.map(async (l) => ({
          requestTypeId: await typeIdFor(l.key), quantity: l.quantity,
        })))
      : [{ requestTypeId: await typeIdFor(key), quantity: opts.quantity ?? 1 }];

    return raiseServiceRequest(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      stayId,
      roomId: a.roomId,
      lines,
      guestNote: opts.guestNote,
      photoUrl: opts.photoUrl,
      idempotencyKey: opts.idempotencyKey ?? `req-${key}-${Math.random()}`,
      accessTier: opts.accessTier ?? 'REQUEST',
    });
  });

  const advance = (
    requestId: string,
    to: Parameters<typeof advanceRequest>[1]['to'],
    extra: Record<string, unknown> = {},
  ) => scoped((tx) => advanceRequest(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId, requestId, to, actor: staff, ...extra,
  }));

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
    stayId = await checkInGuest(a);

    const staffRow = await owner.query<{ id: string }>(
      `SELECT id FROM staff_users WHERE tenant_id = $1 LIMIT 1`, [TENANT_A]);
    staff = { kind: 'STAFF', staffUserId: staffRow.rows[0]!.id };
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['service_request_items', 'service_requests', 'folio_lines', 'folios',
                     'idempotency_keys']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [TENANT_A]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = $1`, [TENANT_A]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── The catalog ──────────────────────────────────────────────────────── */

  it('offers free and chargeable things in one list', async () => {
    const catalog = await scoped((tx) => getRequestCatalog(tx, { propertyId: a.propertyId }));

    // 23 seeded types, and nine columns that were written by the seeder and read
    // by nothing until this module existed.
    expect(catalog.length).toBeGreaterThan(15);
    expect(catalog.some((c) => c.priceMinor === 0)).toBe(true);
    expect(catalog.some((c) => c.isChargeable)).toBe(true);

    const towels = catalog.find((c) => c.key === 'EXTRA_TOWELS')!;
    expect(towels.slaMinutes).toBe(12);
    expect(towels.allowsQuantity).toBe(true);
    expect(towels.maxQuantity).toBe(4);

    const ac = catalog.find((c) => c.key === 'AC_ISSUE')!;
    expect(ac.allowsPhoto).toBe(true);
  });

  it('narrows to the categories a screen shows', async () => {
    const amenities = await scoped((tx) => getRequestCatalog(tx, {
      propertyId: a.propertyId, categories: ['AMENITY'],
    }));
    expect(amenities.every((c) => c.category === 'AMENITY')).toBe(true);
    expect(amenities.length).toBeGreaterThan(5);
  });

  it('hides a type a property has switched off', async () => {
    await owner.query(
      `UPDATE request_types SET is_active = false WHERE property_id = $1 AND key = 'SLIPPERS'`,
      [a.propertyId]);

    const catalog = await scoped((tx) => getRequestCatalog(tx, { propertyId: a.propertyId }));
    expect(catalog.find((c) => c.key === 'SLIPPERS')).toBeUndefined();
    expect(await scoped((tx) => getRequestTypeByKey(tx, {
      propertyId: a.propertyId, key: 'SLIPPERS',
    }))).toBeNull();

    await owner.query(
      `UPDATE request_types SET is_active = true WHERE property_id = $1 AND key = 'SLIPPERS'`,
      [a.propertyId]);
  });

  /* ── Raising one ──────────────────────────────────────────────────────── */

  it('takes a free request at REQUEST tier, with no prompt (#9)', async () => {
    const raised = await raise('EXTRA_TOWELS', { quantity: 2, accessTier: 'REQUEST' });

    expect(raised.totalMinor).toBe(0);
    expect(raised.requestNumber).toMatch(/^SR-\d+$/);
    // The promise the guest is given IS the SLA deadline (DATA-MODEL §7).
    expect(raised.slaTargetAt.getTime()).toBeGreaterThan(Date.now());

    const [request] = await scoped((tx) => getRequestsForStay(tx, { stayId }));
    expect(request!.status).toBe('OPEN');
    expect(request!.lines).toEqual([
      { label: 'Extra towels', quantity: 2, unitPriceMinor: 0, lineTotalMinor: 0 },
    ]);
    expect(request!.breached).toBe(false);

    // Nothing on the folio: a free request is free.
    expect(await scoped((tx) => getFolioForStay(tx, stayId))).toBeNull();
  });

  it('refuses a chargeable request below CHARGE tier, and names the amount', async () => {
    // D-012 on this path: the screen escalates, and this refuses regardless of
    // what the screen did.
    await expect(raise('LAUNDRY', { accessTier: 'REQUEST' }))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(raise('LAUNDRY', { accessTier: 'REQUEST' }))
      .rejects.toThrow(/₹450/);
  });

  it('charges the room for a chargeable request, in the same transaction', async () => {
    const raised = await raise('LAUNDRY', { quantity: 2, accessTier: 'CHARGE' });
    expect(raised.totalMinor).toBe(90_000);

    const folio = await scoped((tx) => getFolioForStay(tx, stayId));
    expect(folio!.chargesMinor).toBe(90_000);
    const line = folio!.lines.find((l) => l.sourceRefId === raised.requestId)!;
    expect(line.source).toBe('SERVICE_REQUEST');
    expect(line.description).toContain(raised.requestNumber);
  });

  it('snapshots the label and the price as asked (#6)', async () => {
    const raised = await raise('LAUNDRY', { accessTier: 'CHARGE' });

    await owner.query(
      `UPDATE request_types SET name = 'Valet laundry', price_minor = 99900
       WHERE property_id = $1 AND key = 'LAUNDRY'`, [a.propertyId]);

    const request = await scoped((tx) => getRequestForStay(tx, {
      stayId, requestId: raised.requestId,
    }));
    // Renaming and repricing the type cannot rewrite what the guest asked for.
    expect(request!.lines[0]!.label).toBe('Laundry service');
    expect(request!.lines[0]!.unitPriceMinor).toBe(45_000);
    expect(request!.totalMinor).toBe(45_000);

    await owner.query(
      `UPDATE request_types SET name = 'Laundry service', price_minor = 45000
       WHERE property_id = $1 AND key = 'LAUNDRY'`, [a.propertyId]);
  });

  it('is idempotent: one key, one request (#8)', async () => {
    const first = await raise('EXTRA_TOWELS', { idempotencyKey: 'same-key' });
    const second = await raise('EXTRA_TOWELS', { idempotencyKey: 'same-key' });

    expect(second.requestId).toBe(first.requestId);
    expect(second.wasAlreadyRaised).toBe(true);
    // And the replayed body comes back as a Date, not the ISO string JSON kept.
    expect(second.slaTargetAt).toBeInstanceOf(Date);
    expect(second.slaTargetAt.getTime()).toBe(first.slaTargetAt.getTime());

    expect(await scoped((tx) => getRequestsForStay(tx, { stayId }))).toHaveLength(1);
  });

  it('survives a real double-tap: two concurrent sends, one request', async () => {
    const results = await Promise.allSettled([
      raise('DRINKING_WATER', { idempotencyKey: 'double-tap' }),
      raise('DRINKING_WATER', { idempotencyKey: 'double-tap' }),
    ]);

    // One succeeds; the other either replays it or is refused as in-flight.
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(await scoped((tx) => getRequestsForStay(tx, { stayId }))).toHaveLength(1);
  });

  it('takes several things in one request, and promises the slowest', async () => {
    const raised = await raise('', {
      lines: [
        { key: 'WAKE_UP_CALL', quantity: 1 },   // 5 minutes
        { key: 'ROOM_CLEANING', quantity: 1 },  // 45 minutes
      ],
    });

    // Both cannot be the promise. The longest means the request is not marked
    // breached while part of it is legitimately still coming.
    const minutes = Math.round((raised.slaTargetAt.getTime() - Date.now()) / 60_000);
    expect(minutes).toBeGreaterThan(40);
    expect(minutes).toBeLessThanOrEqual(45);

    const [request] = await scoped((tx) => getRequestsForStay(tx, { stayId }));
    expect(request!.lines).toHaveLength(2);
  });

  it('holds the quantity rules the type declares', async () => {
    await expect(raise('EXTRA_TOWELS', { quantity: 9 })).rejects.toThrow(/4 is the most/);
    // A type that does not take a quantity is one at a time.
    await expect(raise('IRON_BOARD', { quantity: 2 })).rejects.toThrow(/one at a time/);
    await expect(raise('EXTRA_TOWELS', { quantity: 0 }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('takes a photo only where a photo makes sense', async () => {
    const raised = await raise('PLUMBING_ISSUE', {
      photoUrl: 'https://cdn.example/leak.jpg',
      guestNote: 'Dripping under the basin.',
    });
    const request = await scoped((tx) => getRequestForStay(tx, {
      stayId, requestId: raised.requestId,
    }));
    expect(request!.photoUrl).toBe('https://cdn.example/leak.jpg');
    expect(request!.guestNote).toBe('Dripping under the basin.');

    // A photo on a towel request is someone poking at the API.
    await expect(raise('EXTRA_TOWELS', { photoUrl: 'https://cdn.example/towel.jpg' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('writes the opening to the event log (#7)', async () => {
    const raised = await raise('EXTRA_TOWELS', { quantity: 2 });

    const events = await scoped((tx) => readEventHistory(tx, 'service_request', raised.requestId));
    /**
     * `unrouted` as well, because no fixture staff are clocked in — auto-routing
     * records the hole in the rota rather than assigning to nobody. Proven
     * properly in tests/integration/routing.test.ts.
     */
    expect(events.map((e) => e.event_type)).toEqual([
      'service_request.opened', 'service_request.unrouted',
    ]);
    const payload = events[0]!.payload as { lines: string[]; roomNumber: string };
    expect(payload.lines).toEqual(['2× Extra towels']);
    expect(payload.roomNumber).toBeTruthy();
  });

  it('refuses a request type from another property', async () => {
    const theirType = await withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => getRequestTypeByKey(tx, { propertyId: b.propertyId, key: 'EXTRA_TOWELS' }),
    );

    await expect(scoped((tx) => raiseServiceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
      lines: [{ requestTypeId: theirType!.id, quantity: 1 }],
      idempotencyKey: 'cross-tenant', accessTier: 'REQUEST',
    }))).rejects.toBeInstanceOf(ConflictError);
  });

  /* ── Moving one ───────────────────────────────────────────────────────── */

  it('walks a request from open to verified, stamping each step', async () => {
    const raised = await raise('EXTRA_TOWELS');

    for (const to of ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'] as const) {
      const result = await advance(raised.requestId, to, {
        assignedStaffId: to === 'ASSIGNED' ? staff.staffUserId : undefined,
      });
      expect(result.to).toBe(to);
    }

    const row = await owner.query(
      `SELECT status, assigned_at, started_at, completed_at, verified_at
       FROM service_requests WHERE id = $1`, [raised.requestId]);
    expect(row.rows[0].status).toBe('VERIFIED');
    for (const column of ['assigned_at', 'started_at', 'completed_at', 'verified_at']) {
      expect(row.rows[0][column], column).not.toBeNull();
    }

    const events = await scoped((tx) => readEventHistory(tx, 'service_request', raised.requestId));
    // `unrouted` sits after `opened`: nobody is on shift in these fixtures, so
    // routing records why and the transitions below are the manual ones.
    expect(events.map((e) => e.event_type)).toEqual([
      'service_request.opened', 'service_request.unrouted', 'service_request.assigned',
      'service_request.in_progress', 'service_request.completed',
      'service_request.verified',
    ]);
  });

  it('lets someone pick it up and start walking in one tap', async () => {
    const raised = await raise('DRINKING_WATER');
    const result = await advance(raised.requestId, 'IN_PROGRESS', {
      assignedStaffId: staff.staffUserId,
    });
    expect(result.to).toBe('IN_PROGRESS');
  });

  it('clears the assignee when a request is handed back', async () => {
    const raised = await raise('EXTRA_TOWELS');
    await advance(raised.requestId, 'ASSIGNED', { assignedStaffId: staff.staffUserId });
    await advance(raised.requestId, 'OPEN');

    // Otherwise the board shows an OPEN request with somebody's name on it and
    // the next person assumes it is covered.
    const row = await owner.query(
      `SELECT assigned_staff_id, assigned_at FROM service_requests WHERE id = $1`,
      [raised.requestId]);
    expect(row.rows[0].assigned_staff_id).toBeNull();
    expect(row.rows[0].assigned_at).toBeNull();
  });

  it('records one transition when two phones tap the same request', async () => {
    const raised = await raise('EXTRA_TOWELS');

    const results = await Promise.allSettled([
      advance(raised.requestId, 'IN_PROGRESS'),
      advance(raised.requestId, 'IN_PROGRESS'),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const events = await scoped((tx) => readEventHistory(tx, 'service_request', raised.requestId));
    expect(events.filter((e) => e.event_type === 'service_request.in_progress')).toHaveLength(1);
  });

  it('interrupts only when the request actually diverged', async () => {
    const raised = await raise('EXTRA_TOWELS');
    await advance(raised.requestId, 'CANCELLED', { reason: 'Found some in the wardrobe.' });

    await expect(advance(raised.requestId, 'IN_PROGRESS'))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('will not reject or cancel without a reason the guest can be told', async () => {
    const raised = await raise('EXTRA_TOWELS');
    await expect(advance(raised.requestId, 'REJECTED')).rejects.toBeInstanceOf(ValidationError);

    const rejected = await advance(raised.requestId, 'REJECTED', {
      reason: 'Laundry is closed until six.',
    });
    expect(rejected.to).toBe('REJECTED');

    const request = await scoped((tx) => getRequestForStay(tx, {
      stayId, requestId: raised.requestId,
    }));
    expect(request!.rejectionReason).toBe('Laundry is closed until six.');
  });

  it('refuses a request at another property', async () => {
    const raised = await raise('EXTRA_TOWELS');
    await expect(withTenant(
      { tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => advanceRequest(tx, {
        tenantId: b.tenantId, propertyId: b.propertyId, requestId: raised.requestId,
        to: 'IN_PROGRESS', actor: staff,
      }),
    )).rejects.toBeInstanceOf(NotFoundError);
  });

  /* ── The board, and the SLA ───────────────────────────────────────────── */

  it('orders the board by urgency, not by age', async () => {
    // Towels first (12 minutes), then a wake-up call (5). The wake-up call is
    // newer and more urgent, and a board sorted by age would bury it.
    const towels = await raise('EXTRA_TOWELS');
    const wakeUp = await raise('WAKE_UP_CALL');

    const board = await scoped((tx) => getOpenRequests(tx, { propertyId: a.propertyId }));
    expect(board.map((r) => r.id)).toEqual([wakeUp.requestId, towels.requestId]);
  });

  it('shows a breach while someone is still working on it', async () => {
    const raised = await raise('WAKE_UP_CALL');
    await advance(raised.requestId, 'IN_PROGRESS');

    // DATA-MODEL §6 — a breach is not a status. Read the board from the future.
    const later = new Date(Date.now() + 60 * 60_000);
    const board = await scoped((tx) => getOpenRequests(tx, {
      propertyId: a.propertyId, now: later,
    }));
    const found = board.find((r) => r.id === raised.requestId)!;
    expect(found.status).toBe('IN_PROGRESS');
    expect(found.breached).toBe(true);
    expect(found.secondsRemaining).toBeLessThan(0);
  });

  it('stops the clock when the work stops', async () => {
    const raised = await raise('WAKE_UP_CALL');
    await advance(raised.requestId, 'IN_PROGRESS');
    await advance(raised.requestId, 'COMPLETED');

    const later = new Date(Date.now() + 60 * 60_000);
    const [request] = await scoped((tx) => getRequestsForStay(tx, { stayId, now: later }));
    expect(request!.status).toBe('COMPLETED');
    expect(request!.breached).toBe(false);
  });

  it('drops a finished request off the board', async () => {
    const raised = await raise('EXTRA_TOWELS');
    expect(await scoped((tx) => getOpenRequests(tx, { propertyId: a.propertyId })))
      .toHaveLength(1);

    await advance(raised.requestId, 'IN_PROGRESS');
    await advance(raised.requestId, 'COMPLETED');
    expect(await scoped((tx) => getOpenRequests(tx, { propertyId: a.propertyId })))
      .toHaveLength(0);
  });

  it('will not hand a request to the room next door', async () => {
    const raised = await raise('EXTRA_TOWELS');

    // The scoping is by STAY, not by property: an id in a URL read with anyone
    // else's stay resolves to nothing rather than to their leaking tap.
    expect(await scoped((tx) => getRequestForStay(tx, {
      stayId: '99999999-9999-4999-8999-999999999999',
      requestId: raised.requestId,
    }))).toBeNull();

    // And it is still there for the guest it belongs to.
    expect(await scoped((tx) => getRequestForStay(tx, {
      stayId, requestId: raised.requestId,
    }))).not.toBeNull();
  });

  it('has a one-tap service type on every property', async () => {
    const call = await scoped((tx) => getRequestTypeByKey(tx, {
      propertyId: a.propertyId, key: CALL_SERVICE_KEY,
    }));
    expect(call).toBeTruthy();
    expect(call!.priceMinor).toBe(0);
    // The whole point: one tap, no queue, no reason needed, and no prompt.
    expect(call!.isChargeable).toBe(false);
  });
});
