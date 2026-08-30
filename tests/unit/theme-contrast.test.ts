import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * WCAG AA contrast, asserted.
 *
 * design/README.md called for contrast to be validated at save time by the
 * token build; D-023 removed that build, so the check lives here instead of
 * being deferred. It has already caught one real bug: --text-muted was mapped
 * to --ink-300, a BORDER colour, giving 2.39:1 on the card surface — invisible
 * to someone with good eyes on a good screen, and unreadable to plenty of the
 * 30–55 year-old guests this product is for, in a dim hotel room.
 */
const theme = readFileSync('src/styles/theme.css', 'utf8');

function hexOf(variable: string): string {
  const m = new RegExp(`${variable}:\\s*(#[0-9A-Fa-f]{6})`).exec(theme);
  if (!m) throw new Error(`${variable} is not a literal hex in theme.css`);
  return m[1]!;
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

/** --plaster at a given alpha over an opaque background. */
function plasterOver(alpha: number, bg: string): string {
  const fg = hexOf('--plaster').replace('#', '');
  const b = bg.replace('#', '');
  const mix = [0, 2, 4].map((i) => {
    const f = parseInt(fg.slice(i, i + 2), 16);
    const k = parseInt(b.slice(i, i + 2), 16);
    return Math.round(f * alpha + k * (1 - alpha));
  });
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

describe('WCAG AA contrast', () => {
  const bg = hexOf('--ink-850');
  const surface = hexOf('--ink-800');
  const card = hexOf('--ink-600');

  it('body text passes AA on every surface', () => {
    for (const [name, on] of [['bg', bg], ['surface', surface], ['card', card]] as const) {
      expect(contrast(hexOf('--plaster'), on), `--plaster on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('muted text passes AA — it is plaster at 62%, not --ink-300', () => {
    for (const on of [bg, surface, card]) {
      expect(contrast(plasterOver(0.62, on), on)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the accent passes AA as text and as a link', () => {
    for (const on of [bg, surface, card]) {
      expect(contrast(hexOf('--saffron'), on)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the teal status colour passes AA', () => {
    expect(contrast(hexOf('--teal'), surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('--ink-300 is NOT used as a text colour anywhere', () => {
    // It is 2.39:1 on --surface. It is a border, and only a border.
    expect(contrast(hexOf('--ink-300'), surface)).toBeLessThan(4.5);
    expect(theme).not.toMatch(/--text[a-z-]*:\s*var\(--ink-300\)/);
  });
});
