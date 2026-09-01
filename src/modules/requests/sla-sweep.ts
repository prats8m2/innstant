import { and, eq, lt, inArray, sql } from 'drizzle-orm';
import { recordEvent, withTenant, slaSweepProperties, type Tx } from '@/db';
import { serviceRequests } from '@/db/schema/requests';
import { queueNotifications } from '@/modules/notifications';
import { logger } from '@/lib/logger';
import { SLA_ACTIVE_STATUSES, type RequestStatus } from './transitions';
import { escalationFor, audienceFor, type EscalationLevel } from './escalation-policy';
import { notifyRequestChanged } from './raise-request';

/**
 * The SLA sweep. The other half of P2's exit criterion — "breaches visibly
 * escalate".
 *
 * ─── What it is not ────────────────────────────────────────────────────────
 *
 * It is not a status change. A breached request is very often IN_PROGRESS —
 * someone IS walking — and turning that into a status would lose the only fact
 * the duty manager needs (DATA-MODEL §6). Escalation moves `escalated_at` and
 * `escalation_level` and leaves the status exactly where it was.
 *
 * ─── Why it can run in-process ─────────────────────────────────────────────
 *
 * The app is a persistent Node process (CLAUDE.md, D-002), so a scheduler here
 * needs no queue, no cron container and no extra dependency. Two things make
 * that safe with more than one replica: an advisory lock, so exactly one
 * instance sweeps at a time, and the level check, so a sweep that runs twice
 * escalates once.
 */

/** One number so two instances contend on the same lock. Arbitrary and fixed. */
const SWEEP_LOCK_KEY = 4_872_301;

export interface SweepResult {
  propertiesChecked: number;
  escalated: number;
  /** False when another instance held the lock — not an error. */
  ran: boolean;
}

export async function sweepSlaBreaches(now: Date = new Date()): Promise<SweepResult> {
  const targets = await slaSweepProperties();
  if (!targets.length) return { propertiesChecked: 0, escalated: 0, ran: true };

  let escalated = 0;
  for (const target of targets) {
    escalated += await withTenant(
      { tenantId: target.tenantId, propertyId: target.propertyId },
      (tx) => escalateBreachesFor(tx, { ...target, now }),
    );
  }

  return { propertiesChecked: targets.length, escalated, ran: true };
}

/**
 * One property's breaches, in one transaction.
 *
 * Per property rather than one transaction for everything: a hotel's escalations
 * should not be held up by, or roll back because of, another hotel's.
 */
export async function escalateBreachesFor(
  tx: Tx,
  input: { tenantId: string; propertyId: string; now: Date },
): Promise<number> {
  const due = await tx.select({
    id: serviceRequests.id,
    requestNumber: serviceRequests.requestNumber,
    status: serviceRequests.status,
    stayId: serviceRequests.stayId,
    floorId: serviceRequests.floorId,
    slaTargetAt: serviceRequests.slaTargetAt,
    escalationLevel: serviceRequests.escalationLevel,
    assignedStaffId: serviceRequests.assignedStaffId,
  }).from(serviceRequests)
    .where(and(
      eq(serviceRequests.propertyId, input.propertyId),
      inArray(serviceRequests.status, [...SLA_ACTIVE_STATUSES]),
      lt(serviceRequests.slaTargetAt, input.now),
      lt(serviceRequests.escalationLevel, 3),
    ));

  let escalated = 0;

  for (const request of due) {
    const decision = escalationFor(
      {
        status: request.status as RequestStatus,
        slaTargetAt: request.slaTargetAt,
        escalationLevel: request.escalationLevel,
      },
      input.now,
    );
    if (!decision.shouldEscalate) continue;

    /**
     * Compare-and-set on the level, not a plain UPDATE.
     *
     * Two instances that both slipped past the advisory lock — a lock that was
     * released early, a clock skew, a manual invocation during a deploy — would
     * otherwise each write level 2 and each send the duty manager a message. The
     * WHERE clause makes the second one a no-op.
     */
    const updated = await tx.update(serviceRequests)
      .set({
        escalationLevel: decision.level,
        escalatedAt: input.now,
        updatedAt: input.now,
      })
      .where(and(
        eq(serviceRequests.id, request.id),
        eq(serviceRequests.escalationLevel, request.escalationLevel),
      ))
      .returning({ id: serviceRequests.id });

    if (!updated[0]) continue;
    escalated += 1;

    await recordEvent(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      entityType: 'service_request',
      entityId: request.id,
      eventType: 'service_request.escalated',
      // The status is unchanged and that is the point — the log should show
      // an escalation against whatever the request was actually doing.
      toStatus: request.status,
      actor: { kind: 'SYSTEM' },
      payload: {
        requestNumber: request.requestNumber,
        level: decision.level,
        minutesLate: decision.minutesLate,
      },
    });

    await queueEscalationNotices(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      requestId: request.id,
      requestNumber: request.requestNumber,
      level: decision.level,
      minutesLate: decision.minutesLate,
      assignedStaffId: request.assignedStaffId,
    });

    // The board hears it the same way it hears everything else, so a breach
    // reddens a card without anyone reloading.
    await notifyRequestChanged(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      requestId: request.id,
      requestNumber: request.requestNumber,
      floorId: request.floorId,
      stayId: request.stayId,
      status: request.status,
    });
  }

  return escalated;
}

/**
 * Who gets told, as rows.
 *
 * `notifications` is the audit of what we TRIED to send (DATA-MODEL §8) — the
 * row is written here and nothing delivers it yet. That is deliberate rather
 * than half-done: the delivery channel is a product decision (in-app, WhatsApp,
 * email) and writing the row now means the sweep is complete and testable, and
 * the day a channel is chosen it drains a table that already has the history in
 * it.
 *
 * The duty manager is whoever holds PROPERTY_ADMIN at this property. That is a
 * stand-in — a hotel with a real rota has a duty manager per shift, and this
 * becomes a lookup against `shifts` when that exists.
 */
async function queueEscalationNotices(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    requestId: string;
    requestNumber: string;
    level: EscalationLevel;
    minutesLate: number;
    assignedStaffId: string | null;
  },
): Promise<void> {
  const audience = audienceFor(input.level);
  const recipients = new Set<string>();

  if (audience.includes('ASSIGNEE') && input.assignedStaffId) {
    recipients.add(input.assignedStaffId);
  }

  if (audience.includes('DUTY_MANAGER')) {
    /**
     * Raw SQL across identity's tables (D-001): a read-only projection inside
     * the tenant-scoped transaction, the same narrow exception the kitchen
     * ticket and the floor board already take. RLS still applies to every row.
     */
    const managers = await tx.execute<{ id: string }>(sql`
      SELECT DISTINCT su.id
      FROM staff_property_roles spr
      JOIN roles r ON r.id = spr.role_id
      JOIN staff_users su ON su.id = spr.staff_user_id
      WHERE spr.property_id = ${input.propertyId}
        AND r.key = 'PROPERTY_ADMIN'
        -- Anyone not disabled, rather than status = ACTIVE. That was the
        -- first version, and it quietly excluded the admin provisionProperty()
        -- creates as INVITED: a brand new property's escalations went to
        -- nobody, with no error to notice. The row is the audit record whether
        -- or not the recipient has logged in yet.
        -- (No backticks in here — this is inside a JS template literal.)
        AND su.status <> 'DISABLED'
    `);
    for (const row of managers.rows) recipients.add(row.id);
  }

  if (!recipients.size) return;

  await queueNotifications(tx, [...recipients].map((recipientStaffId) => ({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    channel: 'IN_APP' as const,
    recipientStaffId,
    entityType: 'service_request',
    entityId: input.requestId,
    template: 'service_request.escalated',
    payload: {
      requestNumber: input.requestNumber,
      level: input.level,
      minutesLate: input.minutesLate,
    },
  })));
}

/* ── The scheduler ──────────────────────────────────────────────────────── */

const SWEEP_INTERVAL_MS = 60_000;
let timer: NodeJS.Timeout | null = null;

/**
 * Start sweeping, once per process.
 *
 * Called from the server lifecycle, not from a route: a sweep triggered by
 * traffic would stop escalating the moment a hotel went quiet, which is exactly
 * when a forgotten request matters most.
 */
export function startSlaSweeper(): void {
  if (timer) return;

  const run = () => {
    void withSweepLock().catch((err) => {
      // A failed sweep must never take the server down. The next one is a
      // minute away, and the requests it missed are still breached.
      logger.error({ err: (err as Error).message }, 'sla sweep failed');
    });
  };

  timer = setInterval(run, SWEEP_INTERVAL_MS);
  // Do not hold the process open for a timer.
  timer.unref?.();

  logger.info({ intervalMs: SWEEP_INTERVAL_MS }, 'sla sweeper started');
}

export function stopSlaSweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * One instance at a time.
 *
 * `pg_try_advisory_lock` returns immediately rather than queueing, so a replica
 * that loses simply skips this minute — there is nothing to wait for, the winner
 * is doing the same work.
 */
async function withSweepLock(): Promise<void> {
  const result = await withTenant({ tenantId: SWEEP_SENTINEL_TENANT }, async (tx) => {
    const got = await tx.execute<{ locked: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}) AS locked`,
    );
    return got.rows[0]?.locked === true;
  });

  if (!result) return;

  const outcome = await sweepSlaBreaches();
  if (outcome.escalated > 0) {
    logger.warn(
      { escalated: outcome.escalated, properties: outcome.propertiesChecked },
      'sla breaches escalated',
    );
  }
}

/**
 * A tenant id for the lock transaction, which touches no tenant data.
 *
 * `withTenant()` is how every connection in this codebase is opened, and taking
 * an advisory lock is not a reason to make an exception — the transaction sets a
 * context it never uses, and the all-zero uuid matches no row anywhere.
 */
const SWEEP_SENTINEL_TENANT = '00000000-0000-0000-0000-000000000000';
