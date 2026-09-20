import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * WCAG AA contrast, asserted — for BOTH palettes.
 *
 * design/README.md called for contrast to be validated at save time by the
 * token build; D-023 removed that build, so the check lives here instead of
 * being deferred. It has already caught three real bugs: `--text-muted` mapped
 * to a BORDER colour, giving 2.39:1 on the card surface; `--ink-faint` carrying
 * the dark theme's 45% alpha onto a light ground at 2.96:1; and the guest
 * theme's positive tone at 4.06:1 on a raised card. None of the three is
 * visible to someone with good eyes on a good screen, and all three are
 * unreadable to plenty of the 30–55 year-old guests this product is for, in a
 * dim hotel room.
 *
 * ─── Why it runs twice ─────────────────────────────────────────────────────
 *
 * D-050 gave the product two themes: the staff console on `:root`, and the
 * guest app's Kesari under `[data-theme='kesari']`; the marketing site added a
 * third, `[data-theme='innstant']`. The guest one is the theme
 * somebody reads at 9:40pm on their own phone, which is the harder case and the
 * one this file was originally written for. Testing only the default would
 * leave it uncovered, so the same suite runs over each palette's own grounds.
 */
const theme = readFileSync('src/styles/theme.css', 'utf8');

/**
 * One selector's declaration block.
 *
 * Blocks are read individually rather than by slicing the file, because there
 * are three of them now and "everything before the dark block" stopped meaning
 * anything the moment a third palette was added.
 */
function blockFor(selector: string): string {
  const at = theme.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`theme.css has no ${selector} block`);
  const end = theme.indexOf('\n}', at);
  return theme.slice(at, end);
}

interface Palette {
  name: string;
  css: string;
  /** Whether this palette splits attention into a text tone and a graphic. */
  splitsAttention: boolean;
}

const PALETTES: Palette[] = [
  { name: 'console', css: blockFor(':root'), splitsAttention: true },
  { name: 'kesari', css: blockFor("[data-theme='kesari']"), splitsAttention: false },
  /**
   * The marketing site. Held to the same bar as the two product themes and for
   * a blunter reason: it is the only surface in this repo a stranger reaches
   * without being handed a link, which means it is the one most likely to be
   * read on a phone in daylight by somebody who is not looking hard.
   *
   * Its accent is the palette's own hazard. The brand gold is #C99A4B and the
   * design file's amber is #C97F12; both are beautiful and both fail AA as text
   * (3.22:1 and 2.91:1 on white). `--teal-600` therefore holds a darker amber,
   * and this is the test that stops somebody "fixing" it back to the brand
   * value because the button looked nicer.
   */
  { name: 'innstant', css: blockFor("[data-theme='innstant']"), splitsAttention: false },
];

function hexOf(palette: Palette, variable: string): string {
  const m = new RegExp(`${variable}:\\s*(#[0-9A-Fa-f]{6})`).exec(palette.css);
  if (!m) throw new Error(`${variable} is not a literal hex in the ${palette.name} palette`);
  return m[1]!;
}

/** The N in `--name: color-mix(in srgb, var(--ink) N%, transparent)`. */
function alphaOf(palette: Palette, variable: string): number {
  // Anchored on `var(--ink)` rather than a lazy [^)]* — that stops at the
  // closing paren of var() and never reaches the percentage.
  const m = new RegExp(`${variable}:\\s*color-mix\\(in srgb, var\\(--ink\\) (\\d+)%`)
    .exec(palette.css);
  if (!m) throw new Error(`${variable} is not a color-mix in the ${palette.name} palette`);
  return Number(m[1]) / 100;
}

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as [number, number, number];
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** --ink at a given alpha composited over an opaque background. */
function inkOver(palette: Palette, alpha: number, bg: string): string {
  const fg = hexOf(palette, '--ink').replace('#', '');
  const b = bg.replace('#', '');
  const mix = [0, 2, 4].map((i) => {
    const f = parseInt(fg.slice(i, i + 2), 16);
    const k = parseInt(b.slice(i, i + 2), 16);
    return Math.round(f * alpha + k * (1 - alpha));
  });
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

describe.each(PALETTES)('WCAG AA contrast · $name', (palette) => {
  /**
   * The three grounds anything can land on, in this palette's own order. On
   * the console they go page → card; on the Kesari they go page → card →
   * raised, because on a dark ground "raised" means lighter. Either way these
   * are the three surfaces text is ever set on.
   */
  const grounds = [
    ['page', hexOf(palette, '--paper')],
    ['surface', hexOf(palette, '--white')],
    ['card', hexOf(palette, '--paper-raised')],
  ] as const;

  it('body text passes AA on every ground', () => {
    for (const [name, on] of grounds) {
      expect(contrast(hexOf(palette, '--ink'), on), `--ink on ${name}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('secondary text passes AA on every ground', () => {
    for (const [name, on] of grounds) {
      expect(contrast(hexOf(palette, '--ink-secondary'), on), `--ink-secondary on ${name}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('muted text passes AA — it is ink at reduced alpha, not a border colour', () => {
    const alpha = alphaOf(palette, '--ink-dim');
    for (const [name, on] of grounds) {
      expect(contrast(inkOver(palette, alpha, on), on), `--ink-dim on ${name}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the accent passes AA as text and as a link', () => {
    for (const [name, on] of grounds) {
      expect(contrast(hexOf(palette, '--teal-600'), on), `--teal-600 on ${name}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text on an accent fill passes AA', () => {
    expect(contrast(hexOf(palette, '--accent-ink'), hexOf(palette, '--teal-600')))
      .toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The three status tones carry refusals, promises and destructive actions —
   * exactly the words somebody must be able to read.
   */
  it('every status colour passes AA on every ground', () => {
    for (const token of ['--status-positive', '--status-attention', '--status-critical']) {
      for (const [name, on] of grounds) {
        expect(contrast(hexOf(palette, token), on), `${token} on ${name}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('note ink passes AA on the note background it is only ever used over', () => {
    expect(contrast(hexOf(palette, '--note-ink'), hexOf(palette, '--note-bg')))
      .toBeGreaterThanOrEqual(4.5);
  });

  /**
   * `--ink-faint` carries de-emphasized metadata — an order number, a
   * timestamp, a hint under a field — and does NOT reach 4.5:1. It must never
   * carry body copy or anything a guest has to read in order to act.
   *
   * It does have to clear 3:1, the bar for large text and UI components, on
   * every ground it is used over. The two palettes need DIFFERENT alphas for
   * the same perceptual step — 48% on paper, 45% on indigo — which is exactly
   * the sort of thing that gets copied across and quietly fails, so the
   * percentage is read out of each block rather than restated here.
   */
  it('--ink-faint clears 3:1 everywhere, and is never claimed to pass AA', () => {
    const alpha = alphaOf(palette, '--ink-faint');
    for (const [name, on] of grounds) {
      const ratio = contrast(inkOver(palette, alpha, on), on);
      expect(ratio, `--ink-faint on ${name}: below 3:1 fails even for UI components`)
        .toBeGreaterThanOrEqual(3);
      expect(ratio, 'if this ever passes 4.5, promote it and delete this test')
        .toBeLessThan(4.5);
    }
  });

  it('--line-faint is NOT used as a text colour anywhere', () => {
    // A border, and only a border, in both palettes.
    expect(contrast(hexOf(palette, '--line-faint'), hexOf(palette, '--white')))
      .toBeLessThan(4.5);
  });
});

/**
 * Console-only, because it describes a split the Kesari does not make.
 *
 * On paper, the design's amber is 3.64:1 — fine for a dot, a fill or a left
 * border, and unreadable as a word — so the console carries two values and this
 * pins the graphic one below AA to make misuse loud. On indigo the attention
 * tone IS saffron, it passes AA outright, and there is nothing to separate.
 */
describe('the console splits attention into a text tone and a graphic', () => {
  const console_ = PALETTES.find((p) => p.name === 'console')!;
  const grounds = ['--paper', '--white', '--paper-raised'] as const;

  it('the attention MARK is a graphic, and is never claimed to be text', () => {
    for (const ground of grounds) {
      const ratio = contrast(hexOf(console_, '--status-attention-mark'), hexOf(console_, ground));
      expect(ratio, `--status-attention-mark on ${ground}`).toBeGreaterThanOrEqual(3);
      expect(ratio, 'if this passes 4.5, merge it into --status-attention and delete this')
        .toBeLessThan(4.5);
    }
  });
});

describe('theme discipline the palettes share', () => {
  it('--line-faint is never wired to a text token, under any alias', () => {
    expect(theme).not.toMatch(/--text[a-z-]*:\s*var\(--line-faint\)/);
    // The legacy alias points at it and must not be reintroduced as text
    // either — this is the bug the original version of this test caught.
    expect(theme).not.toMatch(/--text[a-z-]*:\s*var\(--ink-300\)/);
  });
});
