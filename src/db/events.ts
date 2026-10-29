import { sql } from 'drizzle-orm';
import type { Tx } from './client';
import { eventLog } from './schema/core';

/**
 * CLAUDE.md #7 — every status change writes an `event_log` row in the SAME
 * transaction. Not after. Not in a hook that might fail independently.
 *
 * D-019 exempts `event_log` from the module boundary, so a module *may* import
 * the table directly. Use this instead. The exemption makes the table
 * reachable; it cannot make the write transactional — that is what taking `tx`
 * as the first argument does. If the surrounding transaction rolls back, so
 * does the event, which is the only way the log stays a truthful record of what
 * actually happened rather than of what was attempted.
 *
 * `event_log` has UPDATE and DELETE revoked from app_user (0001_rls.sql), so
 * there is no correcting a row later. Write it right or not at all.
 */
export interface EventInput {
  tenantId: string;
  propertyId?: string;

  /** The aggregate: 'order', 'service_request', 'stay', 'checkout_request'. */
  entityType: string;
  entityId: string;

  /** The transition, not a note: 'order.accepted', 'stay.checked_out'. */
  eventType: string;
  fromStatus?: string | null;
  toStatus?: string | null;

  actor?:
    | { kind: 'STAFF'; staffUserId: string }
    /** A guest SESSION — a context. Where somebody is ordering from. */
    | { kind: 'GUEST'; guestSessionId: string }
    /**
     * A signed-in CUSTOMER — an identity (D-081). Deliberately not 'GUEST':
     * that kind means a context session, and conflating the two in the audit
     * trail would make "who did this" unanswerable for exactly the actions
     * an account can take.
     */
    | { kind: 'CUSTOMER'; guestId: string }
    | { kind: 'SYSTEM' };

  /** Anything needed to explain the row later. Keep it small and factual —
   *  this is dispute evidence, not a debug dump. */
  payload?: Record<string, unknown>;
}

export async function recordEvent(tx: Tx, input: EventInput): Promise<void> {
  const actor = input.actor ?? { kind: 'SYSTEM' as const };

  await tx.insert(eventLog).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId ?? null,
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: input.eventType,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    actorKind: actor.kind,
    actorStaffId: actor.kind === 'STAFF' ? actor.staffUserId : null,
    actorGuestSessionId: actor.kind === 'GUEST' ? actor.guestSessionId : null,
    actorGuestId: actor.kind === 'CUSTOMER' ? actor.guestId : null,
    payload: input.payload ?? {},
  });
}

/**
 * Read an aggregate's history, oldest first. Backs the guest's order timeline,
 * the SLA dashboard, and the answer to "nobody ever came to my room".
 */
export async function readEventHistory(
  tx: Tx,
  entityType: string,
  entityId: string,
): Promise<Array<Record<string, unknown>>> {
  const rows = await tx.execute(sql`
    SELECT event_type, from_status, to_status, actor_kind, payload, occurred_at
    FROM ${eventLog}
    WHERE entity_type = ${entityType} AND entity_id = ${entityId}
    ORDER BY occurred_at ASC
  `);
  return rows.rows as Array<Record<string, unknown>>;
}

export interface ActorEvent {
  eventType: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
}

/**
 * What one member of staff did here, newest first. Backs the Staff screen's
 * "Recent activity" (D-088). The (actor_staff_id, occurred_at) index from
 * migration 0013 is what makes this a lookup rather than a scan of the
 * property's whole history.
 *
 * Sign-ins are left out: they are most of the rows and none of the work.
 */
export async function readStaffActivity(
  tx: Tx,
  input: { propertyId: string; staffUserId: string; limit?: number },
): Promise<ActorEvent[]> {
  const rows = await tx.execute<{
    event_type: string; entity_type: string; entity_id: string;
    payload: Record<string, unknown> | null; occurred_at: string | Date;
  }>(sql`
    SELECT event_type, entity_type, entity_id, payload, occurred_at
    FROM ${eventLog}
    WHERE actor_staff_id = ${input.staffUserId}
      AND property_id = ${input.propertyId}
      AND event_type <> 'staff.logged_in'
    ORDER BY occurred_at DESC
    LIMIT ${input.limit ?? 20}
  `);
  return rows.rows.map((row) => ({
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: row.payload ?? {},
    occurredAt: new Date(row.occurred_at),
  }));
}
