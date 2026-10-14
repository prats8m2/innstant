import {
  pgTable, uuid, text, integer, boolean, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  pk, ts, createdAt, updatedAt, tenantId, archivedAt, customerAuthMethod,
} from './_shared';
import { guests } from './stay';

/**
 * Customer accounts. D-081, and docs/CUSTOMER-ACCOUNTS-PROPOSAL.md.
 *
 * ─── Why this is not in `guest_sessions` ───────────────────────────────────
 *
 * Because they answer different questions and the difference only became
 * visible when accounts arrived:
 *
 *   `guest_sessions` answers WHERE you are ordering from — a stay or a visit.
 *   It expires with that context (six hours for a table tent; checkout plus
 *   grace for a room) and it carries the access tier D-012 governs.
 *
 *   A customer session answers WHO YOU ARE. It lasts weeks, it survives every
 *   visit, and it carries no tier at all.
 *
 * Folding the second into the first breaks it three ways: the lifetimes
 * differ, `num_nonnulls(stay_id, visit_id) = 1` says a session is in exactly
 * one context while an identity is in none of them, and order history has to
 * work with NO context at all — somebody opening the app signed in, having
 * scanned nothing. That last state is the proof.
 *
 * ─── The rule this file rests on ───────────────────────────────────────────
 *
 * **A customer session grants ZERO access to any context.** It is not an
 * access tier and must never be consulted as one. Being a known customer is
 * not evidence that you are the person in room 214 — that is what D-012's
 * phone-last-4 prompt is for, and it stays there, scoped to that stay.
 *
 * What this unlocks is only what belongs to the ACCOUNT: the profile, saved
 * addresses, and order history. Nothing that belongs to a context.
 *
 * ─── Why there is no `customers` table ─────────────────────────────────────
 *
 * `guests` already is one. It is TENANT-scoped and unique on
 * `(tenant_id, phone)` — EXTENSION-POINTS §2 made it so precisely because a
 * person books before they arrive and may cross a group's properties, and
 * because merging duplicate people later has no clean automated answer. A
 * parallel `customers` table would be that duplicate, created deliberately.
 *
 * `guests.password_hash` stays UNUSED. §2 reserved it for v2 booking's guest
 * login; OTP does not need it, and repurposing a column reserved for
 * something else is how a reservation stops meaning anything.
 */

/**
 * A signed-in customer, on one device.
 *
 * Token stored as SHA-256 only, the same rule as `staff_sessions` and
 * `guest_sessions` (#10). The row IS the session: a revoked stateless token
 * would stay valid until it expired, and signing out has to mean something
 * immediately.
 */
export const customerSessions = pgTable('customer_sessions', {
  id: pk(),
  tenantId: tenantId(),
  /** No `property_id`. An account is tenant-wide, exactly as `guests` is —
   *  a customer who orders from two properties in a group is one customer. */
  guestId: uuid('guest_id').notNull().references(() => guests.id, { onDelete: 'cascade' }),

  tokenHash: text('token_hash').notNull(),
  /** How they proved it. Recorded rather than assumed, so a later method is
   *  distinguishable in the audit trail forever after. */
  method: customerAuthMethod('method').notNull().default('OTP_SMS'),

  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),

  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('customer_sessions_token_hash_uq').on(t.tokenHash),
  // "Sign me out everywhere", and the sweep that revokes on a phone change.
  index('customer_sessions_guest_idx').on(t.guestId),
]);

/**
 * A one-time code sent to a phone.
 *
 * ─── Keyed on the PHONE, not on a guest ────────────────────────────────────
 *
 * Deliberately. A challenge must be creatable for a number this tenant has
 * never seen, and it must be indistinguishable from one for a number it
 * knows — otherwise the endpoint that creates it is an oracle for "does this
 * person have an account here". No FK to `guests`, and the row is created the
 * same way either way.
 *
 * ─── SHA-256, not argon2 ───────────────────────────────────────────────────
 *
 * The opposite of the choice made for passwords, and for a reason that is
 * about the attacker rather than the secret. A six-digit code is ~20 bits:
 * brute force is not stopped by a work factor, it is stopped by `attempts`
 * and `locked_until`, which is why both are on this row. Argon2 here would
 * cost ~100ms on every verify and buy nothing, and this runs on the critical
 * path of somebody signing in. The code is short-lived, single-use, and rate
 * limited; the hash exists so a database leak does not hand over live codes.
 */
export const otpChallenges = pgTable('otp_challenges', {
  id: pk(),
  tenantId: tenantId(),

  /** As given. Normalisation happens in the service, so the same human number
   *  typed two ways hits the same rate limit. */
  phone: text('phone').notNull(),
  /** SHA-256 of the code. Never the code. */
  codeHash: text('code_hash').notNull(),

  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  lockedUntil: ts('locked_until'),

  /** Single use. A verified challenge is spent even if it has not expired. */
  consumedAt: ts('consumed_at'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: createdAt(),
}, (t) => [
  // Serves three questions at once: the newest live challenge for a number,
  // the resend throttle, and the lockout window.
  index('otp_challenges_phone_idx').on(t.tenantId, t.phone, t.createdAt),
]);

/**
 * Where a customer wants food delivered.
 *
 * ─── One free-text line, not a structured address ──────────────────────────
 *
 * The same decision `visits.delivery_address` made and for the same reason: an
 * Indian address is a landmark and a floor as often as it is a street and a
 * postcode, and a form that insists on structure gets "near the temple" typed
 * into `street_1` anyway. The rider reads it; nothing parses it.
 *
 * Archived rather than deleted (D-008's rule, one table over): a past order's
 * `destination_label` is its own snapshot (#6), but an address somebody
 * removes should stop being offered without breaking anything that pointed at
 * it.
 */
export const guestAddresses = pgTable('guest_addresses', {
  id: pk(),
  tenantId: tenantId(),
  guestId: uuid('guest_id').notNull().references(() => guests.id, { onDelete: 'cascade' }),

  /** "Home", "Work", "Mum's". Theirs to choose; shown in the picker. */
  label: text('label').notNull(),
  line: text('line').notNull(),
  /** Gate code, which floor, ring twice. */
  notes: text('notes'),

  /** At most one per guest, enforced by a partial unique index in 0009 —
   *  Drizzle cannot express a WHERE on a unique index, the same reason
   *  `stays`' one-active-stay-per-room lives in raw SQL. */
  isDefault: boolean('is_default').notNull().default(false),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('guest_addresses_guest_idx').on(t.guestId, t.isDefault)]);
