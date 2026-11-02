import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The mobile palette has not drifted from the Kesari guest theme. D-080, D-100.
 *
 * `mobile/lib/theme.ts` is a HAND-KEPT copy — React Native has no CSS custom
 * properties and no `color-mix()`, so the token file cannot be consumed there.
 * A copy with no test is a copy that drifts. This reads the token file's JSON
 * mirror and asserts that every colour the app takes straight from a token
 * still equals it.
 *
 * It lives in the WEB app's unit suite rather than the mobile package's
 * because this is where `pnpm test` runs on every change, and the failure that
 * matters is somebody editing the tokens — not somebody editing the app.
 */
const TOKENS_JSON = join(process.cwd(), 'design/tokens/innstant-themes.json');
const THEME_CSS = join(process.cwd(), 'src/styles/theme.css');
const MOBILE_THEME = join(process.cwd(), 'mobile/lib/theme.ts');

function kesariTokens(): Record<string, string> {
  return (JSON.parse(readFileSync(TOKENS_JSON, 'utf8')) as {
    guest: Record<string, Record<string, string>>;
  }).guest.kesari!;
}

/**
 * The numeric members of a named `export const X = { … } as const` block.
 *
 * Empty when the block is absent, rather than throwing: an assertion at
 * collection time fails the whole FILE, which would take the palette tests
 * above down with it and hide the drift they are here to name.
 */
function mobileNumbers(name: string): Map<string, number> {
  const source = readFileSync(MOBILE_THEME, 'utf8');
  const start = source.indexOf(`export const ${name}`);
  const found = new Map<string, number>();
  if (start < 0) return found;

  const block = source.slice(start, source.indexOf('as const', start));
  for (const match of block.matchAll(/(\w+):\s*(\d+)/g)) {
    found.set(match[1]!, Number(match[2]));
  }
  return found;
}

function mobileColors(): Map<string, string> {
  const source = readFileSync(MOBILE_THEME, 'utf8');
  const block = source.slice(source.indexOf('export const colors'), source.indexOf('} as const'));

  const found = new Map<string, string>();
  for (const line of block.split('\n')) {
    const match = line.match(/^\s*(\w+):\s*'([^']+)'/);
    if (match) found.set(match[1]!, match[2]!);
  }
  return found;
}

/**
 * Which mobile name is which Kesari token. The names left out (raised,
 * lineSoft, lineFaint, accentHover, accentTint, the tints, the note pair) are
 * color-mix() steps on the web and resolved literals here.
 */
const MAPPING: Record<string, string> = {
  paperDeep: 'g-page',
  paper: 'g-page',
  card: 'g-card',
  line: 'g-line',
  accent: 'g-accent',
  accentInk: 'g-on-accent',
  ink: 'g-ink',
  inkSecondary: 'g-ink-2',
  inkDim: 'g-ink-3',
  inkFaint: 'g-ink-3',
  positive: 'g-ready',
  attention: 'g-accent',
  critical: 'g-late',
};

describe('the mobile palette tracks the Kesari guest theme', () => {
  const tokens = kesariTokens();
  const app = mobileColors();

  it.each(Object.entries(MAPPING))('%s matches --%s', (mobileName, token) => {
    const expected = tokens[token];
    expect(expected, `--${token} is missing from the Kesari theme`).toBeDefined();
    expect(
      app.get(mobileName)?.toUpperCase(),
      `mobile/lib/theme.ts ${mobileName} has drifted from --${token}`,
    ).toBe(expected!.toUpperCase());
  });
});


/**
 * The motion tokens have not drifted either. D-080.
 *
 * Same argument as the palette above, one axis over. RN has no custom
 * properties, so `--dur-mid` cannot be consumed there and `mobile/lib/theme.ts`
 * keeps numbers — which is the only reason a component is allowed to animate
 * at all without hardcoding a duration, and the reason CLAUDE.md's rule about
 * never writing one inline still holds on the app side.
 *
 * These live on `:root` rather than inside `[data-theme='kesari']`: motion is
 * not a palette and does not change per property.
 */
function cssDurations(): Map<string, number> {
  const css = readFileSync(THEME_CSS, 'utf8');
  const found = new Map<string, number>();
  for (const match of css.matchAll(/--dur-([\w-]+):\s*(\d+)ms;/g)) {
    found.set(match[1]!, Number(match[2]));
  }
  return found;
}

describe('the mobile motion tokens track theme.css', () => {
  const css = cssDurations();
  const app = mobileNumbers('duration');

  it('exports the durations at all', () => {
    expect(app.size, 'mobile/lib/theme.ts has no `export const duration`').toBeGreaterThan(0);
  });

  it.each([
    ['fast', 'fast'],
    ['base', 'base'],
    ['mid', 'mid'],
    ['slow', 'slow'],
    ['slower', 'slower'],
  ])('%s matches --dur-%s', (mobileName, cssName) => {
    const expected = css.get(cssName);
    expect(expected, `--dur-${cssName} is missing from theme.css`).toBeDefined();
    expect(
      app.get(mobileName),
      `mobile/lib/theme.ts duration.${mobileName} has drifted from --dur-${cssName}`,
    ).toBe(expected);
  });

  /**
   * And nothing invented. A duration in the app with no counterpart on the web
   * is a motion decision made in one place and not the other, which is exactly
   * what this file exists to catch for colour.
   */
  it('names no duration the web does not have', () => {
    for (const name of app.keys()) {
      expect(css.has(name), `duration.${name} has no --dur-${name} in theme.css`).toBe(true);
    }
  });
});
