import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readStaffActivity, recordEvent } from '@/db';
import { clockIn, listOnShift, endShiftFor, getCurrentShift } from '@/modules/housekeeping';
import { ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * D-088: who is on shift, a manager closing somebody else's shift, and one
 * person's recent work — the three things the Staff screen reads.
 */
describe('staff presence and activity', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let runner: string;
  let manager: string;
  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  async function person(tenantId: string, email: string): Promise<string> {
    return (await owner.query<{ id: string }>(
      `INSERT INTO staff_users (tenant_id, email, full_name, status)
       VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`, [tenantId, email, email.split('@')[0]])).rows[0]!.id;
  }

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
    runner = await person(a.tenantId, 'ravi@a.example');
    manager = await person(a.tenantId, 'gm@a.example');
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('lists who is clocked in, with their floors', async () => {
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: runner, floorIds: [a.floorId],
    }));
    const on = await scoped((tx) => listOnShift(tx, a.propertyId));
    expect(on).toHaveLength(1);
    expect(on[0]!.staffUserId).toBe(runner);
    expect(on[0]!.zones.map((z) => z.floorName)).toEqual(['Ground']);
    expect(on[0]!.clockedInAt).toBeInstanceOf(Date);
  });

  it('lets a manager close the shift, and records that it was the manager', async () => {
    await scoped((tx) => endShiftFor(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, targetStaffId: runner, actorStaffId: manager,
    }));
    expect(await scoped((tx) => getCurrentShift(tx, { propertyId: a.propertyId, staffUserId: runner }))).toBeNull();
    expect(await scoped((tx) => listOnShift(tx, a.propertyId))).toEqual([]);

    const event = await owner.query<{ actor_staff_id: string; payload: { staffUserId: string; byManager: boolean } }>(
      `SELECT actor_staff_id, payload FROM event_log
       WHERE tenant_id = $1 AND event_type = 'shift.clocked_out'`, [a.tenantId]);
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]!.actor_staff_id).toBe(manager);
    expect(event.rows[0]!.payload).toEqual({ staffUserId: runner, byManager: true });

    // Twice is refused rather than writing a second, false event.
    await expect(scoped((tx) => endShiftFor(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, targetStaffId: runner, actorStaffId: manager,
    }))).rejects.toThrow(/not clocked in/);
  });

  it('reads one person\'s work, newest first, without their sign-ins', async () => {
    await scoped(async (tx) => {
      await recordEvent(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, entityType: 'staff', entityId: runner,
        eventType: 'staff.logged_in', actor: { kind: 'STAFF', staffUserId: runner },
      });
      await recordEvent(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, entityType: 'order', entityId: a.roomId,
        eventType: 'order.out_for_delivery', actor: { kind: 'STAFF', staffUserId: runner },
        payload: { orderNumber: 'KE-0001' },
      });
    });

    const work = await scoped((tx) => readStaffActivity(tx, { propertyId: a.propertyId, staffUserId: runner }));
    expect(work.map((e) => e.eventType)).toEqual(['order.out_for_delivery', 'shift.clocked_in']);
    expect(work[0]!.payload).toEqual({ orderNumber: 'KE-0001' });
    expect(work.every((e) => e.eventType !== 'staff.logged_in')).toBe(true);

    // The manager's clock-out is the MANAGER's work, not the runner's.
    const theirs = await scoped((tx) => readStaffActivity(tx, { propertyId: a.propertyId, staffUserId: manager }));
    expect(theirs.map((e) => e.eventType)).toEqual(['shift.clocked_out']);
  });

  it('never shows another hotel\'s shifts or activity', async () => {
    const shifts = await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => listOnShift(tx, a.propertyId));
    const work = await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => readStaffActivity(tx, { propertyId: a.propertyId, staffUserId: runner }));
    expect(shifts).toEqual([]);
    expect(work).toEqual([]);
  });
});
