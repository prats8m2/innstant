/**
 * The permission model. Reviewed and agreed in docs/RBAC-PROPOSAL.md.
 *
 * Three design rules, and each one exists because of a specific failure:
 *
 *  1. Read, write and money are separate. `folio:read` is a support question;
 *     `payment:refund` is cash leaving the building.
 *  2. Domain verbs, not CRUD. `order:advance` bumps a state machine; there is
 *     no `order:update`, because a CRUD-shaped permission grants far more than
 *     the screen it was added for.
 *  3. Anything fraud-adjacent is its own permission. `guest:vouch` escalates a
 *     guest session with zero guest-side interaction — the deliberate bypass of
 *     D-012's only anti-fraud control. It must never ride inside `guest:update`.
 */

export const PERMISSIONS = [
  // Property & configuration
  'property:read',
  'property:update',
  'property:branding',
  /** The D-012 knobs: base_tier, escalation_trigger. Changing these changes
   *  who can charge to a room without verifying. */
  'property:access_policy',

  // Staff & roles
  'staff:read', 'staff:invite', 'staff:update', 'staff:deactivate',
  'role:read', 'role:assign', 'role:manage',

  // Rooms & QR
  'room:read', 'room:manage',
  'qr:read',
  /** Bumps `version` and invalidates the sticker on the nightstand. */
  'qr:regenerate',

  // Stays & guests
  'stay:read', 'stay:check_in', 'stay:check_out', 'stay:update',
  'guest:read', 'guest:update',
  'guest:vouch',

  // Catalog
  'catalog:read', 'catalog:manage',
  /** Split from `manage` so a kitchen can 86 a dish without repricing it. */
  'catalog:pricing',
  'catalog:availability',

  // Orders
  'order:read', 'order:accept', 'order:reject', 'order:advance',
  'order:cancel', 'order:dispute',

  // Service requests
  'request:read', 'request:advance', 'request:assign', 'request:verify',
  'request:cancel', 'request_type:manage',

  // Money
  'folio:read', 'folio:post_charge', 'folio:adjust', 'folio:settle',
  'payment:read', 'payment:capture', 'payment:refund',
  'checkout_request:approve', 'checkout_request:override_fee',

  // Concierge
  'poi:read', 'poi:manage', 'itinerary:manage',

  // Shifts
  'shift:read', 'shift:manage',
  /** Clock YOURSELF in and out. Not other people. */
  'shift:clock',

  // Reporting
  'analytics:read',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/** Every `:read`, used to build READ_ONLY without listing them twice. */
const ALL_READS = PERMISSIONS.filter((p) => p.endsWith(':read')) as readonly Permission[];

export const SYSTEM_ROLE_KEYS = [
  'PROPERTY_ADMIN', 'FRONT_DESK', 'F_AND_B_MANAGER', 'KITCHEN',
  'RUNNER', 'HOUSEKEEPING', 'CONCIERGE', 'READ_ONLY',
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export interface SystemRole {
  key: SystemRoleKey;
  name: string;
  permissions: readonly Permission[];
}

export const SYSTEM_ROLES: Readonly<Record<SystemRoleKey, SystemRole>> = {
  PROPERTY_ADMIN: {
    key: 'PROPERTY_ADMIN',
    name: 'Property admin',
    // The only role with role:manage, payment:refund, folio:adjust and
    // property:access_policy.
    permissions: PERMISSIONS,
  },

  FRONT_DESK: {
    key: 'FRONT_DESK',
    name: 'Front desk',
    permissions: [
      'property:read',
      'room:read', 'qr:read', 'qr:regenerate',
      'stay:read', 'stay:check_in', 'stay:check_out', 'stay:update',
      'guest:read', 'guest:update', 'guest:vouch',
      'folio:read', 'folio:post_charge', 'folio:settle',
      'payment:read', 'payment:capture',
      // A discount authority: ₹5,000 waived per stay, at will. Controlled by
      // audit rather than by an approval step — #7 already writes the actor and
      // the original fee to event_log, and a second approver at the front desk
      // at 11am on checkout day gets worked around rather than followed.
      'checkout_request:approve', 'checkout_request:override_fee',
      'order:read', 'request:read', 'poi:read',
    ],
  },

  F_AND_B_MANAGER: {
    key: 'F_AND_B_MANAGER',
    name: 'F&B manager',
    permissions: [
      'property:read',
      'catalog:read', 'catalog:manage', 'catalog:pricing', 'catalog:availability',
      'order:read', 'order:accept', 'order:reject', 'order:advance',
      'order:cancel', 'order:dispute',
      'analytics:read', 'shift:read',
    ],
  },

  KITCHEN: {
    key: 'KITCHEN',
    name: 'Kitchen',
    // Deliberately thin. This is an always-on shared screen in a hot kitchen —
    // the credential in the building most likely to be left logged in. No
    // pricing, no cancel. Reject IS granted: a kitchen that cannot say "we are
    // out of sole" accepts and then fails silently, which is worse for the
    // guest. `orders.rejection_reason` is required.
    permissions: [
      'catalog:read', 'catalog:availability',
      'order:read', 'order:accept', 'order:reject', 'order:advance',
      'shift:clock',
    ],
  },

  RUNNER: {
    key: 'RUNNER',
    name: 'Runner',
    permissions: [
      'order:read', 'order:advance',
      'request:read', 'request:advance',
      'room:read', 'shift:clock',
    ],
  },

  HOUSEKEEPING: {
    key: 'HOUSEKEEPING',
    name: 'Housekeeping',
    // assign/verify are granted although the 8 roles do not separate a
    // housekeeper from a floor lead. Auto-routing (§7) does the assigning, so
    // `assign` is only the manual override — and withholding it means every
    // reassignment escalates to the GM, which is the friction that gets a
    // product abandoned. Split into HOUSEKEEPING_LEAD when a property asks.
    permissions: [
      'request:read', 'request:advance', 'request:assign', 'request:verify',
      'room:read', 'shift:clock',
    ],
  },

  CONCIERGE: {
    key: 'CONCIERGE',
    name: 'Concierge',
    permissions: [
      'poi:read', 'poi:manage', 'itinerary:manage',
      'guest:read', 'request:read', 'request:advance', 'shift:clock',
    ],
  },

  READ_ONLY: {
    key: 'READ_ONLY',
    name: 'Read only',
    // Includes guest:read — right for an owner, more than an external
    // accountant needs. Revisit if a customer asks for a finance-only variant
    // rather than adding a ninth role for a hypothetical.
    permissions: [...ALL_READS, 'analytics:read', 'audit:read'],
  },
};

export function permissionsForRole(key: SystemRoleKey): readonly Permission[] {
  return SYSTEM_ROLES[key].permissions;
}
