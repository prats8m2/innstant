export { createDefaultAccessPolicy } from './provision';

export {
  scanQrCode, resolveGuestSession, raiseSessionTier, revokeSessionsForStay,
  activeSessionCountForStay, QrNotUsableError, GUEST_SESSION_COOKIE,
} from './guest-sessions';
export type { GuestSession, ScanResult } from './guest-sessions';

export {
  requireTier, abandonEscalation, startPhoneLast4Challenge, answerChallenge, vouchForGuest,
} from './escalation';
export type { TierCheck, EscalationRequired } from './escalation';

export {
  ACCESS_TIERS, TIER_CAPABILITIES, ACTION_TIERS, tierAtLeast, tierForAction,
} from './tiers';
export type { AccessTier, GuestAction } from './tiers';
