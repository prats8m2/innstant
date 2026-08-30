import { describe, it, expect } from 'vitest';
import { tierAtLeast, tierForAction, TIER_CAPABILITIES, ACCESS_TIERS } from './tiers';

/**
 * D-012 encoded as assertions. If someone "tidies" the defaults, these fail.
 */
describe('access tiers · D-012', () => {
  it('REQUEST — the default for a bare scan — can browse and call staff', () => {
    // #9: menus, prices, POIs and free service calls must work with zero
    // screens in the way.
    for (const cap of ['view_menu', 'view_pois', 'free_request', 'call_staff']) {
      expect(TIER_CAPABILITIES.REQUEST, cap).toContain(cap);
    }
  });

  it('REQUEST cannot place an order — that is the boundary the prompt defends', () => {
    expect(TIER_CAPABILITIES.REQUEST).not.toContain('place_order');
    expect(tierAtLeast('REQUEST', 'CHARGE')).toBe(false);
  });

  it('REQUEST cannot see the folio — that is another guest\'s money', () => {
    expect(TIER_CAPABILITIES.REQUEST).not.toContain('view_folio');
  });

  it('browsing actions need no more than BROWSE', () => {
    expect(tierForAction('view_menu')).toBe('BROWSE');
    expect(tierForAction('view_pois')).toBe('BROWSE');
  });

  it('anything that moves money needs CHARGE', () => {
    expect(tierForAction('place_order')).toBe('CHARGE');
    expect(tierForAction('chargeable_request')).toBe('CHARGE');
  });

  it('anything that shows money or the stay needs FULL', () => {
    expect(tierForAction('view_folio')).toBe('FULL');
    expect(tierForAction('request_checkout')).toBe('FULL');
  });

  it('tiers are ordered and each includes everything below it', () => {
    for (let i = 0; i < ACCESS_TIERS.length; i += 1) {
      for (let j = 0; j <= i; j += 1) {
        expect(tierAtLeast(ACCESS_TIERS[i]!, ACCESS_TIERS[j]!)).toBe(true);
      }
      const lower = ACCESS_TIERS.slice(0, i);
      for (const l of lower) {
        for (const cap of TIER_CAPABILITIES[l]) {
          expect(TIER_CAPABILITIES[ACCESS_TIERS[i]!], `${ACCESS_TIERS[i]} ⊇ ${l}`).toContain(cap);
        }
      }
    }
  });
});
