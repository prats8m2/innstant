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

/**
 * The boundary to reservation data (D-011, EXTENSION-POINTS §B). Every stay
 * change goes past `notifyPms()`, which writes an outbox row only for a property
 * whose system of record is somewhere else.
 */
export { pmsAdapterFor, adapterByKind, ManualAdapter } from './pms';
export type { PmsAdapter, PmsEvent, PmsEventKind, PmsKind, StayRef } from './pms';
export { notifyPms, drainPmsOutbox } from './pms/sync';
export type { DrainResult } from './pms/sync';

/** A guest, and what this property knows about them. */
export {
  getGuestDossier, updateGuestProfile, guestIdForStay, recentGuests, DIETARY_FLAGS,
} from './guest-profile';
export type {
  GuestDossier, GuestStaySummary, UpdateGuestProfileInput, DietaryFlag,
} from './guest-profile';

/** The front desk. Check-IN is `createStay()` above — the only door (#4). */
export { listRoomsWithOccupancy, checkOutStay } from './front-desk';
export type { RoomOccupancy, CheckOutResult } from './front-desk';

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
