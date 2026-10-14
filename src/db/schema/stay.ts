import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, boolean, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  pk, ts, createdAt, updatedAt, tenantId, propertyId, currency, archivedAt,
} from './_shared';
import { stayStatus, staySource, checkoutRequestStatus } from './_shared';
import { rooms } from './identity';

/**
 * D-007 — Stay is the aggregate root, not Room.
 *
 * Rooms are reused. Keying guest data on room_id would show the guest who
 * checks into 402 on Tuesday the previous occupant's orders, dietary notes and
 * folio. Keying on stay_id makes that structurally impossible.
 *
 * CLAUDE.md #4: every stay in the system is created by ONE function,
 * modules/stay/createStay(). Front desk, PMS import and the seeder all call it.
 * When booking arrives it becomes a fourth caller rather than a sixth code path
 * someone has to find.
 */

/**
 * EXTENSION-POINTS §2 — TENANT-scoped, not property-scoped.
 * A person books before they arrive and may book across a group's properties.
 * Widening this later means merging duplicate guest rows that already exist
 * under different properties, then repointing every order, request, stay and
 * folio at the survivor. There is no clean automated answer to "are these two
 * Anjali Menons the same person" once the data is real.
 */
export const guests = pgTable('guests', {
  id: pk(),
  tenantId: tenantId(),

  phone: text('phone'),
  /**
   * When this number was proved by OTP, or null. D-081.
   *
   * A `guests` row is created three ways and only one of them proves
   * anything: a front desk types a number off a passport, anonymous checkout
   * takes whatever is typed into a form, and an OTP sign-in proves control of
   * the handset. Without this column those are indistinguishable, and
   * anything that trusts a phone number has no way to ask how it was learnt.
   */
  phoneVerifiedAt: ts('phone_verified_at'),
  email: text('email'),
  /**
   * The front desk's name for this person. Theirs, not the customer's.
   *
   * This is what a folio is made out to and what `/admin/guests/[guestId]`
   * renders. `upsertGuestByPhone()` already refuses to touch it, and D-081
   * extends that refusal to `PATCH /profile`: a customer proves a phone
   * number and nothing else, and a recycled number must not be able to rename
   * a real guest's record. Customer-facing reads resolve
   * `COALESCE(display_name, full_name)`.
   */
  fullName: text('full_name').notNull(),
  /** What the CUSTOMER calls themselves. Null until they say. See above. */
  displayName: text('display_name'),
  preferredLanguage: text('preferred_language').notNull().default('en'),

  /** Present and unused until v2 booking (EXTENSION-POINTS). */
  passwordHash: text('password_hash'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  // The key that matters: (tenant_id, phone), never (property_id, phone).
  uniqueIndex('guests_tenant_phone_uq').on(t.tenantId, t.phone),
]);

/** Property-specific view of a tenant-wide guest: VIP flag, staff notes,
 *  charging block, lifetime value. The extra join is the cost of §2. */
export const guestPropertyProfiles = pgTable('guest_property_profiles', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  guestId: uuid('guest_id').notNull().references(() => guests.id, { onDelete: 'cascade' }),

  isVip: boolean('is_vip').notNull().default(false),
  chargingBlocked: boolean('charging_blocked').notNull().default(false),
  staffNotes: text('staff_notes'),
  dietaryFlags: jsonb('dietary_flags').notNull().default(sql`'[]'::jsonb`),

  lifetimeValueMinor: integer('lifetime_value_minor').notNull().default(0),
  currency: currency(),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('guest_property_profiles_uq').on(t.propertyId, t.guestId)]);

export const stays = pgTable('stays', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  roomId: uuid('room_id').notNull().references(() => rooms.id),
  guestId: uuid('guest_id').notNull().references(() => guests.id),

  status: stayStatus('status').notNull().default('RESERVED'),

  /** EXTENSION-POINTS §3 — the discriminator and the opaque pointer. Forces
   *  the branch to exist so booking adds one enum value and one caller. */
  source: staySource('source').notNull().default('FRONT_DESK'),
  sourceRefId: text('source_ref_id'),

  checkedInAt: ts('checked_in_at'),
  checkedOutAt: ts('checked_out_at'),
  scheduledCheckoutAt: ts('scheduled_checkout_at').notNull(),
  adults: integer('adults').notNull().default(1),
  children: integer('children').notNull().default(0),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  // D-007, enforced by the database rather than by discipline. The partial
  // unique index is added in 0002_constraints.sql — Drizzle cannot express a
  // WHERE clause on a unique index, so it lives in raw SQL with a test.
  index('stays_property_status_idx').on(t.propertyId, t.status),
  index('stays_room_idx').on(t.roomId),
  index('stays_guest_idx').on(t.guestId),
]);

/**
 * What a property will sell a guest at the end of their stay, and for how much.
 *
 * A tier is an HOUR, not a duration: "checkout at 2pm" is what a guest picks and
 * what `stays.scheduled_checkout_at` becomes. The duration on the card ("three
 * extra hours") is derived from the stay's own checkout time, so a guest already
 * due out at 1pm reads "one extra hour" for the same tier.
 *
 * ─── What is deliberately NOT here ─────────────────────────────────────────
 *
 * An extra NIGHT. The design reference offers one ("Stay Thursday night,
 * ₹18,500") and pricing it needs a nightly rate — which is a rate plan for a
 * room type on a date, the exact thing CLAUDE.md #11 forbids putting on a room
 * and #12 reserves the names for. Late checkout is a service fee the property
 * sets; another night is a booking. See D-033.
 */
export const checkoutFeeTiers = pgTable('checkout_fee_tiers', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),

  /** Property-local hour of the new checkout time, 0–23. */
  hour: integer('hour').notNull(),

  /** Editorial, optional — "The room is yours all day". The title and the
   *  duration are both derived, so only the line that cannot be is stored. */
  note: text('note'),

  /** #5 — integer minor units plus an explicit currency. */
  feeMinor: integer('fee_minor').notNull().default(0),
  currency: currency(),

  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('checkout_fee_tiers_property_hour_uq').on(t.propertyId, t.hour),
]);

export const checkoutRequests = pgTable('checkout_requests', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  stayId: uuid('stay_id').notNull().references(() => stays.id),

  status: checkoutRequestStatus('status').notNull().default('REQUESTED'),
  requestedCheckoutAt: ts('requested_checkout_at').notNull(),

  /** #5 — integer minor units plus an explicit currency. */
  feeMinor: integer('fee_minor').notNull().default(0),
  currency: currency(),
  /** Front desk may override the tiered fee; both values are kept. */
  overriddenFeeMinor: integer('overridden_fee_minor'),

  decidedByStaffId: uuid('decided_by_staff_id'),
  decidedAt: ts('decided_at'),
  declineReason: text('decline_reason'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('checkout_requests_stay_idx').on(t.stayId, t.status)]);
