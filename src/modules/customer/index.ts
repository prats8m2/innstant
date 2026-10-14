/**
 * The customer module's service interface. D-081.
 *
 * Owns `customer_sessions`, `otp_challenges` and `guest_addresses`. It does
 * NOT own `guests` — that is `modules/stay`'s, and this module reaches it
 * through `upsertGuestByPhone()` rather than importing the table (D-001).
 *
 * Not `modules/identity`: that is STAFF auth. Not `modules/access`: that is
 * context sessions and D-012's escalation. This is the third thing, and it
 * grants no access to either of theirs.
 */
export {
  issueCustomerSession, resolveCustomerSession,
  revokeCustomerSession, revokeAllCustomerSessions,
  CUSTOMER_TOKEN_HEADER, CUSTOMER_SESSION_DAYS,
} from './sessions';
export type { CustomerSession, IssuedCustomerSession } from './sessions';

export { requestCode, verifyCode } from './otp';
export type { RequestCodeInput, VerifyCodeInput, VerifiedCustomer } from './otp';

export { otpSender, assertSenderIsSafeFor, ConsoleOtpSender } from './otp-sender';
export type { OtpSender } from './otp-sender';

export {
  getProfile, updateProfile,
  listAddresses, createAddress, updateAddress, archiveAddress,
} from './profile';
export type { CustomerProfile, CustomerAddress, AddressInput } from './profile';

export type { CustomerAuthMethod } from './types';
