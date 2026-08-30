import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, integer, boolean, jsonb, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { pk, ts, createdAt, updatedAt, tenantId, propertyId, archivedAt } from './_shared';

/**
 * Tenancy, staff, and RBAC.
 *
 * D-006: Tenant is the customer account and billing relationship; Property is
 * one physical hotel. A group with six hotels is ONE tenant and SIX properties.
 * Conflating them is what makes a group GM impossible to model later.
 */

/** The only table without a tenant_id — it IS the tenant. */
export const tenants = pgTable('tenants', {
  id: pk(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('tenants_slug_uq').on(t.slug)]);

export const properties = pgTable('properties', {
  id: pk(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),

  /** Anything a human sees is rendered in THIS timezone, never the server's.
   *  Availability windows and business-day rollovers are property-local. */
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  currency: text('currency').notNull().default('INR'),

  /** D-016 — theming is a token swap, never a layout fork. Identical DOM
   *  across every hotel; only these CSS custom property values differ.
   *  Seeded from design/themes/*.json. WCAG AA validated at save time. */
  branding: jsonb('branding').notNull().default(sql`'{}'::jsonb`),

  addressLine: text('address_line'),
  city: text('city'),
  countryCode: text('country_code'),
  latitude: text('latitude'),
  longitude: text('longitude'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('properties_tenant_slug_uq').on(t.tenantId, t.slug),
  index('properties_tenant_idx').on(t.tenantId),
]);

/**
 * EXTENSION-POINTS §1 — a REAL table, not a varchar on rooms.
 * Rates and inventory are priced per room type, never per physical room, so
 * booking cannot exist without this. Adding it later means reading every
 * distinct varchar across every property and reconciling the typos on live
 * data. The single most expensive thing that could be deferred.
 */
export const roomTypes = pgTable('room_types', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  description: text('description'),
  maxOccupancy: integer('max_occupancy').notNull().default(2),
  /** Already present, unused until v2 booking (EXTENSION-POINTS). */
  totalRooms: integer('total_rooms'),
  sortOrder: integer('sort_order').notNull().default(0),
  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('room_types_property_code_uq').on(t.propertyId, t.code)]);

export const floors = pgTable('floors', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  name: text('name').notNull(),
  level: integer('level').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('floors_property_level_uq').on(t.propertyId, t.level)]);

/**
 * #11 — NEVER put a price on this table.
 * Prices belong to a rate plan for a room type on a date. Adding
 * `rooms.nightly_rate` "just for the admin display" silently commits the model
 * to per-room pricing and every rate feature fights it afterwards.
 */
export const rooms = pgTable('rooms', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  floorId: uuid('floor_id').notNull().references(() => floors.id),
  roomTypeId: uuid('room_type_id').notNull().references(() => roomTypes.id),

  number: text('number').notNull(),
  status: text('status').notNull().default('AVAILABLE'),
  notes: text('notes'),

  archivedAt: archivedAt(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('rooms_property_number_uq').on(t.propertyId, t.number),
  index('rooms_property_floor_idx').on(t.propertyId, t.floorId),
]);

/**
 * DATA-MODEL §3. The sticker is public and grants ROOM CONTEXT only.
 * `version` means reprinting a sticker invalidates the old one.
 */
export const roomQrCodes = pgTable('room_qr_codes', {
  id: pk(),
  tenantId: tenantId(),
  propertyId: propertyId(),
  roomId: uuid('room_id').notNull().references(() => rooms.id),

  publicCode: text('public_code').notNull(),
  version: integer('version').notNull().default(1),
  revokedAt: ts('revoked_at'),

  createdAt: createdAt(),
}, (t) => [
  // Globally unique: the scan resolves the property FROM the code, so it
  // cannot be scoped to a property at lookup time.
  uniqueIndex('room_qr_codes_public_code_uq').on(t.publicCode),
  index('room_qr_codes_room_idx').on(t.roomId),
]);

export const staffUsers = pgTable('staff_users', {
  id: pk(),
  tenantId: tenantId(),
  email: text('email').notNull(),
  /** Argon2id (S5). Never anything else, never plaintext. */
  passwordHash: text('password_hash'),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  avatarUrl: text('avatar_url'),

  status: text('status').notNull().default('INVITED'),
  lastLoginAt: ts('last_login_at'),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('staff_users_tenant_email_uq').on(t.tenantId, t.email)]);

/** The 8 system roles are seeded with is_system = true and cannot be deleted. */
export const roles = pgTable('roles', {
  id: pk(),
  tenantId: tenantId(),
  /** Null for tenant-wide roles; set for property-specific custom roles. */
  propertyId: uuid('property_id'),

  key: text('key').notNull(),
  name: text('name').notNull(),
  isSystem: boolean('is_system').notNull().default(false),

  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('roles_tenant_property_key_uq').on(t.tenantId, t.propertyId, t.key)]);

/**
 * One row per grant, so "which roles can do X" is answerable without a scan
 * and custom per-property roles stay possible. `permission` is
 * 'resource:action', matching authorize(session, propertyId, perm) in S5.
 */
export const rolePermissions = pgTable('role_permissions', {
  id: pk(),
  tenantId: tenantId(),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('role_permissions_role_perm_uq').on(t.roleId, t.permission)]);

/**
 * Many-to-many: a staff user holds roles AT properties. This is what makes a
 * group GM real — S5's session carries the SET of propertyIds the user has
 * roles at, which requires this table to exist.
 */
export const staffPropertyRoles = pgTable('staff_property_roles', {
  id: pk(),
  tenantId: tenantId(),
  staffUserId: uuid('staff_user_id').notNull().references(() => staffUsers.id, { onDelete: 'cascade' }),
  propertyId: propertyId(),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('staff_property_roles_uq').on(t.staffUserId, t.propertyId, t.roleId),
  index('staff_property_roles_staff_idx').on(t.staffUserId),
]);

/** Token stored as SHA-256 only — same rule as guest sessions (#10). */
export const staffSessions = pgTable('staff_sessions', {
  id: pk(),
  tenantId: tenantId(),
  staffUserId: uuid('staff_user_id').notNull().references(() => staffUsers.id, { onDelete: 'cascade' }),

  tokenHash: text('token_hash').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),

  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('staff_sessions_token_hash_uq').on(t.tokenHash),
  index('staff_sessions_staff_idx').on(t.staffUserId),
]);
