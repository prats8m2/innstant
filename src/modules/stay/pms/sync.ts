import { withTenant, enqueueOutbox, pendingOutbox, markOutboxDelivered, markOutboxFailed, type Tx } from '@/db';
import { logger } from '@/lib/logger';
import { pmsAdapterFor } from './index';
import type { PmsAdapter, PmsEvent } from './types';

/**
 * The two ends of the seam: enqueue what happened, and later hand it to the
 * adapter.
 *
 * Nothing between them runs inside a request. `notifyPms()` writes one row in
 * the caller's transaction; `drainPmsOutbox()` is where the network call
 * happens, and it can fail all it likes.
 */

/**
 * Queue a stay change for this property's system of record — if it has one.
 *
 * The `deliversOutbound` check is the whole reason `ManualAdapter` exists. A
 * hotel whose front desk IS this product has nowhere to push to, so nothing is
 * written: the outbox stays empty rather than collecting a row per folio line
 * for a queue with no consumer. The day a property runs Opera,
 * `pmsAdapterFor()` returns an adapter that says true and these same call sites
 * start filling it, unedited.
 *
 * In the caller's transaction, always. A queued "checked out" that survives a
 * rolled-back checkout is a message about something that did not happen.
 */
export async function notifyPms(
  tx: Tx,
  input: { tenantId: string; propertyId: string; event: PmsEvent },
): Promise<string | null> {
  const adapter = pmsAdapterFor({ propertyId: input.propertyId });
  if (!adapter.deliversOutbound) return null;

  return enqueueOutbox(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    target: adapter.kind,
    operation: input.event.kind,
    payload: input.event as unknown as Record<string, unknown>,
  });
}

export interface DrainResult {
  attempted: number;
  delivered: number;
  failed: number;
  /** Rows that have now exhausted their attempts and need a human. */
  exhausted: number;
}

/**
 * Hand this property's pending rows to its adapter.
 *
 * ─── Why each row gets its own transaction ─────────────────────────────────
 *
 * The adapter call is a network call. Holding one transaction open across a
 * batch of them would keep a connection busy for as long as the slowest PMS
 * takes, and a failure in row seven would roll back the six deliveries already
 * confirmed — telling the PMS twice on the next pass. One row, one commit.
 *
 * ─── Why it stops at the first failure ─────────────────────────────────────
 *
 * Order matters to a PMS: "checked out" arriving before "checked in" is worse
 * than both arriving late. Rows are drained oldest first, and a failure ends the
 * pass so the next one starts from the same row rather than stepping over it.
 * A PMS that is down fails the first row and nothing behind it is reordered.
 *
 * ─── Why there is no timer ─────────────────────────────────────────────────
 *
 * `ManualAdapter` never enqueues, so on every property that exists today this
 * queue is empty by construction. A 60-second sweep over an empty table — plus
 * the third SECURITY DEFINER function it would need to find work without a
 * request to derive a tenant from (D-028) — is machinery for a consumer that
 * does not exist yet. This function is callable, tested, and takes its property
 * from the caller; the timer is twenty lines on the day a real PMS lands, and
 * that is the day it is justified.
 */
export async function drainPmsOutbox(input: {
  tenantId: string;
  propertyId: string;
  adapter?: PmsAdapter;
  limit?: number;
  now?: Date;
}): Promise<DrainResult> {
  const adapter = input.adapter ?? pmsAdapterFor({ propertyId: input.propertyId });

  const due = await withTenant(
    { tenantId: input.tenantId, propertyId: input.propertyId },
    (tx) => pendingOutbox(tx, {
      propertyId: input.propertyId, limit: input.limit, now: input.now,
    }),
  );

  const result: DrainResult = { attempted: 0, delivered: 0, failed: 0, exhausted: 0 };

  for (const row of due) {
    result.attempted += 1;
    try {
      await adapter.deliver(row.payload as unknown as PmsEvent);
      await withTenant(
        { tenantId: input.tenantId, propertyId: input.propertyId },
        (tx) => markOutboxDelivered(tx, { id: row.id, now: input.now }),
      );
      result.delivered += 1;
    } catch (error) {
      const message = (error as Error).message;
      const outcome = await withTenant(
        { tenantId: input.tenantId, propertyId: input.propertyId },
        (tx) => markOutboxFailed(tx, {
          id: row.id, attempts: row.attempts, error: message, now: input.now,
        }),
      );

      result.failed += 1;
      if (outcome.status === 'FAILED') result.exhausted += 1;

      logger.warn(
        {
          outboxId: row.id,
          operation: row.operation,
          attempts: row.attempts + 1,
          status: outcome.status,
          err: message,
        },
        'pms delivery failed',
      );

      // Ordered delivery: the next pass starts here rather than stepping over it.
      break;
    }
  }

  return result;
}
