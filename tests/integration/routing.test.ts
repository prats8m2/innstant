import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  getRequestTypeByKey, raiseServiceRequest, getRequestForStay, getOpenRequests,
  advanceRequest,
} from '@/modules/requests';
import { clockIn, clockOut, getCurrentShift, onDutyCovering } from '@/modules/housekeeping';
import { NotFoundError, ValidationError } from '@/lib/errors';
import {
  ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, type Fixture,
} from './setup';

/**
 * Auto-routing — P2's exit criterion, against a real database.
 *
 *   "a request raised by a guest reaches the correct on-duty staff member's
 *    phone without anyone assigning it"
 *
 * Every test below turns one term of role ∩ on-shift ∩ covers-floor off and
 * checks that the request is NOT routed, because each of those terms is there
 * to stop a specific way a hotel breaks — and a rule that routes anyway is worse
 * than no rule at all: the request looks handled and nobody is coming.
 */
describe('auto-routing', () => {
  let owner: pg.Client;
  let a: Fixture;
  let stayId: string;
  let floorId: string;
  let otherFloorId: string;

  /** Two housekeepers and a runner, all real staff rows with real roles. */
  let sunita = '';
  let ravi = '';
  let deepak = '';

  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);

  async function makeStaff(name: string, email: string, roleKey: string): Promise<string> {
    const staff = await owner.query<{ id: string }>(
      `INSERT INTO staff_users (tenant_id, email, full_name, status)
       VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [TENANT_A, email, name]);
    const id = staff.rows[0]!.id;

    const role = await owner.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = $2`, [TENANT_A, roleKey]);
    await owner.query(
      `INSERT INTO staff_property_roles (tenant_id, staff_user_id, property_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [TENANT_A, id, a.propertyId, role.rows[0]!.id]);

    return id;
  }

  const raise = (key: string, keySuffix = String(Math.random())) => scoped(async (tx) => {
    const type = await getRequestTypeByKey(tx, { propertyId: a.propertyId, key });
    return raiseServiceRequest(tx, {
      tenantId: a.tenantId,
      propertyId: a.propertyId,
      stayId,
      roomId: a.roomId,
      lines: [{ requestTypeId: type!.id, quantity: 1 }],
      idempotencyKey: `route-${key}-${keySuffix}`,
      accessTier: 'REQUEST',
    });
  });

  const assigneeOf = async (requestId: string) =>
    (await scoped((tx) => getRequestForStay(tx, { stayId, requestId })))?.assignedStaffId ?? null;

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    stayId = await checkInGuest(a);

    const room = await owner.query<{ floor_id: string }>(
      `SELECT floor_id FROM rooms WHERE id = $1`, [a.roomId]);
    floorId = room.rows[0]!.floor_id;

    const other = await owner.query<{ id: string }>(
      `SELECT id FROM floors WHERE property_id = $1 AND id <> $2 LIMIT 1`,
      [a.propertyId, floorId]);
    // The fixture may provision one floor; make a second so "covers this floor"
    // can actually be tested.
    otherFloorId = other.rows[0]?.id ?? (await owner.query<{ id: string }>(
      `INSERT INTO floors (tenant_id, property_id, name, level, sort_order)
       VALUES ($1, $2, 'Somewhere else', 9, 9) RETURNING id`,
      [TENANT_A, a.propertyId])).rows[0]!.id;

    sunita = await makeStaff('Sunita Devi', 'sunita@test.example', 'HOUSEKEEPING');
    ravi = await makeStaff('Ravi Kumar', 'ravi@test.example', 'HOUSEKEEPING');
    deepak = await makeStaff('Deepak Singh', 'deepak@test.example', 'RUNNER');
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    for (const t of ['service_request_items', 'service_requests', 'shift_zones', 'shifts',
                     'folio_lines', 'folios', 'idempotency_keys']) {
      await owner.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [TENANT_A]);
    }
    await owner.query(`DELETE FROM event_log WHERE tenant_id = $1`, [TENANT_A]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  /* ── Shifts ───────────────────────────────────────────────────────────── */

  it('clocks someone in for the floors they cover', async () => {
    const shift = await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita,
      floorIds: [floorId],
    }));

    expect(shift.status).toBe('ON_DUTY');
    expect(shift.clockedInAt).toBeInstanceOf(Date);
    expect(shift.zones.map((z) => z.floorId)).toEqual([floorId]);
    // The floor's NAME, not a uuid — the board shows it to a person.
    expect(shift.zones[0]!.floorName).toBeTruthy();
  });

  it('is idempotent — a double tap does not open two shifts', async () => {
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita,
      floorIds: [floorId],
    }));
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita,
      floorIds: [floorId],
    }));

    // Two open shifts would double-count that person in the ranking.
    const rows = await owner.query(
      `SELECT id FROM shifts WHERE staff_user_id = $1 AND status = 'ON_DUTY'`, [sunita]);
    expect(rows.rows).toHaveLength(1);
  });

  it('changes the floors mid-shift without reopening it', async () => {
    const first = await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita,
      floorIds: [floorId],
    }));
    const second = await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita,
      floorIds: [floorId, otherFloorId],
    }));

    // "Actually I have got the third as well" is a normal thing to say.
    expect(second.id).toBe(first.id);
    expect(second.zones).toHaveLength(2);
    expect(second.clockedInAt?.getTime()).toBe(first.clockedInAt?.getTime());
  });

  it('refuses a shift that covers nothing', async () => {
    // It could never be routed to, so it is not a shift.
    await expect(scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita, floorIds: [],
    }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('clocks out, and keeps the row', async () => {
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita,
      floorIds: [floorId],
    }));
    await scoped((tx) => clockOut(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita,
    }));

    expect(await scoped((tx) => getCurrentShift(tx, {
      propertyId: a.propertyId, staffUserId: sunita,
    }))).toBeNull();

    // The row is the record of who was where — a disputed breach reads it.
    const rows = await owner.query(
      `SELECT status, clocked_out_at FROM shifts WHERE staff_user_id = $1`, [sunita]);
    expect(rows.rows[0].status).toBe('OFF_DUTY');
    expect(rows.rows[0].clocked_out_at).not.toBeNull();
  });

  it('refuses to clock out someone who is not in', async () => {
    await expect(scoped((tx) => clockOut(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: ravi,
    }))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists who is on duty and covering a floor', async () => {
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita, floorIds: [floorId],
    }));
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: deepak,
      floorIds: [otherFloorId],
    }));

    const here = await scoped((tx) => onDutyCovering(tx, {
      propertyId: a.propertyId, floorId,
    }));
    expect(here.map((p) => p.staffUserId)).toEqual([sunita]);
    // With the roles they hold AT THIS PROPERTY, which is what routing matches.
    expect(here[0]!.roleKeys).toContain('HOUSEKEEPING');
  });

  /* ── The criterion ────────────────────────────────────────────────────── */

  it('reaches the on-duty housekeeper with nobody assigning it', async () => {
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita, floorIds: [floorId],
    }));

    const raised = await raise('EXTRA_TOWELS');

    // The whole of P2's exit criterion, in one assertion.
    expect(await assigneeOf(raised.requestId)).toBe(sunita);

    const request = await scoped((tx) => getRequestForStay(tx, {
      stayId, requestId: raised.requestId,
    }));
    expect(request!.status).toBe('ASSIGNED');
    expect(request!.assignedStaffName).toBe('Sunita Devi');

    // And the log says a MACHINE did it, which is what makes an auto-routed
    // request distinguishable from a claimed one.
    const events = await scoped((tx) => readEventHistory(tx, 'service_request', raised.requestId));
    const assigned = events.find((e) => e.event_type === 'service_request.assigned')!;
    expect(assigned.actor_kind).toBe('SYSTEM');
  });

  it('routes by ROLE — a runner does not get the towels', async () => {
    // Both on duty, both covering the floor. Only one holds HOUSEKEEPING.
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: deepak, floorIds: [floorId],
    }));
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita, floorIds: [floorId],
    }));

    const towels = await raise('EXTRA_TOWELS');
    expect(await assigneeOf(towels.requestId)).toBe(sunita);

    // And the other way round: drinking water routes to RUNNER.
    const water = await raise('DRINKING_WATER');
    expect(await assigneeOf(water.requestId)).toBe(deepak);
  });

  it('routes by FLOOR — the person on another floor does not walk', async () => {
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita,
      floorIds: [otherFloorId],
    }));

    const raised = await raise('EXTRA_TOWELS');
    expect(await assigneeOf(raised.requestId)).toBeNull();
  });

  it('gives it to whoever is carrying least', async () => {
    for (const staffUserId of [sunita, ravi]) {
      await scoped((tx) => clockIn(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, staffUserId, floorIds: [floorId],
      }));
    }

    // Three in a row. Sunita takes the first (alphabetically, both at zero),
    // Ravi the second, and then whoever is level again.
    const first = await raise('EXTRA_TOWELS', 'load-1');
    const second = await raise('EXTRA_TOWELS', 'load-2');

    const firstAssignee = await assigneeOf(first.requestId);
    const secondAssignee = await assigneeOf(second.requestId);

    expect(firstAssignee).not.toBeNull();
    // The point of the ranking: the second one does NOT go to the same person.
    expect(secondAssignee).not.toBe(firstAssignee);
    expect([sunita, ravi]).toContain(secondAssignee);
  });

  it('counts only work that is still open', async () => {
    for (const staffUserId of [sunita, ravi]) {
      await scoped((tx) => clockIn(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, staffUserId, floorIds: [floorId],
      }));
    }

    const first = await raise('EXTRA_TOWELS', 'closed-1');
    const firstAssignee = await assigneeOf(first.requestId);

    // Finish it. That person is carrying nothing again.
    await scoped((tx) => advanceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, requestId: first.requestId,
      to: 'IN_PROGRESS', actor: { kind: 'STAFF', staffUserId: firstAssignee! },
    }));
    await scoped((tx) => advanceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, requestId: first.requestId,
      to: 'COMPLETED', actor: { kind: 'STAFF', staffUserId: firstAssignee! },
    }));

    // Both at zero now, so the alphabetical tie-break decides — and it is the
    // same person as the first time.
    const second = await raise('EXTRA_TOWELS', 'closed-2');
    expect(await assigneeOf(second.requestId)).toBe(firstAssignee);
  });

  it('leaves a request OPEN when nobody is on shift, and says why', async () => {
    const raised = await raise('EXTRA_TOWELS');

    // A guest asking for towels at 4am is still asking for towels at 4am.
    const request = await scoped((tx) => getRequestForStay(tx, {
      stayId, requestId: raised.requestId,
    }));
    expect(request!.status).toBe('OPEN');
    expect(request!.assignedStaffId).toBeNull();

    // And the board still shows it — the fallback that always works.
    const board = await scoped((tx) => getOpenRequests(tx, { propertyId: a.propertyId }));
    expect(board.map((r) => r.id)).toContain(raised.requestId);

    // The hole in the rota is on the record. This is the row a GM's report reads
    // to find out nobody covers the fourth floor after eleven.
    const events = await scoped((tx) => readEventHistory(tx, 'service_request', raised.requestId));
    const unrouted = events.find((e) => e.event_type === 'service_request.unrouted')!;
    expect(unrouted).toBeTruthy();
    expect((unrouted.payload as { reason: string }).reason).toBe('NOBODY_ON_SHIFT');
  });

  it('says when somebody is on shift but nobody holds the role', async () => {
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: deepak, floorIds: [floorId],
    }));

    // A runner on the floor, and a housekeeping request.
    const raised = await raise('ROOM_CLEANING');
    expect(await assigneeOf(raised.requestId)).toBeNull();

    const events = await scoped((tx) => readEventHistory(tx, 'service_request', raised.requestId));
    const unrouted = events.find((e) => e.event_type === 'service_request.unrouted')!;
    const payload = unrouted.payload as { reason: string; onDutyCandidates: number };
    expect(payload.reason).toBe('NOBODY_WITH_ROLE');
    // The distinction matters to a GM: somebody WAS here, just the wrong one.
    expect(Number(payload.onDutyCandidates)).toBe(1);
  });

  it('does not take a request off whoever already claimed it', async () => {
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita, floorIds: [floorId],
    }));

    const raised = await raise('EXTRA_TOWELS');
    // Routed to Sunita, then Ravi picks it up off the board anyway.
    await scoped((tx) => advanceRequest(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, requestId: raised.requestId,
      to: 'IN_PROGRESS', actor: { kind: 'STAFF', staffUserId: ravi }, assignedStaffId: ravi,
    }));

    expect(await assigneeOf(raised.requestId)).toBe(ravi);
  });

  it('does not route to someone who has clocked out', async () => {
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita, floorIds: [floorId],
    }));
    await scoped((tx) => clockOut(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita,
    }));

    // Routing to someone who went home is worse than not routing: the request
    // looks handled and nobody is coming.
    const raised = await raise('EXTRA_TOWELS');
    expect(await assigneeOf(raised.requestId)).toBeNull();
  });

  it('routes a mixed request by the role most of it needs', async () => {
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: sunita, floorIds: [floorId],
    }));
    await scoped((tx) => clockIn(tx, {
      tenantId: a.tenantId, propertyId: a.propertyId, staffUserId: deepak, floorIds: [floorId],
    }));

    const raised = await scoped(async (tx) => {
      const towels = await getRequestTypeByKey(tx, {
        propertyId: a.propertyId, key: 'EXTRA_TOWELS',
      });
      const pillow = await getRequestTypeByKey(tx, {
        propertyId: a.propertyId, key: 'EXTRA_PILLOW',
      });
      const water = await getRequestTypeByKey(tx, {
        propertyId: a.propertyId, key: 'DRINKING_WATER',
      });
      return raiseServiceRequest(tx, {
        tenantId: a.tenantId, propertyId: a.propertyId, stayId, roomId: a.roomId,
        lines: [
          { requestTypeId: towels!.id, quantity: 1 },
          { requestTypeId: pillow!.id, quantity: 1 },
          { requestTypeId: water!.id, quantity: 1 },
        ],
        idempotencyKey: 'mixed-request', accessTier: 'REQUEST',
      });
    });

    // Two housekeeping lines against one runner line. Whoever gets it can raise
    // the other half; splitting one ask into two notifications is worse.
    expect(await assigneeOf(raised.requestId)).toBe(sunita);
  });
});
