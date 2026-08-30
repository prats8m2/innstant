/**
 * Access tiers. D-012 and CLAUDE.md #9.
 *
 * READ D-012 BEFORE CHANGING ANYTHING HERE. The obvious implementation —
 * verify on scan — is the one that was explicitly built, rejected and removed.
 * A guest who cannot see a menu without a login does not come back.
 *
 * Verification exists for FRAUD, not identity. A QR sticker is photographable
 * from a corridor, a lift, or a Google review photo. If a scan alone can post
 * ₹4,000 to room 214, the hotel eats it. Browsing costs the hotel nothing, so
 * browsing is never gated.
 */
export const ACCESS_TIERS = ['BROWSE', 'REQUEST', 'CHARGE', 'FULL'] as const;
export type AccessTier = (typeof ACCESS_TIERS)[number];

const RANK: Record<AccessTier, number> = { BROWSE: 0, REQUEST: 1, CHARGE: 2, FULL: 3 };

export function tierAtLeast(actual: AccessTier, required: AccessTier): boolean {
  return RANK[actual] >= RANK[required];
}

/**
 * What each tier may do. This table is the product decision, written down.
 *
 *  BROWSE   — see the property, the menu, prices, POIs. Costs the hotel nothing.
 *  REQUEST  — the DEFAULT for a bare scan. Everything in BROWSE, plus free
 *             service requests and calling a staff member. Still costs nothing
 *             a fraudster would want.
 *  CHARGE   — anything that posts money to the room. This is the boundary the
 *             one verification prompt defends.
 *  FULL     — CHARGE plus the folio, checkout and stay details. Verified guests
 *             only; this is where another guest's PII would be.
 */
export const TIER_CAPABILITIES: Record<AccessTier, readonly string[]> = {
  BROWSE:  ['view_property', 'view_menu', 'view_pois'],
  REQUEST: ['view_property', 'view_menu', 'view_pois', 'free_request', 'call_staff'],
  CHARGE:  ['view_property', 'view_menu', 'view_pois', 'free_request', 'call_staff',
            'place_order', 'chargeable_request'],
  FULL:    ['view_property', 'view_menu', 'view_pois', 'free_request', 'call_staff',
            'place_order', 'chargeable_request', 'view_folio', 'request_checkout'],
};

/**
 * The tier an action needs. Anything that moves money is CHARGE; anything that
 * shows money or another person's stay is FULL.
 */
export const ACTION_TIERS = {
  view_menu: 'BROWSE',
  view_pois: 'BROWSE',
  free_request: 'REQUEST',
  call_staff: 'REQUEST',
  place_order: 'CHARGE',
  chargeable_request: 'CHARGE',
  view_folio: 'FULL',
  request_checkout: 'FULL',
} as const satisfies Record<string, AccessTier>;

export type GuestAction = keyof typeof ACTION_TIERS;

export function tierForAction(action: GuestAction): AccessTier {
  return ACTION_TIERS[action];
}
