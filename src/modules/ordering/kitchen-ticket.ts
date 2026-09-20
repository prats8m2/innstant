/**
 * The kitchen ticket: a raw order row, and the two pure functions that shape it.
 *
 * Pure — no database, no clock — for the same reason `transitions.ts` is. These
 * are the only two pieces of the ticket pipeline that can be wrong in a way a
 * type cannot catch, and keeping them out of the query file is what lets
 * tests/unit/kitchen-ticket.test.ts reach them without a connection.
 */
import type { OrderStatus } from './transitions';

export interface KitchenTicket {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  roomNumber: string;
  placedAt: Date | null;
  promisedByAt: Date | null;
  /** When it came off the pan. What a runner is actually racing — food goes
   *  cold from `ready_at`, not from when the guest ordered. */
  readyAt: Date | null;
  /** Who is carrying it, once someone has picked it up. */
  assignedRunnerId: string | null;
  guestNotes: string | null;
  dietaryFlags: string[];
  lines: Array<{
    /** Null once the dish has been archived (the FK is ON DELETE SET NULL, and
     *  the snapshot is what the ticket actually shows). Without it the kitchen
     *  cannot 86 the dish from here. */
    menuItemId: string | null;
    name: string;
    quantity: number;
    modifiers: string[];
    notes: string | null;
  }>;
}

/** What a `timestamptz` can actually arrive as out of a raw query. */
export type Timestamp = Date | string | null;

/**
 * A raw row, as the ticket the rest of the product expects.
 *
 * ─── Why the dates are wrapped ─────────────────────────────────────────────
 *
 * Every other raw-SQL mapper in the codebase does this — `readRequests`,
 * `listCheckoutRequests`, the folio. This one did not, and passed the driver's
 * value straight through behind a type that promised a `Date`. Nothing could
 * catch it: `tx.execute<T>()` asserts its generic rather than parsing, so the
 * compiler believed the promise and every consumer was written against it.
 *
 * It surfaced as `(ticket.readyAt ?? …).getTime is not a function` in the
 * runner queue's sort — and only once a property had TWO trays moving at the
 * same time, because `Array.sort` never calls the comparator on a shorter list.
 * A queue of one worked perfectly, in dev and in every screenshot.
 *
 * Exported so it can be unit-tested against the string shape a driver really
 * returns, which is the only way this class of bug gets caught before a floor
 * does it.
 */
export function toKitchenTicket(row: {
  id: string; order_number: string; status: OrderStatus; room_number: string;
  placed_at: Timestamp; promised_by_at: Timestamp; ready_at: Timestamp;
  assigned_runner_id: string | null;
  guest_notes: string | null; dietary_flags: unknown; lines: unknown;
}): KitchenTicket {
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    roomNumber: row.room_number,
    placedAt: asDate(row.placed_at),
    promisedByAt: asDate(row.promised_by_at),
    readyAt: asDate(row.ready_at),
    assignedRunnerId: row.assigned_runner_id,
    guestNotes: row.guest_notes,
    dietaryFlags: Array.isArray(row.dietary_flags) ? (row.dietary_flags as string[]) : [],
    lines: (row.lines as KitchenTicket['lines']) ?? [],
  };
}

/**
 * Null stays null — an order that was never placed has no placed_at, and
 * `new Date(null)` is the epoch, which would read as 1 January 1970 on a
 * kitchen display rather than as "no time".
 */
function asDate(value: Timestamp): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value);
}

/**
 * Waiting trays first, then the one that has been on the pass longest.
 *
 * Exported and pure so the order can be asserted without a database. It threw
 * in production for a year's worth of sessions without anything noticing,
 * because a queue of fewer than two never calls a comparator.
 */
export function byRunnerPriority(a: KitchenTicket, b: KitchenTicket): number {
  const waitingFirst = (ticket: KitchenTicket) => (ticket.status === 'READY' ? 0 : 1);
  // `ready_at` is what a runner is racing. Falling back to `placed_at` keeps
  // the order stable for a seeded or repaired row that never stamped one.
  const onThePassSince = (ticket: KitchenTicket) =>
    (ticket.readyAt ?? ticket.placedAt ?? new Date(0)).getTime();

  return waitingFirst(a) - waitingFirst(b) || onThePassSince(a) - onThePassSince(b);
}
