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
} from './folio';
export type { PostFolioLineInput, FolioSummary, ReverseFolioLinesInput, FolioReversal }
  from './folio';

/** The folio as a bill the guest reads — pure, and where the wording decisions live. */
export { buildGuestStatement, EMPTY_STATEMENT_NOTE } from './statement';
export type { GuestStatement, StatementLine } from './statement';
