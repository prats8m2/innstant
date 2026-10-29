import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  cleanBranding, readBranding, brandingStyle, accentContrast, BRAND_PRESETS,
  GUEST_GROUND, GUEST_CARD, GUEST_INK_DARK, GUEST_INK_LIGHT,
} from '@/modules/identity/branding';
import { cleanGuestInfo, dialable } from '@/modules/identity/guest-info';

describe('branding', () => {
  it('keeps the guest palette constants in step with theme.css', () => {
    const css = readFileSync('src/styles/theme.css', 'utf8');
    const block = css.slice(css.indexOf("[data-theme='kesari'] {"));
    const value = (name: string) => block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1]?.toUpperCase();
    expect(value('--paper')).toBe(GUEST_GROUND);
    expect(value('--white')).toBe(GUEST_CARD);
    expect(value('--accent-ink')).toBe(GUEST_INK_DARK);
    expect(value('--ink')).toBe(GUEST_INK_LIGHT);
  });

  it('accepts the theme\'s own saffron, with dark text on it', () => {
    const cleaned = cleanBranding({ accent: '#e9a227' });
    expect(cleaned.accent).toBe('#E9A227');
    expect(accentContrast('#E9A227').ink).toBe('dark');
  });

  it('offers only presets that pass its own check', () => {
    for (const preset of BRAND_PRESETS) {
      expect(() => cleanBranding({ accent: preset.hex }), preset.name).not.toThrow();
    }
  });

  it('refuses an accent too dark to read on the indigo', () => {
    expect(() => cleanBranding({ accent: '#1F2A44' })).toThrow(/too dark/);
  });

  it('refuses an accent no ink is readable on', () => {
    // Mid-grey clears 3:1 on the indigo but neither ink reaches 4.5:1 on it.
    const check = accentContrast('#767676');
    expect(check.onGround).toBeGreaterThanOrEqual(3);
    expect(check.inkOnAccent).toBeLessThan(4.5);
    expect(() => cleanBranding({ accent: '#767676' })).toThrow(/hard to read/);
  });

  it('refuses anything that is not a six-digit hex', () => {
    expect(() => cleanBranding({ accent: 'orange' })).toThrow(/hex colour/);
    expect(() => cleanBranding({ accent: '#fff' })).toThrow(/hex colour/);
  });

  it('wants https for pictures and stores blanks as nothing', () => {
    expect(() => cleanBranding({ logoUrl: 'http://example.com/logo.png' })).toThrow(/https/);
    expect(cleanBranding({ accent: ' ', logoUrl: '', coverUrl: null }))
      .toEqual({ accent: null, logoUrl: null, coverUrl: null });
  });

  it('reads a malformed column as no branding at all', () => {
    expect(readBranding(null)).toEqual({ accent: null, logoUrl: null, coverUrl: null });
    expect(readBranding({ accent: 'red', logoUrl: 'javascript:alert(1)' }))
      .toEqual({ accent: null, logoUrl: null, coverUrl: null });
  });

  it('redeclares the aliases, not only the primitive', () => {
    const style = brandingStyle({ accent: '#E9A227', logoUrl: null, coverUrl: null });
    expect(style['--teal-600']).toBe('#E9A227');
    expect(style['--accent']).toBe('#E9A227');
    expect(style['--saffron']).toBe('#E9A227');
    expect(style['--accent-ink']).toBe('var(--paper)');
    expect(brandingStyle({ accent: null, logoUrl: null, coverUrl: null })).toEqual({});
  });
});

describe('guest info', () => {
  it('stores blanks as null and keeps what was typed', () => {
    const info = cleanGuestInfo({
      contactPhone: ' +91 294 242 0000 ', wifiNetwork: 'Kesari Guest', checkOutTime: '11:00', city: '',
    });
    expect(info.contactPhone).toBe('+91 294 242 0000');
    expect(info.wifiNetwork).toBe('Kesari Guest');
    expect(info.checkOutTime).toBe('11:00');
    expect(info.city).toBeNull();
    expect(info.wifiPassword).toBeNull();
  });

  it('refuses a time that is not HH:MM, and a phone that is not a phone', () => {
    expect(() => cleanGuestInfo({ checkInTime: '2pm' })).toThrow(/time like 14:00/);
    expect(() => cleanGuestInfo({ checkInTime: '24:00' })).toThrow(/time like 14:00/);
    expect(() => cleanGuestInfo({ contactPhone: 'call us' })).toThrow(/phone number/);
    expect(() => cleanGuestInfo({ contactEmail: 'desk@' })).toThrow(/email/);
  });

  it('turns a typed number into what tel: and wa.me want', () => {
    expect(dialable('+91 (294) 242-0000')).toEqual({ tel: '+912942420000', whatsapp: '912942420000' });
  });
});
