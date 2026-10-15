import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The mobile palette has not drifted from `theme.css`. D-080.
 *
 * `mobile/lib/theme.ts` is a HAND-KEPT copy — React Native has no CSS custom
 * properties and no `color-mix()`, so the web file cannot be consumed there,
 * and D-023 deliberately removed the token generator rather than keeping a
 * build step for one consumer.
 *
 * A copy with no test is a copy that drifts. This reads both files and asserts
 * that every colour the app names still equals the `[data-theme='kesari']`
 * primitive it was taken from. Change one without the other and this fails,
 * naming the value.
 *
 * It lives in the WEB app's unit suite rather than the mobile package's
 * because this is where `pnpm test` runs on every change, and the failure that
 * matters is somebody editing theme.css — not somebody editing the app.
 */
const THEME_CSS = join(process.cwd(), 'src/styles/theme.css');
const MOBILE_THEME = join(process.cwd(), 'mobile/lib/theme.ts');

/** The primitives declared inside `[data-theme='kesari'] { … }`. */
function kesariPrimitives(): Map<string, string> {
  const css = readFileSync(THEME_CSS, 'utf8');
  const start = css.indexOf("[data-theme='kesari']");
  expect(start, 'theme.css must declare a [data-theme=\'kesari\'] block').toBeGreaterThan(-1);

  // The first block only — `[data-theme='kesari'],` also appears later in the
  // "Derived" grouping, and those are aliases rather than primitives.
  const block = css.slice(start, css.indexOf('}', start));

  const found = new Map<string, string>();
  for (const line of block.split('\n')) {
    const match = line.match(/^\s*(--[\w-]+):\s*([^;]+);/);
    if (match) found.set(match[1]!, match[2]!.trim());
  }
  return found;
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

/** Which mobile name came from which CSS custom property. */
const MAPPING: Record<string, string> = {
  paperDeep: '--paper-deep',
  paper: '--paper',
  card: '--white',
  raised: '--paper-raised',
  line: '--line',
  lineSoft: '--line-soft',
  lineFaint: '--line-faint',
  accent: '--teal-600',
  accentHover: '--teal-700',
  accentTint: '--teal-tint',
  accentInk: '--accent-ink',
  ink: '--ink',
  inkSecondary: '--ink-secondary',
  positive: '--status-positive',
  attention: '--status-attention',
  critical: '--status-critical',
  attentionTint: '--status-attention-tint',
  criticalTint: '--status-critical-tint',
  noteBg: '--note-bg',
  noteInk: '--note-ink',
};

describe('the mobile palette tracks theme.css', () => {
  const css = kesariPrimitives();
  const app = mobileColors();

  it.each(Object.entries(MAPPING))('%s matches %s', (mobileName, cssName) => {
    const expected = css.get(cssName);
    expect(expected, `${cssName} is missing from theme.css`).toBeDefined();
    expect(
      app.get(mobileName)?.toUpperCase(),
      `mobile/lib/theme.ts ${mobileName} has drifted from ${cssName}`,
    ).toBe(expected!.toUpperCase());
  });

  /**
   * The two that are computed on the web and literal here.
   *
   * `--ink-dim` and `--ink-faint` are `color-mix(in srgb, var(--ink) N%,
   * transparent)`, which RN cannot evaluate. The app stores the resolved rgba.
   * This checks the PERCENTAGES still match — if somebody retunes the web's
   * alpha, the app's literal is wrong and this says so.
   */
  it.each([
    ['inkDim', '--ink-dim', 0.62],
    ['inkFaint', '--ink-faint', 0.45],
  ])('%s resolves theme.css %s', (mobileName, cssName, alpha) => {
    const declared = css.get(cssName);
    expect(declared, `${cssName} is missing`).toBeDefined();
    expect(
      declared,
      `${cssName} is no longer a color-mix of --ink at ${alpha * 100}%`,
    ).toMatch(new RegExp(`var\\(--ink\\)\\s+${alpha * 100}%`));

    const ink = css.get('--ink')!;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
    expect(app.get(mobileName)).toBe(`rgba(${r}, ${g}, ${b}, ${alpha})`);
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
