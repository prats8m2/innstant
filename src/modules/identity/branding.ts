import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';
import mixPlugin from 'colord/plugins/mix';
import { ValidationError } from '@/lib/errors';

extend([a11yPlugin, mixPlugin]);

/**
 * A hotel's own face on the guest app: an accent, a logo, a cover photograph.
 * D-087, and the runtime half of D-016 — "a second hotel is a palette swap" —
 * which until now had a jsonb column and nothing that wrote it.
 *
 * Pure: no database, no clock. The identity service stores what `cleanBranding`
 * returns and the guest layouts render what `brandingStyle` returns.
 *
 * ─── Why only an accent ────────────────────────────────────────────────────
 *
 * The guest theme is a dark indigo ground with one warm accent (theme.css,
 * `[data-theme='kesari']`). A hotel choosing its ground, its text and its
 * accent independently is three colours whose contrast with each other nobody
 * checks, and the first hotel to pick a grey accent on the indigo ships an
 * unreadable "Place order" button. One colour, validated against the ground it
 * will sit on, is the whole of what can be offered without a designer.
 */

/**
 * The five guest themes in design/tokens/innstant-themes.css (D-100). A
 * property picks one; its colours are the token file's, each checked for AA
 * there and in theme-tokens.test.ts. The key is what `data-guest-theme`
 * carries, and the console's accent follows it through `data-accent`.
 */
export const GUEST_THEMES = [
  { key: 'kesari', name: 'Kesari Night', origin: 'Udaipur · indigo and saffron' },
  { key: 'pichola', name: 'Pichola Lake', origin: 'Lakeside · deep water, silver-green' },
  { key: 'gulabi', name: 'Gulabi', origin: 'Jaipur · rose plum and pink' },
  { key: 'mehendi', name: 'Mehendi', origin: 'Garden · henna green and lime' },
  { key: 'sandstone', name: 'Jaisalmer Sandstone', origin: 'Desert · the daylight theme' },
] as const;

export type GuestThemeKey = (typeof GUEST_THEMES)[number]['key'];

export const DEFAULT_GUEST_THEME: GuestThemeKey = 'kesari';

export function isGuestTheme(value: unknown): value is GuestThemeKey {
  return GUEST_THEMES.some((theme) => theme.key === value);
}

export interface PropertyBranding {
  /** One of GUEST_THEMES. Every colour on the guest's screens follows it. */
  theme: GuestThemeKey;
  /**
   * A theme picked on the Branding screen and not yet published (D-102).
   * Guests never see it — nothing on a guest screen reads this field — and
   * it is null whenever it would equal `theme`, so "is there a draft" is one
   * null check rather than a comparison every caller has to remember.
   */
  draftTheme: GuestThemeKey | null;
  /**
   * `#RRGGBB`, from before themes (D-087). Only honoured on Kesari, the theme
   * it was checked against; any other theme brings its own accent. Read for
   * the properties that have one; no screen offers it any more (D-102), and
   * publishing a theme clears it, so what the preview shows is what goes live.
   */
  accent: string | null;
  /** https only. Shown in place of the wordmark on the guest home. */
  logoUrl: string | null;
  /** https only. Behind the arch on the guest home. */
  coverUrl: string | null;
}

export const NO_BRANDING: PropertyBranding = {
  theme: DEFAULT_GUEST_THEME, draftTheme: null, accent: null, logoUrl: null, coverUrl: null,
};

/**
 * The Kesari guest theme's page, card and two inks, as
 * design/tokens/innstant-themes.css declares them (D-100). Duplicated by
 * necessity — the check runs on the server, before any stylesheet — and
 * `branding.test.ts` reads the token file to keep them in step, the same
 * arrangement the layout's `themeColor` has with theme-discipline.test.ts.
 */
export const GUEST_GROUND = '#0A1220';
export const GUEST_CARD = '#1B2B45';
export const GUEST_INK_DARK = '#1A1206';
export const GUEST_INK_LIGHT = '#F4ECDD';

/** WCAG 2.2: 3:1 for a component and its large text, 4.5:1 for body text. */
const ON_GROUND_MIN = 3;
const INK_ON_ACCENT_MIN = 4.5;

/** Read whatever is in the column. Anything malformed is simply absent. */
export function readBranding(raw: unknown): PropertyBranding {
  if (!raw || typeof raw !== 'object') return NO_BRANDING;
  const value = raw as Record<string, unknown>;
  const accent = typeof value.accent === 'string' && HEX.test(value.accent)
    ? value.accent.toUpperCase()
    : null;
  const url = (v: unknown) => (typeof v === 'string' && isHttpsUrl(v) ? v : null);
  const theme = isGuestTheme(value.theme) ? value.theme : DEFAULT_GUEST_THEME;
  const draftTheme = isGuestTheme(value.draftTheme) && value.draftTheme !== theme
    ? value.draftTheme
    : null;
  return { theme, draftTheme, accent, logoUrl: url(value.logoUrl), coverUrl: url(value.coverUrl) };
}

/**
 * What the screen sends, made safe to store — or refused with a sentence the
 * manager can act on. An accent is refused rather than adjusted: quietly
 * darkening somebody's brand colour is a decision about their brand.
 */
export function cleanBranding(input: {
  theme?: string | null; draftTheme?: string | null;
  accent?: string | null; logoUrl?: string | null; coverUrl?: string | null;
}): PropertyBranding {
  const theme = input.theme?.trim() || DEFAULT_GUEST_THEME;
  if (!isGuestTheme(theme)) {
    throw new ValidationError(`There is no guest theme called "${theme}".`);
  }
  const draft = input.draftTheme?.trim() || null;
  if (draft !== null && !isGuestTheme(draft)) {
    throw new ValidationError(`There is no guest theme called "${draft}".`);
  }
  const accent = input.accent?.trim() ? input.accent.trim() : null;
  if (accent) {
    if (!HEX.test(accent)) {
      throw new ValidationError('An accent is a hex colour, like #E9A227.');
    }
    const check = accentContrast(accent);
    if (check.onGround < ON_GROUND_MIN) {
      throw new ValidationError(
        `${accent.toUpperCase()} is too dark to read on the guest app's indigo `
        + `(${check.onGround.toFixed(1)}:1, it needs ${ON_GROUND_MIN}:1). Try a lighter shade.`,
      );
    }
    if (check.inkOnAccent < INK_ON_ACCENT_MIN) {
      throw new ValidationError(
        `Text on a ${accent.toUpperCase()} button would be hard to read `
        + `(${check.inkOnAccent.toFixed(1)}:1, it needs ${INK_ON_ACCENT_MIN}:1). `
        + 'Pick a colour that is clearly light or clearly dark.',
      );
    }
  }

  return {
    theme,
    // A draft of the theme already live is no draft at all.
    draftTheme: draft === theme ? null : draft,
    accent: accent ? accent.toUpperCase() : null,
    logoUrl: cleanUrl(input.logoUrl, 'The logo'),
    coverUrl: cleanUrl(input.coverUrl, 'The cover photo'),
  };
}

export interface AccentContrast {
  /** The accent against the guest app's ground. */
  onGround: number;
  /** The better of the two inks on a button filled with the accent. */
  inkOnAccent: number;
  /** Which ink that is. */
  ink: 'dark' | 'light';
}

/** The numbers the screen shows beside the swatch, and the save refuses on. */
export function accentContrast(accent: string): AccentContrast {
  const color = colord(accent);
  const dark = color.contrast(GUEST_INK_DARK);
  const light = color.contrast(GUEST_INK_LIGHT);
  return {
    onGround: color.contrast(GUEST_GROUND),
    inkOnAccent: Math.max(dark, light),
    ink: dark >= light ? 'dark' : 'light',
  };
}

/**
 * The custom properties a branded guest page sets, on the element that wraps
 * it.
 *
 * Primitives AND the aliases built from them. A `var()` resolves where it is
 * declared (theme.css, "Derived"), so `--accent` computed on the
 * `[data-theme='kesari']` element would keep the saffron however many times a
 * descendant changed `--teal-600`. Redeclaring the aliases here is what makes
 * the swap reach every button.
 *
 * Hover goes LIGHTER, as it does everywhere on the dark ground.
 */
export function brandingStyle(branding: PropertyBranding): Record<string, string> {
  if (!branding.accent || branding.theme !== DEFAULT_GUEST_THEME) return {};
  const accent = colord(branding.accent);
  const hover = accent.mix('#FFFFFF', 0.18).toHex();
  const tint = accent.mix(GUEST_GROUND, 0.82).toHex();
  const { ink } = accentContrast(branding.accent);
  const inkValue = ink === 'dark' ? 'var(--paper)' : 'var(--ink)';

  return {
    '--teal-600': branding.accent,
    '--teal-700': hover,
    '--teal-tint': tint,
    '--accent': branding.accent,
    '--accent-hover': hover,
    '--accent-tint': tint,
    '--saffron': branding.accent,
    '--saffron-lit': hover,
    '--status-positive-tint': tint,
    '--accent-ink': inkValue,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && value.length <= 500;
  } catch {
    return false;
  }
}

function cleanUrl(value: string | null | undefined, label: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!isHttpsUrl(trimmed)) {
    throw new ValidationError(`${label} needs a full https:// address.`);
  }
  return trimmed;
}
