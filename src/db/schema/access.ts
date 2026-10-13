import { pgTable, uuid, text, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { pk, ts, createdAt, updatedAt, tenantId, propertyId } from './_shared';
import { accessTier, escalationTrigger, verificationMethod } from './_shared';
import { stays } from './stay';
import { visits } from './visit';
import { rooms, roomQrCodes, staffUsers } from './identity';

/**
 * D-012 — verification is triggered by ACTION, not by entry.
 *
 * Read D-012 before changing anything here. The original design verified on
 * every scan; it was rejected because a guest who cannot see a menu without a
 * login does not come back. A bare scan grants `access_policies.base_tier`
 * (default REQUEST): browse everything, call for service, raise free requests,
 * with zero screens in the way (#9).
 *
 * Verification exists for FRAUD, not identity. A QR sticker is photographable
 * from a corridor, a lift, or a Google review photo. If a scan alone can post
 * ₹4,000 to room 214, the hotel eats it.
 */

/** Every knob is per-property. */
export const accessPolicies = pgTable('access_policies', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),

  baseTier: accessTier('base_tier').notNull().default('REQUEST'),
  escalationTrigger: escalationTrigger('escalation_trigger').notNull().default('FIRST_CHARGE'),

  allowPhoneLast4: boolean('allow_phone_last4').notNull().default(true),
  allowOtpSms: boolean('allow_otp_sms').notNull().default(true),
  allowStaffVouch: boolean('allow_staff_vouch').notNull().default(true),

  /** Without these, last-4 verification is a five-attempt brute force. */
  maxAttemptsPerRoom: integer('max_attempts_per_room').notNull().default(5),
  maxAttemptsPerPhone: integer('max_attempts_per_phone').notNull().default(5),
  lockoutMinutes: integer('lockout_minutes').notNull().default(30),

  sessionGraceMinutes: integer('session_grace_minutes').notNull().default(120),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('access_policies_property_uq').on(t.propertyId)]);

/**
 * #10 — bound to stay_id, NEVER room_id. Rooms are reused; a session keyed on
 * a room shows the previous occupant's data. Tokens stored as SHA-256 only,
 * revoked at checkout.
 *
 * ─── D-079: one of stay_id or visit_id, never both, never neither ──────────
 *
 * A property link (`/p/{code}`) opens a VISIT — somebody at a table or on a
 * pavement, with no room and no stay. The session that comes out of it is the
 * same row with the same guarantees; what it is bound TO is the only
 * difference, and it is still never a room.
 *
 * Both columns are nullable at the type level and exactly one is set at the
 * database level: 0008 adds
 *
 *     CHECK (num_nonnulls(stay_id, visit_id) = 1)
 *
 * which Drizzle cannot express. That constraint is what stops this becoming a
 * nullable field somebody forgets to branch on — a session bound to neither
 * would resolve to a context-free guest who could order against nothing, and
 * one bound to both would make "whose order is this" a coin toss.
 */
export const guestSessions = pgTable('guest_sessions', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  /** Exactly one of these two. See the note above. */
  stayId: uuid('stay_id').references(() => stays.id),
  visitId: uuid('visit_id').references(() => visits.id),

  tokenHash: text('token_hash').notNull(),

  /** True until the guest escalates. A bare scan is anonymous and that is the
   *  entire point of D-012. */
  isAnonymous: boolean('is_anonymous').notNull().default(true),
  accessTier: accessTier('access_tier').notNull().default('REQUEST'),

  /** Lets you spot a code photographed off-site and used from an IP that never
   *  touched hotel wifi (DATA-MODEL §3). */
  scannedQrCodeId: uuid('scanned_qr_code_id').references(() => roomQrCodes.id),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),

  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('guest_sessions_token_hash_uq').on(t.tokenHash),
  index('guest_sessions_stay_idx').on(t.stayId),
  index('guest_sessions_visit_idx').on(t.visitId),
]);

/** Rate-limited per room AND per phone — both, because either alone is
 *  bypassable by varying the other. */
export const verificationChallenges = pgTable('verification_challenges', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  stayId: uuid('stay_id').notNull().references(() => stays.id),
  roomId: uuid('room_id').notNull().references(() => rooms.id),

  method: verificationMethod('method').notNull(),
  /** Hash only — never the OTP or the digits themselves. */
  challengeHash: text('challenge_hash'),
  phoneLast4: text('phone_last4'),

  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),

  succeededAt: ts('succeeded_at'),
  lockedUntil: ts('locked_until'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
}, (t) => [
  index('verification_challenges_room_idx').on(t.roomId, t.createdAt),
  index('verification_challenges_stay_idx').on(t.stayId),
]);

/** Attempts AND abandonment are both recorded — a guest who backs out at the
 *  prompt is the signal that the escalation trigger is set too aggressively. */
export const accessEscalations = pgTable('access_escalations', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  guestSessionId: uuid('guest_session_id').notNull().references(() => guestSessions.id),

  fromTier: accessTier('from_tier').notNull(),
  toTier: accessTier('to_tier').notNull(),
  triggeredBy: text('triggered_by').notNull(),
  method: verificationMethod('method'),

  outcome: text('outcome').notNull().default('STARTED'),
  completedAt: ts('completed_at'),
  abandonedAt: ts('abandoned_at'),
  createdAt: createdAt(),
}, (t) => [index('access_escalations_session_idx').on(t.guestSessionId)]);

/** Front desk escalates the session with ZERO guest-side interaction — the
 *  guest sees no prompt at all. */
export const staffVouches = pgTable('staff_vouches', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  stayId: uuid('stay_id').notNull().references(() => stays.id),
  guestSessionId: uuid('guest_session_id').references(() => guestSessions.id),
  staffUserId: uuid('staff_user_id').notNull().references(() => staffUsers.id),

  grantedTier: accessTier('granted_tier').notNull(),
  reason: text('reason'),
  createdAt: createdAt(),
}, (t) => [index('staff_vouches_stay_idx').on(t.stayId)]);
