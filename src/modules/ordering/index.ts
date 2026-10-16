/**
 * The ordering module's service interface.
 *
 * Its tables are private (D-001) — everything outside this directory goes
 * through these functions. In particular the guest screens never touch
 * `cart_items`, and `catalog` prices a cart through `getCartPricing()` rather
 * than either module reaching into the other's schema.
 */
export {
  getOrCreateCart, addToCart, getCart, setCartItemQuantity, removeCartItem,
  formatAddButtonTotal,
} from './cart';
export type { Cart, CartLine, CartLineModifier, CartOutletConfig, AddToCartInput } from './cart';

export { placeOrder } from './place-order';

/** "Same as last time" — the home screen's reorder block (D-080). */
export { lastReorderable, reorderIntoCart } from './reorder';
/** The "Order again" rail's ids — see the note in reorder.ts (phase 2). */
export { dishesOrderedBefore } from './reorder';
export type { ReorderableOrder, ReorderLine } from './reorder';
export { getOrderForContext, listOrdersForContext, listOrdersForCustomer } from './read-order';

/**
 * D-079 — what an order belongs to. A stay (charged to a room) or a visit
 * (paid at the counter). Every read in this module scopes by it, which is what
 * keeps "whose order is this" answerable now that there are two answers.
 */
export {
  stayContext, visitContext, contextForSession, contextOf, contextColumns,
} from './context';
export type { OrderContext } from './context';

export {
  advanceOrder, kitchenTickets, runnerTickets, openTicketCount, ORDER_CHANNEL,
  // Pure, and exported for the unit tests that guard the raw-row mapping and
  // the runner's sort order — see tests/unit/kitchen-ticket.test.ts.
  toKitchenTicket, byRunnerPriority,
} from './advance-order';
export type { AdvanceOrderInput, AdvancedOrder, KitchenTicket, OrderChangedPayload }
  from './advance-order';

export {
  canTransition, nextStatuses, isTerminal, reasonRequiredFor,
  ORDER_STATUSES, KITCHEN_OPEN_STATUSES, RUNNER_OPEN_STATUSES,
} from './transitions';
export type { OrderStatus } from './transitions';
export type { PlacedOrderDetail, PlacedOrderLine, OrderSummary } from './read-order';

export {
  trackView, trackEta, trackProgress, TRACK_STEPS, ETA_WINDOW_MINUTES,
  orderStateFor, OPEN_TO_A_GUEST,
} from './track';
export type { OrderState, OrderStateTone, TrackFulfilment } from './track';
export type { TrackView, TrackStep, TrackStepKey, TrackStepState, TrackHalt, TrackEta, OrderStamps }
  from './track';
export type { TrackProgress } from './track';
export type { PlaceOrderInput, PlacedOrder } from './place-order';

export { calculateTotals, lineTotal } from './totals';
export type { OrderTotals, TotalsConfig, TotalsLine } from './totals';

/** The menu list's own add and remove — see quick-add.ts for why defaults. */
export { quickAddDish, quickRemoveDish } from './quick-add';
export { canQuickAdd, defaultOptionIds } from './quick-add-rules';
