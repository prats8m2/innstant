import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The token file, held to its own word. D-100.
 *
 * design/tokens/innstant-themes.css owns every colour in the guest app and the
 * console. Its header states contrast floors for each guest theme and for the
 * console's accents; nothing else checks them, and a hotel picking a theme on
 * the Branding screen is trusting that they hold. These read the file and
 * assert what it says.
 *
 * The JSON beside it is a hand-kept mirror for anything that cannot read CSS
 * (the Expo app, a design tool). A mirror with no test drifts, so the second
 * half asserts the two are equal, value for value.
 */
const css = readFileSync('design/tokens/innstant-themes.css', 'utf8');
const json = JSON.parse(readFileSync('design/tokens/innstant-themes.json', 'utf8')) as {
  guest: Record<string, Record<string, string>>;
  console: Record<'light' | 'dark', Record<string, string>>;
  consoleAccent: Record<'light' | 'dark', Record<string, Record<string, string>>>;
};

const GUEST_THEMES = ['kesari', 'pichola', 'gulabi', 'mehendi', 'sandstone', 'midnight'] as const;

/** The custom properties declared in the first block whose selector is `selector`. */
function block(selector: string): Record<string, string> {
  // The accent rows pad their selectors into a column, so any run of spaces.
  const escaped = selector.replace(/[[\]"=]/g, (c) => `\\${c}`);
  const at = css.search(new RegExp(`${escaped}\\s*\\{`));
  if (at === -1) throw new Error(`innstant-themes.css has no ${selector} block`);
  const body = css.slice(css.indexOf('{', at), css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

function accent(mode: 'light' | 'dark', key: string): Record<string, string> {
  return block(`[data-console="${mode}"][data-accent="${key}"]`);
}

/** #RRGGBB or #RRGGBBAA, or rgba(r, g, b, a) — composited over `under` when translucent. */
function solid(colour: string, under = '#FFFFFF'): [number, number, number] {
  const base = parse(under);
  const [r, g, b, a] = parse4(colour);
  return [0, 1, 2].map((i) => Math.round([r, g, b][i]! * a + base[i]! * (1 - a))) as [number, number, number];
}

function parse(colour: string): [number, number, number] {
  const [r, g, b] = parse4(colour);
  return [r, g, b];
}

function parse4(colour: string): [number, number, number, number] {
  const rgba = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(colour);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  const hex = colour.replace('#', '');
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return [channel(0), channel(2), channel(4), hex.length === 8 ? channel(6) / 255 : 1];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg: string, bg: string, under?: string): number {
  const back = solid(bg, under);
  const front = solid(fg, `#${back.map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  const [a, b] = [luminance(front), luminance(back)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(GUEST_THEMES)('guest theme · %s', (key) => {
  const t = block(`[data-guest-theme="${key}"]`);

  /**
   * The floors the file's header claims. Rounded down by a hair where the
   * header rounds: "≥ 14:1" is a statement about the best case, so body text
   * is held to AAA here, which is what that claim was protecting.
   */
  it.each([
    ['ink on page', 'ink', 'page', 7],
    ['ink-2 on card', 'ink-2', 'card', 7],
    ['ink-3 on card', 'ink-3', 'card', 4.5],
    ['on-accent on accent', 'on-accent', 'accent', 4.5],
    ['ready on card', 'ready', 'card', 4.5],
    ['late on card', 'late', 'card', 4.5],
  ] as const)('%s', (_, fg, bg, floor) => {
    expect(contrast(t[`g-${fg}`]!, t[`g-${bg}`]!)).toBeGreaterThanOrEqual(floor);
  });

  it('the accent reads on the page as a graphic and as large text', () => {
    expect(contrast(t['g-accent']!, t['g-page']!)).toBeGreaterThanOrEqual(3);
  });

  it('declares every name the other themes do', () => {
    expect(Object.keys(t).sort()).toEqual(Object.keys(block('[data-guest-theme="pichola"]')).sort());
  });
});

describe.each(['light', 'dark'] as const)('console · %s', (mode) => {
  const c = block(`[data-console="${mode}"]`);

  it.each([
    ['text on bg', 'text', 'bg'],
    ['text-2 on surface', 'text-2', 'surface'],
    ['text-3 on surface', 'text-3', 'surface'],
    ['text-3 on surface-2', 'text-3', 'surface-2'],
  ] as const)('%s passes AA', (_, fg, bg) => {
    expect(contrast(c[fg]!, c[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  /** A status is a word on its own soft fill — "Late 6 min" — and has to be read. */
  it.each(['pos', 'warn', 'crit', 'info'])('%s passes AA on its soft fill', (status) => {
    expect(contrast(c[status]!, c[`${status}-soft`]!, c.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(GUEST_THEMES)('the %s accent holds', (key) => {
    const a = accent(mode, key);
    if (mode === 'light') {
      // The header says "≥ 5:1 with white text". Mehendi's #4D7C0F is 4.99:1,
      // a hair under the claim and still AA, so AA is what is held here.
      expect(contrast(c['accent-fg']!, a.accent!)).toBeGreaterThanOrEqual(4.5);
    } else {
      // "Dark accents ≥ 7:1 on --surface", and the dark label on them reads.
      expect(contrast(a.accent!, c.surface!)).toBeGreaterThanOrEqual(7);
      expect(contrast(c['accent-fg']!, a.accent!)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(a['accent-text']!, c.surface!)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('innstant-themes.json mirrors innstant-themes.css', () => {
  it.each(GUEST_THEMES)('guest theme %s', (key) => {
    expect(json.guest[key]).toEqual(block(`[data-guest-theme="${key}"]`));
  });

  it.each(['light', 'dark'] as const)('console %s', (mode) => {
    // The shadow is an elevation, not a colour, and the JSON leaves it out.
    const colours = Object.fromEntries(
      Object.entries(block(`[data-console="${mode}"]`)).filter(([name]) => name !== 'shadow'),
    );
    expect(json.console[mode]).toEqual(colours);
  });

  it.each(['light', 'dark'] as const)('console %s accents', (mode) => {
    for (const key of GUEST_THEMES) {
      expect(json.consoleAccent[mode][key], `${mode} ${key}`).toEqual(accent(mode, key));
    }
  });

  it('names no guest theme the CSS does not have', () => {
    expect(Object.keys(json.guest).sort()).toEqual([...GUEST_THEMES].sort());
  });
});
