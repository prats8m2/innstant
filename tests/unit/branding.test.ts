import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  cleanBranding, readBranding, brandingStyle, accentContrast, NO_BRANDING,
  GUEST_GROUND, GUEST_CARD, GUEST_INK_DARK, GUEST_INK_LIGHT,
} from '@/modules/identity/branding';
import { cleanGuestInfo, dialable } from '@/modules/identity/guest-info';
import { contrastFor, guestThemeSheets } from '@/modules/identity/theme-sheet';

describe('branding', () => {
  it('keeps the guest palette constants in step with the Kesari tokens', () => {
    const css = readFileSync('design/tokens/innstant-themes.css', 'utf8');
    const block = css.slice(css.indexOf('[data-guest-theme="kesari"] {'));
    const value = (name: string) => block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))?.[1]?.toUpperCase();
    expect(value('--g-page')).toBe(GUEST_GROUND);
    expect(value('--g-card')).toBe(GUEST_CARD);
    expect(value('--g-on-accent')).toBe(GUEST_INK_DARK);
    expect(value('--g-ink')).toBe(GUEST_INK_LIGHT);
  });

  it('accepts the theme\'s own saffron, with dark text on it', () => {
    const cleaned = cleanBranding({ accent: '#e9a227' });
    expect(cleaned.accent).toBe('#E9A227');
    expect(accentContrast('#E9A227').ink).toBe('dark');
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
      .toEqual(NO_BRANDING);
  });

  it('reads a malformed column as no branding at all', () => {
    expect(readBranding(null)).toEqual(NO_BRANDING);
    expect(readBranding({ accent: 'red', logoUrl: 'javascript:alert(1)', draftTheme: 'neon' }))
      .toEqual(NO_BRANDING);
  });

  it('redeclares the aliases, not only the primitive', () => {
    const style = brandingStyle({ ...NO_BRANDING, accent: '#E9A227' });
    expect(style['--teal-600']).toBe('#E9A227');
    expect(style['--accent']).toBe('#E9A227');
    expect(style['--saffron']).toBe('#E9A227');
    expect(style['--accent-ink']).toBe('var(--paper)');
    expect(brandingStyle(NO_BRANDING)).toEqual({});
  });

  /** D-100: a theme brings its own accent; the old one was checked on Kesari's indigo. */
  it('honours a custom accent on Kesari only', () => {
    expect(brandingStyle({ ...NO_BRANDING, theme: 'sandstone', accent: '#E9A227' }))
      .toEqual({});
  });

  it('reads a theme it knows, and Kesari for anything else', () => {
    expect(readBranding({ theme: 'gulabi' }).theme).toBe('gulabi');
    expect(readBranding({ theme: 'neon' }).theme).toBe('kesari');
    expect(readBranding({}).theme).toBe('kesari');
  });

  it('refuses to store a theme that does not exist', () => {
    expect(() => cleanBranding({ theme: 'neon' })).toThrow(/no guest theme/);
    expect(cleanBranding({ theme: 'pichola' }).theme).toBe('pichola');
  });

  /** D-102: picking a theme saves a draft; guests read `theme` only. */
  it('keeps a draft beside the live theme, and never a draft of the live one', () => {
    expect(readBranding({ theme: 'kesari', draftTheme: 'gulabi' }))
      .toMatchObject({ theme: 'kesari', draftTheme: 'gulabi' });
    expect(readBranding({ theme: 'gulabi', draftTheme: 'gulabi' }).draftTheme).toBeNull();
    expect(cleanBranding({ theme: 'kesari', draftTheme: 'mehendi' }).draftTheme).toBe('mehendi');
    expect(cleanBranding({ theme: 'mehendi', draftTheme: 'mehendi' }).draftTheme).toBeNull();
    expect(cleanBranding({ theme: 'kesari', draftTheme: '' }).draftTheme).toBeNull();
    expect(() => cleanBranding({ draftTheme: 'neon' })).toThrow(/no guest theme/);
  });

  it('a draft never reaches a guest screen', () => {
    // brandingStyle is what the guest layouts set; it reads the live theme only.
    expect(brandingStyle({ ...NO_BRANDING, accent: '#E9A227', draftTheme: 'sandstone' })['--accent'])
      .toBe('#E9A227');
  });
});

describe('theme sheets', () => {
  it('covers every theme, with the token file\'s values in its CSS', () => {
    const css = readFileSync('design/tokens/innstant-themes.css', 'utf8');
    const sheets = guestThemeSheets();
    expect(sheets.map((s) => s.key)).toEqual(['kesari', 'pichola', 'gulabi', 'mehendi', 'sandstone', 'midnight']);
    for (const sheet of sheets) {
      const block = css.slice(css.indexOf(`[data-guest-theme="${sheet.key}"] {`));
      const page = block.match(/--g-page:\s*(#[0-9A-Fa-f]{6})/)?.[1];
      expect(sheet.guestCss).toContain(`--g-page: ${page};`);
      expect(sheet.consoleCss.light).toContain(`[data-console="light"][data-accent="${sheet.key}"]`);
      expect(sheet.consoleCss.dark).toContain(`--accent: ${sheet.consoleAccent.dark};`);
    }
  });

  it('works contrast out with the WCAG formula, and every pair holds', () => {
    // Kesari's ink on its page, by hand: #F4ECDD on #0A1220.
    expect(contrastFor('kesari')[0]).toMatchObject({ label: 'Body text on page', fg: 'g-ink', bg: 'g-page' });
    expect(Number(contrastFor('kesari')[0]!.ratio.replace(':1', ''))).toBeGreaterThan(15);
    for (const sheet of guestThemeSheets()) {
      for (const row of sheet.contrast) {
        expect(row.verdict, `${sheet.key} · ${row.label} ${row.ratio}`).not.toBe('Fails');
      }
    }
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
