/**
 * The visit module's service interface. D-079.
 *
 * `visits` is sealed the way `stays` is (CLAUDE.md #4 applied to its sibling):
 * the ESLint boundary forbids every other module from importing the table, and
 * this file is the only way in. `openVisit()` is the single birth certificate —
 * the property link calls it today, a waiter's tablet and a phone order taken
 * at the counter are the callers it exists for.
 */
export {
  openVisit, findVisit, setVisitDetails, closeVisit, findLiveVisitLink,
  fulfilmentForLinkKind, destinationLabelFor,
  VISIT_FULFILMENTS, VISIT_WINDOW_HOURS,
} from './open-visit';
export type {
  Visit, OpenVisitInput, VisitDetailsInput, VisitFulfilment, VisitLinkKind,
} from './open-visit';

/** The admin half — minting, reprinting and revoking the codes themselves. */
export {
  createVisitLink, regenerateVisitLink, revokeVisitLink,
  listVisitLinks, listOpenVisits,
} from './links';
export type { VisitLinkRow, CreateVisitLinkInput } from './links';
