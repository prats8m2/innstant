/**
 * The order state machine. Pure — no database, no clock.
 *
 * CLAUDE.md "Ask before changing an existing state machine" applies from here
 * on: this table is the product's definition of what can happen to an order,
 * and every transition writes an `event_log` row (#7), so changing it changes
 * what the audit trail can express.
 *
 * ─── The flow, and the two places it forks ─────────────────────────────────
 *
 *   PLACED ─→ ACCEPTED ─→ PREPARING ─→ READY ─→ OUT_FOR_DELIVERY ─→ DELIVERED
 *      │           │                                                    │
 *      ├─→ REJECTED (kitchen says no, with a reason)                     ↓
 *      └─→ CANCELLED (guest or staff, before the kitchen commits)     CLOSED
 *
 * REJECTED is not a failure state to be hidden. A kitchen that cannot say "we
 * are out of sole" accepts the order and then fails silently, which is worse
 * for the guest — so it is a first-class transition with a required reason.
 *
 * DISPUTED is reachable from any state a charge can exist in, because a dispute
 * is about the money rather than the food.
 */
export const ORDER_STATUSES = [
  'DRAFT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY',
  'OUT_FOR_DELIVERY', 'DELIVERED', 'CLOSED',
  'REJECTED', 'CANCELLED', 'DISPUTED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const FLOW: Record<OrderStatus, readonly OrderStatus[]> = {
  // DRAFT exists only inside placeOrder(); an order is PLACED by the time
  // anything else can see it.
  DRAFT: ['PLACED', 'CANCELLED'],

  PLACED: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  // Still cancellable: the kitchen has seen it but not started cooking.
  ACCEPTED: ['PREPARING', 'REJECTED', 'CANCELLED'],
  // Once a pan is on, cancelling is a conversation with the kitchen, not a tap.
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: ['CLOSED', 'DISPUTED'],
  CLOSED: ['DISPUTED'],

  REJECTED: [],
  CANCELLED: [],
  DISPUTED: ['CLOSED'],
};

/** Terminal for the kitchen's purposes — nothing more will be cooked. */
const TERMINAL: readonly OrderStatus[] = ['CLOSED', 'REJECTED', 'CANCELLED'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return FLOW[from].includes(to);
}

export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return FLOW[from];
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL.includes(status);
}

/** Statuses the KDS shows. An order leaves the rail when it leaves the kitchen. */
export const KITCHEN_OPEN_STATUSES: readonly OrderStatus[] = [
  'PLACED', 'ACCEPTED', 'PREPARING', 'READY',
];

/** Statuses the runner app shows: cooked, waiting to move. */
export const RUNNER_OPEN_STATUSES: readonly OrderStatus[] = ['READY', 'OUT_FOR_DELIVERY'];

/**
 * The timestamp column each status stamps.
 *
 * Redundant with `event_log` on purpose (DATA-MODEL §6): the columns make the
 * SLA dashboard a cheap query, the log makes it provable. They are written in
 * the same transaction so they cannot disagree.
 */
export const STATUS_TIMESTAMP: Partial<Record<OrderStatus, string>> = {
  PLACED: 'placedAt',
  ACCEPTED: 'acceptedAt',
  PREPARING: 'preparingAt',
  READY: 'readyAt',
  OUT_FOR_DELIVERY: 'outForDeliveryAt',
  DELIVERED: 'deliveredAt',
  CLOSED: 'closedAt',
};

/** Transitions that cannot be made without saying why. */
export function reasonRequiredFor(to: OrderStatus): 'rejection' | 'cancellation' | null {
  if (to === 'REJECTED') return 'rejection';
  if (to === 'CANCELLED') return 'cancellation';
  return null;
}
