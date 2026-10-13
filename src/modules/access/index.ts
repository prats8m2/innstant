export { createDefaultAccessPolicy } from './provision';

export {
  scanQrCode, resolveGuestSession, raiseSessionTier, revokeSessionsForStay,
  activeSessionCountForStay, refreshSessionExpiryForStay,
  QrNotUsableError, GUEST_SESSION_COOKIE,
  /** D-079 — the same cookie, narrowed to the kind a screen can render. */
  resolveStaySession, resolveVisitSession,
} from './guest-sessions';
export type {
  GuestSession, GuestSessionBase, StayGuestSession, VisitGuestSession, ScanResult,
} from './guest-sessions';

/** D-079 — `/p/{code}`: the property link, and the visit it opens. */
export { scanVisitLink, revokeSessionsForVisit, VISIT_SESSION_TIER } from './visit-sessions';
export type { VisitScanResult } from './visit-sessions';

export {
  requireTier, abandonEscalation, startPhoneLast4Challenge, answerChallenge, vouchForGuest,
} from './escalation';
export type { TierCheck, EscalationRequired } from './escalation';

export {
  ACCESS_TIERS, TIER_CAPABILITIES, ACTION_TIERS, tierAtLeast, tierForAction,
} from './tiers';
export type { AccessTier, GuestAction } from './tiers';
