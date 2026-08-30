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
    | { kind: 'GUEST'; guestSessionId: string }
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
