import { eq, type SQL } from 'drizzle-orm';
import { carts, orders } from '@/db/schema/ordering';

/**
 * What an order belongs to. D-079.
 *
 * Until property links existed there was one answer — a stay — and `stayId:
 * string` was threaded through every function in this module. There are now
 * two, and this is the type that says so once rather than every signature
 * saying it again as a pair of nullable fields.
 *
 * ─── Why a union and not `{ stayId?, visitId? }` ───────────────────────────
 *
 * The same reason `GuestSession` is one (modules/access). An optional pair has
 * four states and only two are legal; the database refuses the other two with a
 * CHECK, which means the illegal ones surface as a 23514 from inside a
 * transaction rather than as a type error at the call site that built them.
 * A union has exactly the two states, and `contextOf()` below is the only place
 * that turns a row back into one.
 */
export type OrderContext =
  | { kind: 'STAY'; stayId: string }
  | { kind: 'VISIT'; visitId: string };

export function stayContext(stayId: string): OrderContext {
  return { kind: 'STAY', stayId };
}

export function visitContext(visitId: string): OrderContext {
  return { kind: 'VISIT', visitId };
}

/**
 * The context a guest session is ordering in.
 *
 * This is what keeps the change at the call sites to one line: a screen that
 * had `stayId: session.stayId` now has `context: contextForSession(session)`,
 * and works unchanged for both kinds of link.
 */
export function contextForSession(
  session:
    | { kind: 'STAY'; stayId: string }
    | { kind: 'VISIT'; visitId: string },
): OrderContext {
  return session.kind === 'STAY'
    ? { kind: 'STAY', stayId: session.stayId }
    : { kind: 'VISIT', visitId: session.visitId };
}

/** A row read back from `orders` or `carts`, as a context. The CHECK in 0008
 *  guarantees exactly one is set; this is where that guarantee is cashed in. */
export function contextOf(row: { stayId: string | null; visitId: string | null }): OrderContext {
  if (row.stayId) return { kind: 'STAY', stayId: row.stayId };
  if (row.visitId) return { kind: 'VISIT', visitId: row.visitId };
  // Unreachable while the CHECK holds. Thrown rather than returned as null so
  // that a database somehow missing the constraint fails loudly here instead of
  // quietly showing one customer another's order.
  throw new Error('order context row has neither stay_id nor visit_id');
}

/** The columns to write when inserting a cart or an order. */
export function contextColumns(context: OrderContext): { stayId: string | null; visitId: string | null } {
  return context.kind === 'STAY'
    ? { stayId: context.stayId, visitId: null }
    : { stayId: null, visitId: context.visitId };
}

/**
 * The predicate that scopes a read to this context, and the reason every
 * "whose order is this" check keeps working.
 *
 * RLS confines a query to the tenant; THIS is what confines it to the one
 * guest. An order id travels in a URL, so a row that matched on id alone would
 * be the room next door's dinner — or now the next table's.
 */
export function ordersIn(context: OrderContext): SQL {
  return context.kind === 'STAY'
    ? eq(orders.stayId, context.stayId)
    : eq(orders.visitId, context.visitId);
}

export function cartsIn(context: OrderContext): SQL {
  return context.kind === 'STAY'
    ? eq(carts.stayId, context.stayId)
    : eq(carts.visitId, context.visitId);
}
