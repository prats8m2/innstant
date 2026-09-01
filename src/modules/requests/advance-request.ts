import { and, eq, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { serviceRequests } from '@/db/schema/requests';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { CurrencyCode } from '@/lib/money';
import {
  canTransition, isTerminal, reasonRequiredFor, slaState,
  REQUEST_STATUS_TIMESTAMP, OPEN_REQUEST_STATUSES, type RequestStatus,
} from './transitions';
import { notifyRequestChanged } from './raise-request';

/**
 * Moving a request through the machine.
 *
 * The same shape as `advanceOrder()` — one function, compare-and-set, event in
 * the same transaction, notify inside it — because the reasons are identical:
 * two phones on a floor tapping the same request is not hypothetical, and a
 * read-then-write races.
 *
 * What is NOT here: escalation. A breach is not a transition (DATA-MODEL §6);
 * it is `escalated_at` moving while the status stays exactly where it was.
 */

export interface AdvanceRequestInput {
  tenantId: string;
  propertyId: string;
  requestId: string;
  to: RequestStatus;
  actor:
    | { kind: 'STAFF'; staffUserId: string }
    | { kind: 'GUEST'; guestSessionId: string }
    | { kind: 'SYSTEM' };
  reason?: string | null;
  /** Set when someone takes it on. Cleared by handing it back to OPEN. */
  assignedStaffId?: string | null;
}

export interface AdvancedRequest {
  requestId: string;
  requestNumber: string;
  from: RequestStatus;
  to: RequestStatus;
}

export async function advanceRequest(
  tx: Tx,
  input: AdvanceRequestInput,
): Promise<AdvancedRequest> {
  const current = await tx.select({
    id: serviceRequests.id,
    requestNumber: serviceRequests.requestNumber,
    status: serviceRequests.status,
    floorId: serviceRequests.floorId,
    stayId: serviceRequests.stayId,
    assignedStaffId: serviceRequests.assignedStaffId,
  }).from(serviceRequests)
    .where(and(
      eq(serviceRequests.id, input.requestId),
      eq(serviceRequests.propertyId, input.propertyId),
    ))
    .limit(1);

  const request = current[0];
  if (!request) throw new NotFoundError('That request is not at this property.');

  const from = request.status as RequestStatus;

  if (from === input.to) {
    // Two taps on the same button. The second wanted the state it already has.
    return { requestId: request.id, requestNumber: request.requestNumber, from, to: input.to };
  }

  if (!canTransition(from, input.to)) {
    throw new ConflictError(
      isTerminal(from)
        ? `${request.requestNumber} is already ${from.toLowerCase().replace(/_/g, ' ')}.`
        : `${request.requestNumber} cannot go from ${from} to ${input.to}.`,
    );
  }

  const reasonKind = reasonRequiredFor(input.to);
  const reason = input.reason?.trim() || null;
  if (reasonKind && !reason) {
    throw new ValidationError(
      reasonKind === 'rejection'
        ? 'Say why this cannot be done — the guest is told.'
        : 'Say why this is being cancelled.',
    );
  }

  const now = new Date();
  const stampColumn = REQUEST_STATUS_TIMESTAMP[input.to];

  /**
   * Handing a request back clears the assignee.
   *
   * Otherwise the board shows an OPEN request with somebody's name on it, and
   * the next person to look assumes it is covered.
   */
  const assignment = input.to === 'OPEN'
    ? { assignedStaffId: null, assignedAt: null }
    : input.assignedStaffId !== undefined
      ? { assignedStaffId: input.assignedStaffId, assignedAt: input.assignedStaffId ? now : null }
      : {};

  const updated = await tx.update(serviceRequests)
    .set({
      status: input.to,
      updatedAt: now,
      ...(stampColumn ? { [stampColumn]: now } : {}),
      ...(reasonKind === 'rejection' ? { rejectionReason: reason } : {}),
      ...(reasonKind === 'cancellation' ? { cancellationReason: reason } : {}),
      ...assignment,
    })
    .where(and(
      eq(serviceRequests.id, input.requestId),
      // The compare-and-set. Two phones on one floor, same request, same second.
      eq(serviceRequests.status, from),
    ))
    .returning({ id: serviceRequests.id });

  if (!updated[0]) {
    const after = await tx.select({ status: serviceRequests.status })
      .from(serviceRequests).where(eq(serviceRequests.id, input.requestId)).limit(1);

    // The loser got the state it wanted: a no-op, not a conflict. Telling two
    // housekeepers off for agreeing is noise.
    if (after[0]?.status === input.to) {
      return { requestId: request.id, requestNumber: request.requestNumber, from, to: input.to };
    }
    throw new ConflictError(
      `${request.requestNumber} was just changed by someone else. Look at it again.`,
    );
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'service_request',
    entityId: request.id,
    eventType: `service_request.${input.to.toLowerCase()}`,
    fromStatus: from,
    toStatus: input.to,
    actor: input.actor,
    payload: {
      requestNumber: request.requestNumber,
      ...(reason ? { reason } : {}),
      ...(input.assignedStaffId ? { assignedStaffId: input.assignedStaffId } : {}),
    },
  });

  await notifyRequestChanged(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    requestId: request.id,
    requestNumber: request.requestNumber,
    floorId: request.floorId,
    stayId: request.stayId,
    status: input.to,
  });

  return { requestId: request.id, requestNumber: request.requestNumber, from, to: input.to };
}

/* ── Reads ──────────────────────────────────────────────────────────────── */

export interface RequestLine {
  label: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

export interface RequestDetail {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  roomNumber: string;
  floorId: string;
  guestNote: string | null;
  photoUrl: string | null;
  totalMinor: number;
  currency: CurrencyCode;
  slaTargetAt: Date | null;
  escalatedAt: Date | null;
  escalationLevel: number;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  createdAt: Date;
  completedAt: Date | null;
  rejectionReason: string | null;
  cancellationReason: string | null;
  lines: RequestLine[];
  /** Computed, never stored: a breach is a function of the clock. */
  breached: boolean;
  secondsRemaining: number | null;
}

/**
 * The requests a guest can see — theirs, newest first.
 *
 * Scoped by stay, not just by property: a request id in a URL must not resolve
 * to the room next door's leaking tap.
 */
export async function getRequestsForStay(
  tx: Tx,
  input: { stayId: string; now?: Date },
): Promise<RequestDetail[]> {
  return readRequests(tx, {
    where: sql`sr.stay_id = ${input.stayId}`,
    now: input.now ?? new Date(),
  });
}

/** One request, scoped by stay. A 404 rather than someone else's. */
export async function getRequestForStay(
  tx: Tx,
  input: { stayId: string; requestId: string; now?: Date },
): Promise<RequestDetail | null> {
  const rows = await readRequests(tx, {
    where: sql`sr.stay_id = ${input.stayId} AND sr.id = ${input.requestId}`,
    now: input.now ?? new Date(),
  });
  return rows[0] ?? null;
}

/**
 * The staff board: everything not finished with, most urgent first.
 *
 * Ordered by SLA target rather than by age — a wake-up call raised five minutes
 * ago is more urgent than towels raised twenty minutes ago, and a board sorted
 * by age hides that.
 */
export async function getOpenRequests(
  tx: Tx,
  input: { propertyId: string; statuses?: readonly RequestStatus[]; now?: Date },
): Promise<RequestDetail[]> {
  const statuses = input.statuses ?? OPEN_REQUEST_STATUSES;

  return readRequests(tx, {
    where: sql`sr.property_id = ${input.propertyId}
      AND sr.status IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})`,
    orderBySla: true,
    now: input.now ?? new Date(),
  });
}

async function readRequests(
  tx: Tx,
  input: {
    /**
     * A raw `sql` fragment against the `sr` alias, NOT a drizzle `eq()`.
     *
     * Drizzle renders a column reference as `"service_requests"."stay_id"`,
     * which does not resolve against an aliased FROM — Postgres says
     * `42P01 … perhaps you meant the table alias "sr"`, which reads like a typo
     * in the join rather than what it is.
     */
    where: ReturnType<typeof sql>;
    orderBySla?: boolean;
    now: Date;
  },
): Promise<RequestDetail[]> {
  /**
   * Raw SQL for the joins onto `rooms`, `stays` and `staff_users`: those belong
   * to other modules and this one may not import their tables (D-001). A
   * read-only projection inside the tenant-scoped transaction is the narrow
   * exception the ordering module already takes for the kitchen ticket, and RLS
   * still applies to every row.
   */
  const rows = await tx.execute<{
    id: string; request_number: string; status: RequestStatus; room_number: string;
    floor_id: string; guest_note: string | null; photo_url: string | null;
    total_minor: number; currency: string; sla_target_at: Date | null;
    escalated_at: Date | null; escalation_level: number;
    assigned_staff_id: string | null; assigned_staff_name: string | null;
    created_at: Date; completed_at: Date | null;
    rejection_reason: string | null; cancellation_reason: string | null;
    lines: unknown;
  }>(sql`
    SELECT
      sr.id, sr.request_number, sr.status, r.number AS room_number, sr.floor_id,
      sr.guest_note, sr.photo_url, sr.total_minor, sr.currency,
      sr.sla_target_at, sr.escalated_at, sr.escalation_level,
      sr.assigned_staff_id, su.full_name AS assigned_staff_name,
      sr.created_at, sr.completed_at, sr.rejection_reason, sr.cancellation_reason,
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
           'label', i.label_snapshot,
           'quantity', i.quantity,
           'unitPriceMinor', i.unit_price_minor,
           'lineTotalMinor', i.line_total_minor
         ) ORDER BY i.created_at)
         FROM service_request_items i WHERE i.service_request_id = sr.id),
        '[]'::jsonb) AS lines
    FROM service_requests sr
    JOIN stays s      ON s.id = sr.stay_id
    JOIN rooms r      ON r.id = s.room_id
    LEFT JOIN staff_users su ON su.id = sr.assigned_staff_id
    WHERE ${input.where}
    ORDER BY ${input.orderBySla
      ? sql`sr.sla_target_at ASC NULLS LAST`
      : sql`sr.created_at DESC`}
  `);

  return rows.rows.map((row) => {
    const status = row.status;
    const sla = slaState(
      {
        status,
        slaTargetAt: row.sla_target_at ? new Date(row.sla_target_at) : null,
        completedAt: row.completed_at ? new Date(row.completed_at) : null,
      },
      input.now,
    );

    return {
      id: row.id,
      requestNumber: row.request_number,
      status,
      roomNumber: row.room_number,
      floorId: row.floor_id,
      guestNote: row.guest_note,
      photoUrl: row.photo_url,
      totalMinor: row.total_minor,
      currency: row.currency as CurrencyCode,
      slaTargetAt: row.sla_target_at ? new Date(row.sla_target_at) : null,
      escalatedAt: row.escalated_at ? new Date(row.escalated_at) : null,
      escalationLevel: row.escalation_level,
      assignedStaffId: row.assigned_staff_id,
      assignedStaffName: row.assigned_staff_name,
      createdAt: new Date(row.created_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      rejectionReason: row.rejection_reason,
      cancellationReason: row.cancellation_reason,
      lines: (row.lines as RequestLine[]) ?? [],
      breached: sla.breached,
      secondsRemaining: sla.secondsRemaining,
    };
  });
}
