import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { integrationOutbox } from './schema/core';
import type { Tx } from './client';

/**
 * `integration_outbox` — what we still have to tell somebody else.
 *
 * DATA-MODEL §8: "the PMS adapter drains this. A hotel's Opera instance being
 * down must never fail a guest's order. Write the charge to the folio, queue the
 * PMS post, retry with backoff."
 *
 * That sentence is the whole design. The local write is authoritative and
 * committed; the remote is told afterwards, by something that can fail and try
 * again. A row here is written in the SAME transaction as the thing it
 * describes, so there is no window where the folio moved and the queue did not.
 *
 * Lives in `src/db/` beside `recordEvent()` and for the same reason (D-019):
 * `integration_outbox` is owned by no module and written by several, and
 * scoping it to one would mean routing every enqueue through that module's
 * service.
 */

export interface OutboxEntry {
  tenantId: string;
  propertyId: string;
  /** Who has to be told — the adapter kind, e.g. `OPERA`. */
  target: string;
  /** What happened, from the adapter's own typed union. */
  operation: string;
  payload: Record<string, unknown>;
}

/**
 * Queue something, inside the caller's transaction.
 *
 * Takes the tx rather than opening one, exactly like `recordEvent()`: a queued
 * message that survives a rolled-back checkout is a message about something that
 * did not happen.
 */
export async function enqueueOutbox(tx: Tx, entry: OutboxEntry): Promise<string> {
  const [row] = await tx.insert(integrationOutbox).values({
    tenantId: entry.tenantId,
    propertyId: entry.propertyId,
    target: entry.target,
    operation: entry.operation,
    payload: entry.payload,
    status: 'PENDING',
  }).returning({ id: integrationOutbox.id });

  return row!.id;
}

export interface PendingOutboxRow {
  id: string;
  target: string;
  operation: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * The rows due for another attempt, oldest first.
 *
 * Ordered by `created_at` because a PMS receiving "checked out" before "checked
 * in" is worse than receiving both late. Retries preserve that order for the
 * same property, which is what `next_attempt_at` gating plus a batch in
 * insertion order gives.
 */
export async function pendingOutbox(
  tx: Tx,
  input: { propertyId: string; limit?: number; now?: Date },
): Promise<PendingOutboxRow[]> {
  const rows = await tx.select({
    id: integrationOutbox.id,
    target: integrationOutbox.target,
    operation: integrationOutbox.operation,
    payload: integrationOutbox.payload,
    attempts: integrationOutbox.attempts,
  }).from(integrationOutbox)
    .where(and(
      eq(integrationOutbox.propertyId, input.propertyId),
      eq(integrationOutbox.status, 'PENDING'),
      lte(integrationOutbox.nextAttemptAt, input.now ?? new Date()),
    ))
    .orderBy(asc(integrationOutbox.createdAt))
    .limit(input.limit ?? 50);

  return rows.map((row) => ({
    ...row,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));
}

export async function markOutboxDelivered(
  tx: Tx,
  input: { id: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  await tx.update(integrationOutbox)
    .set({
      status: 'DELIVERED',
      deliveredAt: now,
      attempts: sql`${integrationOutbox.attempts} + 1`,
      lastError: null,
    })
    .where(eq(integrationOutbox.id, input.id));
}

/**
 * How long to wait before trying again, and when to stop.
 *
 * Exponential with a ceiling: a PMS that is down for the afternoon should not be
 * hammered, and one that is down for a minute should not delay a checkout by an
 * hour. Pure, so the schedule is a table in a test rather than a guess.
 *
 * Ten attempts is roughly a day at this shape. Past that the row is FAILED and
 * somebody has to look — a message that has been retried for a week is not going
 * to succeed on its own, and a queue that retries for ever hides the outage that
 * caused it.
 */
export const OUTBOX_MAX_ATTEMPTS = 10;

export function outboxBackoffSeconds(attempts: number): number {
  const base = 30 * 2 ** Math.max(0, attempts - 1);
  return Math.min(base, 4 * 60 * 60);
}

export async function markOutboxFailed(
  tx: Tx,
  input: { id: string; attempts: number; error: string; now?: Date },
): Promise<{ status: 'PENDING' | 'FAILED'; nextAttemptAt: Date }> {
  const now = input.now ?? new Date();
  const attempts = input.attempts + 1;
  const exhausted = attempts >= OUTBOX_MAX_ATTEMPTS;
  const nextAttemptAt = new Date(now.getTime() + outboxBackoffSeconds(attempts) * 1000);

  await tx.update(integrationOutbox)
    .set({
      status: exhausted ? 'FAILED' : 'PENDING',
      attempts,
      // Truncated: an adapter that stringifies an entire HTTP response should
      // not be able to fill a column nobody reads past the first line.
      lastError: input.error.slice(0, 500),
      nextAttemptAt,
    })
    .where(eq(integrationOutbox.id, input.id));

  return { status: exhausted ? 'FAILED' : 'PENDING', nextAttemptAt };
}
