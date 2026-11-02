import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant } from '@/db';
import { listDeparturesToday, checkOutStay } from '@/modules/stay';
import { clockIn } from '@/modules/housekeeping';
import {
  getRequestTypeByKey, raiseServiceRequest, advanceRequest, getRequestsClosedToday,
} from '@/modules/requests';
import { ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * D-094: the two reads behind the Leaving screen and the console's live
 * requests — today's departures, and today's finished requests — on the
 * property's day, never another hotel's.
 */
describe('the front office, today', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let staff: string;
  const TZ = 'Asia/Kolkata';
  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
    staff = (await owner.query<{ id: string }>(
      `INSERT INTO staff_users (tenant_id, email, full_name, status)
       VALUES ($1, 'desk@a.example', 'Desk', 'ACTIVE') RETURNING id`, [a.tenantId])).rows[0]!.id;
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('lists who is due out today — overdue included — and who has gone', async () => {
    const stayId = await checkInGuest(a, { name: 'Leaving Today' });

    // Due in two days: not today's business.
    expect((await scoped((tx) => listDeparturesToday(tx, { propertyId: a.propertyId, timeZone: TZ }))).due)
      .toEqual([]);

    // Their time was an hour ago and they are still in the room: overdue,
    // which is the row a desk most needs.
    await owner.query(`UPDATE stays SET scheduled_checkout_at = now() - interval '1 hour' WHERE id = $1`, [stayId]);
    const before = await scoped((tx) => listDeparturesToday(tx, { propertyId: a.propertyId, timeZone: TZ }));
    expect(before.due.map((d) => d.guestName)).toEqual(['Leaving Today']);
    expect(before.due[0]!.roomNumber).toBeTruthy();
    expect(before.left).toEqual([]);

    await scoped((tx) => checkOutStay(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: staff,
    }));
    const after = await scoped((tx) => listDeparturesToday(tx, { propertyId: a.propertyId, timeZone: TZ }));
    expect(after.due).toEqual([]);
    expect(after.left.map((d) => d.stayId)).toEqual([stayId]);
    expect(after.left[0]!.checkedOutAt).toBeInstanceOf(Date);

    // Nobody else's departures.
    const theirs = await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => listDeparturesToday(tx, { propertyId: a.propertyId, timeZone: TZ }));
    expect(theirs).toEqual({ due: [], left: [] });
  });

  it('lists the requests finished today, and not the ones still open', async () => {
    const stayId = await checkInGuest(a, { name: 'Wants Towels' });
    const towels = await scoped((tx) => getRequestTypeByKey(tx, { propertyId: a.propertyId, key: 'EXTRA_TOWELS' }));
    const raise = (key: string) => scoped((tx) => raiseServiceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
      lines: [{ requestTypeId: towels!.id, quantity: 1 }],
      idempotencyKey: key, accessTier: 'REQUEST',
    }));
    const actor = { kind: 'STAFF' as const, staffUserId: staff };
    const move = (requestId: string, to: Parameters<typeof advanceRequest>[1]['to'], extra = {}) =>
      scoped((tx) => advanceRequest(tx, { tenantId: a.tenantId, propertyId: a.propertyId, requestId, to, actor, ...extra }));

    const finished = await raise('done-today');
    await move(finished.requestId, 'IN_PROGRESS', { assignedStaffId: staff });
    await move(finished.requestId, 'COMPLETED');

    const refused = await raise('refused-today');
    await move(refused.requestId, 'REJECTED', { reason: 'Out of towels' });

    const stillOpen = await raise('still-open');

    const closed = await scoped((tx) => getRequestsClosedToday(tx, { propertyId: a.propertyId, timeZone: TZ }));
    const ids = closed.map((r) => r.id);
    expect(ids).toContain(finished.requestId);
    expect(ids).toContain(refused.requestId);
    expect(ids).not.toContain(stillOpen.requestId);
    expect(closed.find((r) => r.id === refused.requestId)!.rejectionReason).toBe('Out of towels');

    const theirs = await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => getRequestsClosedToday(tx, { propertyId: a.propertyId, timeZone: TZ }));
    expect(theirs).toEqual([]);
  });

  it('reassigns through the machine as two honest steps', async () => {
    // The guest the test above checked in is still in the room.
    const stayId = (await owner.query<{ id: string }>(
      `SELECT id FROM stays WHERE room_id = $1 AND status = 'CHECKED_IN'`, [a.roomId])).rows[0]!.id;
    const towels = await scoped((tx) => getRequestTypeByKey(tx, { propertyId: a.propertyId, key: 'EXTRA_TOWELS' }));
    const raised = await scoped((tx) => raiseServiceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
      lines: [{ requestTypeId: towels!.id, quantity: 1 }],
      idempotencyKey: 'reassign', accessTier: 'REQUEST',
    }));
    const other = (await owner.query<{ id: string }>(
      `INSERT INTO staff_users (tenant_id, email, full_name, status)
       VALUES ($1, 'second@a.example', 'Second', 'ACTIVE') RETURNING id`, [a.tenantId])).rows[0]!.id;
    const actor = { kind: 'STAFF' as const, staffUserId: staff };

    // D-098: a request can only go to somebody on shift. The second person is
    // not clocked in yet — refused — then clocks in, and can be given it.
    await scoped((tx) => clockIn(tx, { tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: staff, floorIds: [a.floorId] }));
    await expect(scoped((tx) => advanceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, requestId: raised.requestId, to: 'ASSIGNED', actor, assignedStaffId: other,
    }))).rejects.toThrow(/not clocked in/);
    await scoped((tx) => clockIn(tx, { tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: other, floorIds: [a.floorId] }));

    await scoped(async (tx) => {
      await advanceRequest(tx, { tenantId: a.tenantId, propertyId: a.propertyId, requestId: raised.requestId, to: 'ASSIGNED', actor, assignedStaffId: staff });
      // What the console's "Give it to someone else" does: back, then on.
      await advanceRequest(tx, { tenantId: a.tenantId, propertyId: a.propertyId, requestId: raised.requestId, to: 'OPEN', actor });
      await advanceRequest(tx, { tenantId: a.tenantId, propertyId: a.propertyId, requestId: raised.requestId, to: 'ASSIGNED', actor, assignedStaffId: other });
    });

    const row = await owner.query<{ status: string; assigned_staff_id: string }>(
      `SELECT status, assigned_staff_id FROM service_requests WHERE id = $1`, [raised.requestId]);
    expect(row.rows[0]).toEqual({ status: 'ASSIGNED', assigned_staff_id: other });
  });
});
