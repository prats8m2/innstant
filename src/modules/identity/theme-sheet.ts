import { colord, extend } from 'colord';
import a11yPlugin from 'colord/plugins/a11y';
import tokens from '../../../design/tokens/innstant-themes.json';
import { GUEST_THEMES, type GuestThemeKey } from './branding';

extend([a11yPlugin]);

/**
 * What the Branding screen says about each guest theme (D-102): its contrast
 * pairs, worked out from the token file, and the theme as CSS a developer can
 * copy.
 *
 * Pure, and read from `design/tokens/innstant-themes.json` — the hand-kept
 * mirror of the CSS that `theme-tokens.test.ts` holds equal to it — so the
 * numbers on the screen are the token file's numbers, not a third copy. The
 * screen itself never needs a colour value to paint a swatch: it sets
 * `data-guest-theme` on the swatch and reads `var(--g-*)`.
 */

type ConsoleMode = 'light' | 'dark';

interface TokenFile {
  guest: Record<GuestThemeKey, Record<string, string>>;
  console: Record<ConsoleMode, Record<string, string>>;
  consoleAccent: Record<ConsoleMode, Record<GuestThemeKey, Record<string, string>>>;
}

const TOKENS = tokens as unknown as TokenFile;

export interface ContrastRow {
  label: string;
  /** Token names without the dashes, `g-ink` — the screen paints with var(). */
  fg: string;
  bg: string;
  /** "12.1:1". */
  ratio: string;
  /** The floor this pair is held to: 4.5 for text, 3 for a large mark. */
  floor: number;
  verdict: 'AAA' | 'AA' | 'Fails';
}

export interface GuestThemeSheet {
  key: GuestThemeKey;
  name: string;
  origin: string;
  scheme: 'light' | 'dark';
  contrast: ContrastRow[];
  /** The console's accent for this theme, per appearance — "#0F766E". */
  consoleAccent: Record<ConsoleMode, string>;
  /** The theme's own block, as innstant-themes.css declares it. */
  guestCss: string;
  /** The console's block with this theme's accent, per appearance. */
  consoleCss: Record<ConsoleMode, string>;
}

/**
 * The pairs the board lists, in its order. Every one is text or a mark a
 * guest has to read on the surface it actually sits on.
 */
const PAIRS: ReadonlyArray<{ label: string; fg: string; bg: string; floor: number }> = [
  { label: 'Body text on page', fg: 'g-ink', bg: 'g-page', floor: 4.5 },
  { label: 'Secondary text on card', fg: 'g-ink-2', bg: 'g-card', floor: 4.5 },
  { label: 'Hint text on card', fg: 'g-ink-3', bg: 'g-card', floor: 4.5 },
  { label: 'Accent on page', fg: 'g-accent', bg: 'g-page', floor: 3 },
  { label: 'Button label on accent', fg: 'g-on-accent', bg: 'g-accent', floor: 4.5 },
  { label: '“Open / ready” on card', fg: 'g-ready', bg: 'g-card', floor: 4.5 },
  { label: '“Running late” on card', fg: 'g-late', bg: 'g-card', floor: 4.5 },
];

export function contrastFor(theme: GuestThemeKey): ContrastRow[] {
  const values = TOKENS.guest[theme];
  return PAIRS.map((pair) => {
    const ratio = colord(values[pair.fg]!).contrast(values[pair.bg]!);
    return {
      ...pair,
      ratio: `${ratio.toFixed(1)}:1`,
      verdict: ratio < pair.floor ? 'Fails' : ratio >= 7 ? 'AAA' : 'AA',
    };
  });
}

function block(selector: string, comment: string, values: Record<string, string>): string {
  const lines = Object.entries(values).map(([name, value]) => `  --${name}: ${value};`);
  return `/* ${comment} */\n${selector} {\n${lines.join('\n')}\n}`;
}

export function guestThemeSheets(): GuestThemeSheet[] {
  return GUEST_THEMES.map((theme) => {
    const guest = TOKENS.guest[theme.key];
    const consoleBlock = (mode: ConsoleMode) => block(
      `[data-console="${mode}"][data-accent="${theme.key}"]`,
      `Staff console · ${mode} · accent from ${theme.key}`,
      { ...TOKENS.console[mode], ...TOKENS.consoleAccent[mode][theme.key] },
    );
    return {
      key: theme.key,
      name: theme.name,
      origin: theme.origin,
      scheme: guest['g-scheme'] === 'light' ? 'light' : 'dark',
      contrast: contrastFor(theme.key),
      consoleAccent: {
        light: TOKENS.consoleAccent.light[theme.key].accent!,
        dark: TOKENS.consoleAccent.dark[theme.key].accent!,
      },
      guestCss: block(`[data-guest-theme="${theme.key}"]`, `Innstant · guest theme: ${theme.name}`, guest),
      consoleCss: { light: consoleBlock('light'), dark: consoleBlock('dark') },
    };
  });
}
