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
