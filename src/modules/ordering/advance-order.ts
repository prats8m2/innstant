import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { recordEvent } from '@/db';
import { orders } from '@/db/schema/ordering';
import { reverseFolioLinesForSource } from '@/modules/billing';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  canTransition, isTerminal, reasonRequiredFor, STATUS_TIMESTAMP,
  KITCHEN_OPEN_STATUSES, RUNNER_OPEN_STATUSES, type OrderStatus,
} from './transitions';
import {
  toKitchenTicket, byRunnerPriority, type KitchenTicket, type Timestamp,
} from './kitchen-ticket';

export type { KitchenTicket };
export { toKitchenTicket, byRunnerPriority };

/**
 * Moving an order through the machine.
 *
 * One function, not `acceptOrder` / `bumpOrder` / `rejectOrder`. Every
 * transition needs the same four things — a legality check, the status, its
 * timestamp column and an `event_log` row in the same transaction (#7) — and
 * three near-identical functions is three places to forget the fourth.
 *
 * The status is read and written in ONE statement with the old status in the
 * WHERE clause. Two tablets in a kitchen both tapping "Preparing" on the same
 * ticket is not hypothetical; a read-then-write races, and the loser silently
 * overwrites the winner's timestamp.
 */

export interface AdvanceOrderInput {
  tenantId: string;
  propertyId: string;
  orderId: string;
  to: OrderStatus;
  actor:
    | { kind: 'STAFF'; staffUserId: string }
    | { kind: 'GUEST'; guestSessionId: string }
    | { kind: 'SYSTEM' };
  /** Required for REJECTED and CANCELLED — see reasonRequiredFor(). */
  reason?: string | null;
  /** Set when a runner picks the tray up. */
  assignedRunnerId?: string | null;
}

export interface AdvancedOrder {
  orderId: string;
  orderNumber: string;
  from: OrderStatus;
  to: OrderStatus;
}

export async function advanceOrder(
  tx: Tx,
  input: AdvanceOrderInput,
): Promise<AdvancedOrder> {
  const current = await tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      outletId: orders.outletId,
      stayId: orders.stayId,
      visitId: orders.visitId,
    })
    .from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.propertyId, input.propertyId)))
    .limit(1);

  const order = current[0];
  // RLS confines this to the tenant; the property check confines it to the
  // hotel. An order id from a sister property is a typo, not a 403.
  if (!order) throw new NotFoundError('That order is not at this property.');

  const from = order.status as OrderStatus;

  if (from === input.to) {
    // Two taps on the same button. Not an error — the second tap wanted the
    // state it already has, and telling a busy kitchen off for it is noise.
    return { orderId: order.id, orderNumber: order.orderNumber, from, to: input.to };
  }

  if (!canTransition(from, input.to)) {
    throw new ConflictError(
      isTerminal(from)
        ? `${order.orderNumber} is already ${from.toLowerCase().replace(/_/g, ' ')}.`
        : `${order.orderNumber} cannot go from ${from} to ${input.to}.`,
    );
  }

  const reasonKind = reasonRequiredFor(input.to);
  const reason = input.reason?.trim() || null;
  if (reasonKind && !reason) {
    throw new ValidationError(
      reasonKind === 'rejection'
        ? 'Say why the kitchen cannot make this — the guest is told.'
        : 'Say why this is being cancelled.',
    );
  }

  const now = new Date();
  const stampColumn = STATUS_TIMESTAMP[input.to];

  const updated = await tx
    .update(orders)
    .set({
      status: input.to,
      updatedAt: now,
      ...(stampColumn ? { [stampColumn]: now } : {}),
      ...(reasonKind === 'rejection' ? { rejectionReason: reason } : {}),
      ...(reasonKind === 'cancellation' ? { cancellationReason: reason } : {}),
      ...(input.assignedRunnerId !== undefined
        ? { assignedRunnerId: input.assignedRunnerId }
        : {}),
    })
    .where(and(
      eq(orders.id, input.orderId),
      // The compare-and-set. Without it, two tablets bumping the same ticket
      // both succeed and the second overwrites the first's timestamp.
      eq(orders.status, from),
    ))
    .returning({ id: orders.id });

  if (!updated[0]) {
    /**
     * The compare-and-set lost. Someone else moved this row between the read
     * above and the update.
     *
     * Who won decides what to say. Two cooks tapping "Preparing" on the same
     * ticket is the common case, and the loser got the state it wanted — that
     * is a no-op, not a conflict, and refusing it makes a busy kitchen tap
     * again for no reason. Only a genuine divergence is worth interrupting for.
     */
    const now = await tx.select({ status: orders.status }).from(orders)
      .where(eq(orders.id, input.orderId)).limit(1);

    if (now[0]?.status === input.to) {
      return { orderId: order.id, orderNumber: order.orderNumber, from, to: input.to };
    }
    throw new ConflictError(
      `${order.orderNumber} was just changed by someone else. Check the ticket again.`,
    );
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'order',
    entityId: order.id,
    eventType: `order.${input.to.toLowerCase()}`,
    fromStatus: from,
    toStatus: input.to,
    actor: input.actor,
    payload: {
      orderNumber: order.orderNumber,
      ...(reason ? { reason } : {}),
    },
  });

  /**
   * A rejection takes its own charge back off the folio.
   *
   * `placeOrder()` posts the folio line at placement, so "Charged to room 214"
   * is true the moment the guest presses Send. The other half of that promise
   * has to live here: an order the kitchen cannot make must not leave a line
   * behind for a guest to notice at checkout and a desk to argue about.
   *
   * In the SAME transaction as the status change and the event (#7). Not in a
   * hook, not after the await — a credit that can fail independently of the
   * rejection that caused it is the one failure mode nobody would find until a
   * guest read their bill.
   *
   * Idempotency (#8) comes from two places at once: the compare-and-set above
   * means this line is reached exactly once per real transition, and
   * `reverseFolioLinesForSource()` nets against what is already posted, so even
   * a second call credits nothing.
   */
  //
  // D-079 — and only for an order that was charged to a room. A VISIT order
  // never posted a folio line (there is no folio: a restaurant customer pays at
  // the counter or at the door), so there is nothing to credit back. Refunding
  // money that was never posted is the one way this could be worse than doing
  // nothing.
  if ((input.to === 'REJECTED' || input.to === 'CANCELLED') && order.stayId) {
    const reversal = await reverseFolioLinesForSource(tx, {
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      stayId: order.stayId,
      sourceRefId: order.id,
      // What the guest reads on the bill, next to the charge it cancels.
      description: `Reversed · ${order.orderNumber} ${
        input.to === 'REJECTED' ? 'not made' : 'cancelled'
      }`,
      reversedByStaffId: input.actor.kind === 'STAFF' ? input.actor.staffUserId : null,
    });

    if (reversal) {
      // The money moved, so it is in the log too — the audit trail has to
      // answer "who credited this, and when" without joining to a screen.
      await recordEvent(tx, {
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        entityType: 'order',
        entityId: order.id,
        eventType: 'order.charge_reversed',
        actor: input.actor,
        payload: {
          orderNumber: order.orderNumber,
          folioLineId: reversal.folioLineId,
          amountMinor: reversal.amountMinor,
          currency: reversal.currency,
        },
      });
    }
  }

  await notifyOrderChanged(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: order.outletId,
    orderId: order.id,
    orderNumber: order.orderNumber,
    stayId: order.stayId,
    visitId: order.visitId,
    status: input.to,
  });

  return { orderId: order.id, orderNumber: order.orderNumber, from, to: input.to };
}

/**
 * Tell every listening process that this order moved.
 *
 * `pg_notify` inside the transaction, which is the whole reason to use it:
 * Postgres holds notifications until COMMIT, so a screen can never be told
 * about a transition that then rolls back. An out-of-band publish — Redis, a
 * queue, a callback after the await — cannot make that promise.
 *
 * The payload carries ROUTING and STATUS only, never money or a guest name.
 * It crosses to every process listening on this database, and the receiving
 * screen re-reads what it is allowed to see through RLS.
 *
 * The 8000-byte NOTIFY limit is not a concern at this size, and would be the
 * first thing to break if someone put a whole order in here.
 */
export const ORDER_CHANNEL = 'order_changed';

export interface OrderChangedPayload {
  tenantId: string;
  propertyId: string;
  outletId: string;
  orderId: string;
  orderNumber: string;
  /** D-079 — exactly one of these, matching the order's own context. The
   *  listener filters on whichever one its screen is bound to. */
  stayId: string | null;
  visitId: string | null;
  status: OrderStatus;
}

export async function notifyOrderChanged(
  tx: Tx,
  payload: OrderChangedPayload,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_notify(${ORDER_CHANNEL}, ${JSON.stringify(payload)})`,
  );
}

/* ── Reads for the kitchen and the floor ─────────────────────────────────── */


/**
 * The KDS rail: open tickets for an outlet, oldest first.
 *
 * Oldest first is not a preference. A kitchen display sorted newest-first
 * starves the ticket that has been waiting longest, which is precisely the one
 * the guest is about to ring about.
 *
 * Everything shown comes from the order's SNAPSHOT columns (#6) — the ticket a
 * cook is reading must not change because someone edited the menu mid-service.
 *
 * ─── D-079: the room join became a LEFT JOIN, and stopped being the label ──
 *
 * This reached orders → stays → rooms with an INNER join, purely to print a
 * room number. An inner join does not survive property links: a restaurant's
 * rail is full of orders with no stay, and every one of them would have
 * vanished from the kitchen display — the worst available failure, because the
 * food is still ordered and the guest is still waiting.
 *
 * Two things changed, and they are separate:
 *
 *   · What a cook READS is `destination_label`, a snapshot on the order
 *     itself. It covers all four fulfilments, and because it is frozen at
 *     placement a reassigned room or a renamed table tent cannot move a tray
 *     that is already cooking (#6 applied to the destination).
 *   · `room_number` survives as a NULLABLE field, because the front desk's
 *     board genuinely keys on it — it groups what is happening by room, and
 *     matching on a rendered label would mean parsing "Room 214" back apart.
 *     It is null for every visit order, which is the honest answer: those
 *     orders are not happening in a room and do not belong on that board.
 */
export async function kitchenTickets(
  tx: Tx,
  input: { outletId: string; statuses?: readonly OrderStatus[] },
): Promise<KitchenTicket[]> {
  const statuses = input.statuses ?? KITCHEN_OPEN_STATUSES;

  const rows = await tx.execute<{
    id: string; order_number: string; status: OrderStatus;
    destination_label: string | null; fulfilment: KitchenTicket['fulfilment'];
    room_number: string | null;
    /**
     * `Timestamp` — NOT `Date`. The generic on `tx.execute()` is an assertion,
     * not a parse: nothing checks it, and what the driver actually hands back
     * for a `timestamptz` depends on the connection. Typing these as `Date` was
     * how `.getTime() is not a function` reached production.
     */
    placed_at: Timestamp; promised_by_at: Timestamp; ready_at: Timestamp;
    assigned_runner_id: string | null;
    guest_notes: string | null; dietary_flags: unknown; lines: unknown;
  }>(sql`
    SELECT
      o.id, o.order_number, o.status, o.destination_label, o.fulfilment,
      r.number AS room_number,
      o.placed_at, o.promised_by_at, o.ready_at, o.assigned_runner_id,
      o.guest_notes, o.dietary_flags,
      COALESCE(
        (SELECT jsonb_agg(line ORDER BY line->>'name')
         FROM (
           SELECT jsonb_build_object(
             'menuItemId', oi.menu_item_id,
             'name', oi.name_snapshot,
             'quantity', oi.quantity,
             'notes', oi.notes,
             'modifiers', COALESCE(
               (SELECT jsonb_agg(om.name_snapshot ORDER BY om.name_snapshot)
                FROM order_item_modifiers om WHERE om.order_item_id = oi.id),
               '[]'::jsonb)
           ) AS line
           FROM order_items oi WHERE oi.order_id = o.id
         ) AS lines_for_order),
        '[]'::jsonb) AS lines
    FROM orders o
    -- LEFT, not INNER. See the note above: an inner join drops every visit
    -- order off the kitchen display, silently.
    LEFT JOIN stays s ON s.id = o.stay_id
    LEFT JOIN rooms r ON r.id = s.room_id
    WHERE o.outlet_id = ${input.outletId}
      AND o.status IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})
    ORDER BY o.placed_at ASC NULLS LAST
  `);

  return rows.rows.map(toKitchenTicket);
}


/**
 * The runner queue: cooked and waiting to move.
 *
 * Sorted differently from the kitchen's rail, because the question is
 * different. A cook asks what to cook next, so the rail is by `placed_at`. A
 * runner asks which tray to pick up, so trays still WAITING come first — and
 * within them the one that has been on the pass longest, which is the one going
 * cold. Trays already being carried stay on screen underneath: a runner who
 * walks to the pass and finds it empty needs to see who has it.
 */
export async function runnerTickets(
  tx: Tx,
  input: { outletId: string },
): Promise<KitchenTicket[]> {
  const tickets = await kitchenTickets(tx, {
    outletId: input.outletId,
    statuses: RUNNER_OPEN_STATUSES,
  });

  return tickets.sort(byRunnerPriority);
}


/** Open ticket count per outlet, for the unacknowledged badge. */
export async function openTicketCount(tx: Tx, outletId: string): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(
      eq(orders.outletId, outletId),
      inArray(orders.status, [...KITCHEN_OPEN_STATUSES]),
    ));
  return rows[0]?.n ?? 0;
}
