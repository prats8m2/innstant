/**
 * The service-request state machine. Pure — no database, no clock.
 *
 * Deliberately NOT a copy of the order machine. An order is a transaction with
 * a kitchen in the middle; a request is a person walking to a room. Three
 * differences drive everything below.
 *
 * ─── The flow ──────────────────────────────────────────────────────────────
 *
 *   OPEN ─→ ASSIGNED ─→ IN_PROGRESS ─→ COMPLETED ─→ VERIFIED
 *     │         │            │
 *     ├─────────┴────────────┴─→ REJECTED   (nobody can do it, with a reason)
 *     └─────────┴────────────┴─→ CANCELLED  (the guest no longer needs it)
 *
 * **1. ESCALATED is not a status** (DATA-MODEL §6). A breached request is very
 * often IN_PROGRESS — someone IS walking — and collapsing that into one enum
 * loses the only fact the duty manager needs. Breach lives in `escalated_at`
 * and `escalation_level`, alongside whatever the status happens to be.
 *
 * **2. A request can be cancelled much later than an order.** A guest who asked
 * for towels and then found some can say so while a runner is on the stairs.
 * That is not a race to prevent; it is the common case, and CANCELLED is
 * reachable from every live state.
 *
 * **3. VERIFIED is separate from COMPLETED** because the person who did the
 * work and the person who checks it are different people. Housekeeping marks a
 * room clean; a supervisor verifies. Skipping it is allowed — most properties
 * will — but a property that wants the second signature has somewhere to put it.
 */
export const REQUEST_STATUSES = [
  'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED',
  'REJECTED', 'CANCELLED',
] as const;

export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const FLOW: Record<RequestStatus, readonly RequestStatus[]> = {
  // Unassigned. Auto-routing moves it on; a board can also claim it.
  OPEN: ['ASSIGNED', 'IN_PROGRESS', 'REJECTED', 'CANCELLED'],
  // Someone owns it. They may start, hand it back, or it may be cancelled.
  ASSIGNED: ['IN_PROGRESS', 'OPEN', 'REJECTED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED', 'CANCELLED'],
  // Done. A supervisor may verify; nothing else moves.
  COMPLETED: ['VERIFIED'],

  VERIFIED: [],
  REJECTED: [],
  CANCELLED: [],
};

/**
 * `OPEN → IN_PROGRESS` skips ASSIGNED on purpose.
 *
 * A housekeeper standing in the corridor who picks a request off the board and
 * starts walking has not "assigned" it to themselves as a separate act. Forcing
 * two taps for one decision is how a board gets ignored.
 */
const TERMINAL: readonly RequestStatus[] = ['VERIFIED', 'REJECTED', 'CANCELLED'];

/** Statuses a staff board shows: not finished with. */
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = [
  'OPEN', 'ASSIGNED', 'IN_PROGRESS',
];

/** Statuses where the SLA clock is still running. */
export const SLA_ACTIVE_STATUSES: readonly RequestStatus[] = [
  'OPEN', 'ASSIGNED', 'IN_PROGRESS',
];

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return FLOW[from].includes(to);
}

export function nextStatuses(from: RequestStatus): readonly RequestStatus[] {
  return FLOW[from];
}

export function isTerminal(status: RequestStatus): boolean {
  return TERMINAL.includes(status);
}

/**
 * The timestamp each status stamps.
 *
 * Redundant with `event_log` on purpose (DATA-MODEL §6) — the columns make the
 * SLA report a cheap query and the log makes it provable, and they are written
 * in the same transaction so they cannot disagree.
 *
 * OPEN has none: `created_at` is when it opened, and a second column saying the
 * same thing is a second thing to keep true.
 */
export const REQUEST_STATUS_TIMESTAMP: Partial<Record<RequestStatus, string>> = {
  ASSIGNED: 'assignedAt',
  IN_PROGRESS: 'startedAt',
  COMPLETED: 'completedAt',
  VERIFIED: 'verifiedAt',
};

/** Transitions that cannot be made without saying why. */
export function reasonRequiredFor(to: RequestStatus): 'rejection' | 'cancellation' | null {
  if (to === 'REJECTED') return 'rejection';
  if (to === 'CANCELLED') return 'cancellation';
  return null;
}

/**
 * Is this request past its promise, and by how much.
 *
 * Pure, and takes the instant — the SLA sweep and the board both need the same
 * answer, and a function that reads the clock cannot be tested for the minute
 * either side of a breach.
 *
 * A finished request is never breaching, whatever its target says: the clock
 * stops when the work does, not when someone gets round to looking at the board.
 */
export function slaState(
  request: { status: RequestStatus; slaTargetAt: Date | null; completedAt: Date | null },
  now: Date,
): { breached: boolean; secondsRemaining: number | null } {
  if (!request.slaTargetAt) return { breached: false, secondsRemaining: null };

  if (!SLA_ACTIVE_STATUSES.includes(request.status)) {
    return { breached: false, secondsRemaining: null };
  }

  const seconds = Math.round((request.slaTargetAt.getTime() - now.getTime()) / 1000);
  return { breached: seconds < 0, secondsRemaining: seconds };
}
