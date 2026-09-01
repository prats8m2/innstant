/**
 * The stay module's service interface.
 *
 * `stays` is sealed (CLAUDE.md #4, EXTENSION-POINTS §A): the ESLint boundary
 * forbids every other module from importing the table, and this file is the
 * only way in. `createStay()` is the single birth certificate — front desk,
 * PMS import and the seeder all call it, and booking becomes a fourth caller
 * rather than a sixth code path.
 */
export {
  createStay, activeStayForRoom, dietaryFlagsForStay, guestProfileForStay,
  countActiveStays,
} from './create-stay';
export type { CreateStayInput, CreatedStay, StayGuestProfile } from './create-stay';

/** Changing when a guest leaves — P3's checkout-change flow. */
export {
  getCheckoutOptions, requestCheckoutChange, cancelCheckoutRequest,
  decideCheckoutRequest, listCheckoutRequests,
} from './checkout';
export type {
  CheckoutOptions, PendingCheckoutRequest, RequestCheckoutInput, RequestedCheckout,
  DecideCheckoutInput, DecidedCheckout, DeskCheckoutRequest,
} from './checkout';
export {
  checkoutOffersFor, checkoutCtaFor, canDecideCheckout, effectiveFeeMinor,
  CHECKOUT_REQUEST_STATUSES,
} from './checkout-rules';
export type { CheckoutOffer, CheckoutTier, CheckoutRequestStatus } from './checkout-rules';
