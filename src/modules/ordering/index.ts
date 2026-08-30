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

export { calculateTotals, lineTotal } from './totals';
export type { OrderTotals, TotalsConfig, TotalsLine } from './totals';
