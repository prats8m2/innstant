import { and, eq, inArray, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { serviceRequests, serviceRequestItems, requestTypes } from '@/db/schema/requests';
import { onDutyCovering } from '@/modules/housekeeping';
import { OPEN_REQUEST_STATUSES } from './transitions';
import { pickAssignee } from './assignment';
import { advanceRequest } from './advance-request';

/**
 * Auto-routing. DATA-MODEL §7, and the whole of P2's exit criterion:
 *
 *   "a request raised by a guest reaches the correct on-duty staff member's
 *    phone without anyone assigning it"
 *
 * The rule is role ∩ on-shift ∩ covers-this-floor, ranked by open count. Each
 * term is there because of a specific way a hotel breaks:
 *
 *   **role** — a runner cannot fix a tap and a housekeeper does not carry
 *   luggage. `request_types.route_to_role_key` is the property's own answer to
 *   which is which.
 *
 *   **on-shift** — routing to someone who went home four hours ago is worse
 *   than not routing at all: the request looks handled and nobody is coming.
 *
 *   **covers this floor** — a hotel with a housekeeper per wing does not want
 *   the second-floor person walking to the fourth.
 *
 *   **ranked by open count** — otherwise the first name alphabetically does
 *   every job on a busy evening.
 *
 * ─── What happens when nobody matches ──────────────────────────────────────
 *
 * The request stays OPEN and an event says why. It does NOT fail: a guest asking
 * for towels at 4am must still be asking for towels at 4am, and the board is the
 * fallback that always works. The unrouted event is what tells a GM their rota
 * has a hole — which is a management problem, and one worth surfacing rather
 * than papering over by assigning to whoever is nearest to hand.
 */

export interface RoutingOutcome {
  assignedStaffId: string | null;
  /** Why nobody got it, when nobody did. Shown to nobody; logged and evented. */
  reason: 'ASSIGNED' | 'NOBODY_ON_SHIFT' | 'NOBODY_WITH_ROLE' | 'ALREADY_ASSIGNED';
  candidates: number;
}

/**
 * Route one request, in the caller's transaction.
 *
 * Called from `raiseServiceRequest()` so a guest's request is assigned before the
 * transaction commits — the board and the assignee's phone hear about it once,
 * already assigned, rather than seeing it appear unowned and then jump.
 */
export async function routeServiceRequest(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    requestId: string;
  },
): Promise<RoutingOutcome> {
  const rows = await tx.select({
    status: serviceRequests.status,
    floorId: serviceRequests.floorId,
    assignedStaffId: serviceRequests.assignedStaffId,
  }).from(serviceRequests)
    .where(and(
      eq(serviceRequests.id, input.requestId),
      eq(serviceRequests.propertyId, input.propertyId),
    ))
    .limit(1);

  const request = rows[0];
  if (!request) return { assignedStaffId: null, reason: 'NOBODY_ON_SHIFT', candidates: 0 };

  // Someone already has it — a manual claim beat the routing, which is fine.
  if (request.assignedStaffId) {
    return {
      assignedStaffId: request.assignedStaffId,
      reason: 'ALREADY_ASSIGNED',
      candidates: 0,
    };
  }

  const roleKey = await routeToRoleFor(tx, input.requestId);
  const onDuty = await onDutyCovering(tx, {
    propertyId: input.propertyId,
    floorId: request.floorId,
  });

  if (!onDuty.length) {
    await recordUnrouted(tx, input, 'NOBODY_ON_SHIFT', roleKey, 0);
    return { assignedStaffId: null, reason: 'NOBODY_ON_SHIFT', candidates: 0 };
  }

  const withRole = onDuty.filter((person) => person.roleKeys.includes(roleKey));
  if (!withRole.length) {
    await recordUnrouted(tx, input, 'NOBODY_WITH_ROLE', roleKey, onDuty.length);
    return { assignedStaffId: null, reason: 'NOBODY_WITH_ROLE', candidates: onDuty.length };
  }

  const openCounts = await openCountsFor(tx, {
    propertyId: input.propertyId,
    staffUserIds: withRole.map((person) => person.staffUserId),
  });

  const chosen = pickAssignee(withRole, openCounts);
  if (!chosen) {
    await recordUnrouted(tx, input, 'NOBODY_WITH_ROLE', roleKey, onDuty.length);
    return { assignedStaffId: null, reason: 'NOBODY_WITH_ROLE', candidates: onDuty.length };
  }

  /**
   * Through the state machine, not a direct UPDATE.
   *
   * The transition writes the event, stamps `assigned_at` and fires the NOTIFY —
   * and the actor is SYSTEM, which is the honest answer to "who assigned this"
   * and the thing that makes an auto-routed request distinguishable from a
   * claimed one in the log.
   */
  await advanceRequest(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    requestId: input.requestId,
    to: 'ASSIGNED',
    actor: { kind: 'SYSTEM' },
    assignedStaffId: chosen.staffUserId,
  });

  return {
    assignedStaffId: chosen.staffUserId,
    reason: 'ASSIGNED',
    candidates: withRole.length,
  };
}

/**
 * Which role this request needs.
 *
 * The role most of its lines want, ties going to the first line. A request that
 * mixes "towels" and "the tap is dripping" has to go to one person first, and
 * whoever gets it can raise the other half — splitting a request into two is a
 * decision for when someone actually asks for it, and guessing now would mean a
 * guest getting two notifications for one ask.
 */
async function routeToRoleFor(tx: Tx, requestId: string): Promise<string> {
  const rows = await tx.select({
    roleKey: requestTypes.routeToRoleKey,
    createdAt: serviceRequestItems.createdAt,
  }).from(serviceRequestItems)
    .innerJoin(requestTypes, eq(requestTypes.id, serviceRequestItems.requestTypeId))
    .where(eq(serviceRequestItems.serviceRequestId, requestId))
    .orderBy(serviceRequestItems.createdAt);

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.roleKey, (counts.get(row.roleKey) ?? 0) + 1);
  }

  let best = rows[0]?.roleKey ?? 'HOUSEKEEPING';
  let bestCount = 0;
  for (const row of rows) {
    const count = counts.get(row.roleKey) ?? 0;
    if (count > bestCount) {
      best = row.roleKey;
      bestCount = count;
    }
  }
  return best;
}

/** How much each candidate is already carrying. One grouped query, not one each. */
async function openCountsFor(
  tx: Tx,
  input: { propertyId: string; staffUserIds: readonly string[] },
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!input.staffUserIds.length) return counts;

  const rows = await tx.select({
    staffUserId: serviceRequests.assignedStaffId,
    n: sql<number>`count(*)::int`,
  }).from(serviceRequests)
    .where(and(
      eq(serviceRequests.propertyId, input.propertyId),
      inArray(serviceRequests.assignedStaffId, [...input.staffUserIds]),
      inArray(serviceRequests.status, [...OPEN_REQUEST_STATUSES]),
    ))
    .groupBy(serviceRequests.assignedStaffId);

  for (const row of rows) {
    if (row.staffUserId) counts.set(row.staffUserId, Number(row.n));
  }
  return counts;
}

/**
 * A hole in the rota, on the record.
 *
 * Not an error and not a notification — the request is still on the board and
 * still visible. This is the row a GM's weekly report reads to find out that
 * nobody covers the fourth floor after eleven.
 */
async function recordUnrouted(
  tx: Tx,
  input: { tenantId: string; propertyId: string; requestId: string },
  reason: RoutingOutcome['reason'],
  roleKey: string,
  onDutyCandidates: number,
): Promise<void> {
  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'service_request',
    entityId: input.requestId,
    eventType: 'service_request.unrouted',
    actor: { kind: 'SYSTEM' },
    payload: { reason, roleKey, onDutyCandidates },
  });
}
