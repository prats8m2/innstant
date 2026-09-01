import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  getRequestTypeByKey, raiseServiceRequest, advanceRequest, getOpenRequests,
  escalateBreachesFor, sweepSlaBreaches,
} from '@/modules/requests';
import { notificationsFor, unacknowledgedCount } from '@/modules/notifications';
import { clockIn } from '@/modules/housekeeping';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, type Fixture,
} from './setup';

/**
 * The SLA sweep — the other half of P2's exit criterion, "breaches visibly
 * escalate".
 *
 * Every test moves the CLOCK rather than the data: `escalateBreachesFor` takes
 * `now`, so a breach at eleven minutes past can be tested in a millisecond and
 * the assertions are about the rule rather than about waiting.
 */
describe('the SLA sweep', () => {
  let owner: pg.Client;
  let a: Fixture;
  let stayId: string;
  let sunita = '';
  let gm = '';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  const sweep = (now: Date) => scoped((tx) => escalateBreachesFor(tx, {
    tenantId: a.tenantId, propertyId: a.propertyId, now,
  }));

  const raise = (key = 'EXTRA_TOWELS', suffix = String(Math.random())) => scoped(async (tx) => {
    const type = await getRequestTypeByKey(tx, { propertyId: a.propertyId, key });
    return raiseServiceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
      lines: [{ requestTypeId: type!.id, quantity: 1 }],
      idempotencyKey: `sla-${key}-${suffix}`, accessTier: 'REQUEST',
    });
  });

  const stateOf = async (requestId: string) => {
    const rows = await owner.query<{ escalation_level: number; escalated_at: Date | null; status: string }>(
      `SELECT escalation_level, escalated_at, status FROM service_requests WHERE id = $1`,
      [requestId]);
    return rows.rows[0]!;
  };

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    stayId = await checkInGuest(a);

    const gmRow = await owner.query<{ id: string }>(
      `SELECT su.id FROM staff_users su
       JOIN staff_property_roles spr ON spr.staff_user_id = su.id
       JOIN roles r ON r.id = spr.role_id
       WHERE spr.property_id = $1 AND r.key = 'PROPERTY_ADMIN' LIMIT 1`, [a.propertyId]);
    gm = gmRow.rows[0]!.id;

    const staff = await owner.query<{ id: string }>(
      `INSERT INTO staff_users (tenant_id, email, full_name, status)
       VALUES ($1, 'sweep-sunita@test.example', 'Sunita Devi', 'ACTIVE') RETURNING id`,
      [TENANT_A]);
    sunita = staff.rows[0]!.id;
    const role = await owner.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'HOUSEKEEPING'`, [TENANT_A]);
    await owner.query(
      `INSERT INTO staff_property_roles (tenant_id, staff_user_id, property_id, role_id)
       VALUES ($1, $2, $3, $4)`, [TENANT_A, sunita, a.propertyId, role.rows[0]!.id]);
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['service_request_items', 'service_requests', 'notifications',
                     'shift_zones', 'shifts', 'folio_lines', 'folios', 'idempotency_keys']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [TENANT_A]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = $1`, [TENANT_A]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('leaves a request inside its promise alone', async () => {
    const raised = await raise();
    const escalated = await sweep(new Date(raised.slaTargetAt.getTime() - 60_000));

    expect(escalated).toBe(0);
    expect((await stateOf(raised.requestId)).escalation_level).toBe(0);
  });

  it('escalates to level 1 the moment it is late, without changing the status', async () => {
    const raised = await raise();
    const escalated = await sweep(new Date(raised.slaTargetAt.getTime() + 60_000));

    expect(escalated).toBe(1);
    const state = await stateOf(raised.requestId);
    expect(state.escalation_level).toBe(1);
    expect(state.escalated_at).not.toBeNull();
    // DATA-MODEL §6 — a breach is NOT a status. Turning it into one would lose
    // the fact that somebody may well be walking.
    expect(state.status).toBe('OPEN');
  });

  it('reaches the duty manager at level 2, and says how late', async () => {
    const raised = await raise();
    await sweep(new Date(raised.slaTargetAt.getTime() + 11 * 60_000));

    expect((await stateOf(raised.requestId)).escalation_level).toBe(2);

    const forGm = await scoped((tx) => notificationsFor(tx, {
      propertyId: a.propertyId, staffUserId: gm,
    }));
    expect(forGm).toHaveLength(1);
    expect(forGm[0]!.template).toBe('service_request.escalated');
    expect(forGm[0]!.entityId).toBe(raised.requestId);
    expect(forGm[0]!.payload.level).toBe(2);
    expect(Number(forGm[0]!.payload.minutesLate)).toBeGreaterThanOrEqual(11);
  });

  it('tells the assignee at level 1 and nobody else', async () => {
    const floorId = await floorOfRoom();
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita,
      floorIds: [floorId],
    }));
    const raised = await raise();

    // Auto-routed to Sunita on the way in.
    await sweep(new Date(raised.slaTargetAt.getTime() + 60_000));

    expect(await scoped((tx) => unacknowledgedCount(tx, {
      propertyId: a.propertyId, staffUserId: sunita,
    }))).toBe(1);
    // The GM is not woken for a two-minute overrun on towels.
    expect(await scoped((tx) => unacknowledgedCount(tx, {
      propertyId: a.propertyId, staffUserId: gm,
    }))).toBe(0);
  });

  it('escalates once per level, however many times it runs', async () => {
    const raised = await raise();
    const late = new Date(raised.slaTargetAt.getTime() + 12 * 60_000);

    expect(await sweep(late)).toBe(1);
    expect(await sweep(late)).toBe(0);
    expect(await sweep(late)).toBe(0);

    // One escalation event, one notification. A sweep that ran twice a minute
    // for an hour must not send sixty messages.
    const events = await scoped((tx) => readEventHistory(tx, 'service_request', raised.requestId));
    expect(events.filter((e) => e.event_type === 'service_request.escalated')).toHaveLength(1);
    expect(await scoped((tx) => unacknowledgedCount(tx, {
      propertyId: a.propertyId, staffUserId: gm,
    }))).toBe(1);
  });

  it('climbs a level at a time as it gets later', async () => {
    const raised = await raise();
    const at = (minutes: number) => new Date(raised.slaTargetAt.getTime() + minutes * 60_000);

    await sweep(at(1));
    expect((await stateOf(raised.requestId)).escalation_level).toBe(1);
    await sweep(at(11));
    expect((await stateOf(raised.requestId)).escalation_level).toBe(2);
    await sweep(at(31));
    expect((await stateOf(raised.requestId)).escalation_level).toBe(3);

    // And it stops. Escalating for ever is noise a duty manager mutes.
    await sweep(at(300));
    expect((await stateOf(raised.requestId)).escalation_level).toBe(3);

    const events = await scoped((tx) => readEventHistory(tx, 'service_request', raised.requestId));
    const levels = events
      .filter((e) => e.event_type === 'service_request.escalated')
      .map((e) => (e.payload as { level: number }).level);
    expect(levels.map(Number)).toEqual([1, 2, 3]);
  });

  it('jumps straight to the level it deserves after an outage', async () => {
    // The sweeper was down for an hour. The first run afterwards should not
    // walk a request through three escalations to catch up.
    const raised = await raise();
    await sweep(new Date(raised.slaTargetAt.getTime() + 45 * 60_000));

    expect((await stateOf(raised.requestId)).escalation_level).toBe(3);
    const events = await scoped((tx) => readEventHistory(tx, 'service_request', raised.requestId));
    expect(events.filter((e) => e.event_type === 'service_request.escalated')).toHaveLength(1);
  });

  it('stops escalating once the work is done', async () => {
    const raised = await raise();
    await scoped((tx) => advanceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, requestId: raised.requestId,
      to: 'IN_PROGRESS', actor: { kind: 'SYSTEM' },
    }));
    await scoped((tx) => advanceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, requestId: raised.requestId,
      to: 'COMPLETED', actor: { kind: 'SYSTEM' },
    }));

    // The clock stops with the work, not when someone reads the board.
    expect(await sweep(new Date(raised.slaTargetAt.getTime() + 90 * 60_000))).toBe(0);
    expect((await stateOf(raised.requestId)).escalation_level).toBe(0);
  });

  it('keeps escalating something somebody is actively working on', async () => {
    const raised = await raise();
    await scoped((tx) => advanceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, requestId: raised.requestId,
      to: 'IN_PROGRESS', actor: { kind: 'SYSTEM' },
    }));

    expect(await sweep(new Date(raised.slaTargetAt.getTime() + 11 * 60_000))).toBe(1);
    const state = await stateOf(raised.requestId);
    expect(state.escalation_level).toBe(2);
    expect(state.status).toBe('IN_PROGRESS');
  });

  it('does not escalate a cancelled request', async () => {
    const raised = await raise();
    await scoped((tx) => advanceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, requestId: raised.requestId,
      to: 'CANCELLED', actor: { kind: 'SYSTEM' }, reason: 'Found some.',
    }));

    expect(await sweep(new Date(raised.slaTargetAt.getTime() + 90 * 60_000))).toBe(0);
  });

  it('shows on the board as breached, with the status it actually has', async () => {
    const raised = await raise();
    const late = new Date(raised.slaTargetAt.getTime() + 11 * 60_000);
    await sweep(late);

    const board = await scoped((tx) => getOpenRequests(tx, {
      propertyId: a.propertyId, now: late,
    }));
    const card = board.find((r) => r.id === raised.requestId)!;
    expect(card.breached).toBe(true);
    expect(card.escalationLevel).toBe(2);
    expect(card.escalatedAt).toBeInstanceOf(Date);
    expect(card.status).toBe('OPEN');
  });

  it('escalates several at once and counts them', async () => {
    const one = await raise('EXTRA_TOWELS', 'many-1');
    const two = await raise('EXTRA_PILLOW', 'many-2');

    const late = new Date(Math.max(
      one.slaTargetAt.getTime(), two.slaTargetAt.getTime(),
    ) + 60_000);
    expect(await sweep(late)).toBe(2);
  });

  it('finds the property to sweep without a tenant context', async () => {
    // The whole reason migration 0004 exists: a job on a timer has no request to
    // derive a tenant from, and app_user under RLS with no `app.tenant_id`
    // correctly sees nothing.
    const raised = await raise();
    await owner.query(
      `UPDATE service_requests SET sla_target_at = now() - interval '20 minutes' WHERE id = $1`,
      [raised.requestId]);

    const result = await sweepSlaBreaches();
    expect(result.ran).toBe(true);
    expect(result.propertiesChecked).toBeGreaterThanOrEqual(1);
    expect(result.escalated).toBeGreaterThanOrEqual(1);
    expect((await stateOf(raised.requestId)).escalation_level).toBe(2);
  });

  async function floorOfRoom(): Promise<string> {
    const rows = await owner.query<{ floor_id: string }>(
      `SELECT floor_id FROM rooms WHERE id = $1`, [a.roomId]);
    return rows.rows[0]!.floor_id;
  }
});
