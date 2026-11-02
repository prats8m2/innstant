/**
 * The billing module's service interface.
 *
 * Every charge in the product lands here — orders, amenities, late checkout.
 * Other modules post through `postFolioLine()` and never touch `folios` or
 * `folio_lines` (D-001), which is what makes the PMS adapter a change in one
 * place when it arrives (D-011).
 */
export {
  postFolioLine, getOrCreateOpenFolio, getFolioForStay, reverseFolioLinesForSource,
  folioBalancesForStays, lifetimeSpendForGuest,
} from './folio';
export type { PostFolioLineInput, FolioSummary, ReverseFolioLinesInput, FolioReversal }
  from './folio';

/**
 * Taking the money. `postFolioLine()` deliberately cannot post a PAYMENT — a
 * payment is two rows that have to exist together, and this is where they do.
 */
export {
  recordPayment, settleFolio, paymentsForStay, PAYMENT_METHODS,
} from './settle';
export type {
  RecordPaymentInput, RecordedPayment, SettleFolioResult, PaymentMethod,
} from './settle';

/** The folio as a bill the guest reads — pure, and where the wording decisions live. */
export { buildGuestStatement, EMPTY_STATEMENT_NOTE } from './statement';
export type { GuestStatement, StatementLine } from './statement';

/** The desk at checkout (D-095): add a charge, take some off, give money back,
 *  and the bill grouped the way a guest reads it. */
export {
  postDeskCharge, adjustBill, recordRefund, DESK_CHARGE_KINDS, DESK_CHARGE_LABEL,
} from './desk-billing';
export type { DeskChargeKind, DeskChargeInput, AdjustBillInput, RefundInput } from './desk-billing';
export { buildDeskBill, BILL_SECTION_TITLE, formatRate } from './desk-bill';
export type { DeskBill, BillSection, BillLine, BillPayment, BillSectionKey, OrderBreakdown } from './desk-bill';

/** Today's money by method — closing the drawer (D-097). */
export { collectionsToday } from './collections';
export type { Collection } from './collections';
