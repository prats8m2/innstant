import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CLAUDE.md: CSS custom properties are the only source of colour, radius, type
 * and motion values. A hardcoded hex in a component is a review failure.
 *
 * This is the check that makes that real. Without it the rule is a comment,
 * and the first hurried screen puts `#E9A227` in a component — at which point
 * `properties.branding` can never restyle it and D-016 quietly dies.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|module\.css)$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk('src').filter((f) => !f.endsWith('theme.css'));

/**
 * The one allowed literal, and why.
 *
 * `viewport.themeColor` becomes a <meta> tag that the browser reads to paint
 * its own chrome BEFORE any stylesheet loads — so it cannot be a CSS variable.
 * Without it the phone's address bar flashes white before first paint, which
 * is the first thing a guest sees at 9:40pm.
 *
 * It must stay in step with --ink-850 in theme.css by hand; the assertion
 * below enforces that.
 */
const ALLOWED = new Map([['src/app/layout.tsx', '#0A1220']]);

describe('theme discipline', () => {
  it('no component or module stylesheet contains a raw hex colour', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const body = readFileSync(file, 'utf8');
      for (const [i, line] of body.split('\n').entries()) {
        const m = /#[0-9A-Fa-f]{3,8}\b/.exec(line);
        // A hex inside a comment is documentation, not a value.
        if (!m) continue;
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) continue;
        if (ALLOWED.get(file) === m[0]) continue;
        offenders.push(`${file}:${i + 1}  ${m[0]}`);
      }
    }
    expect(offenders, `use var(--…) from theme.css instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('no module stylesheet hardcodes a duration', () => {
    const offenders: string[] = [];
    for (const file of FILES.filter((f) => f.endsWith('.module.css'))) {
      const body = readFileSync(file, 'utf8');
      for (const [i, line] of body.split('\n').entries()) {
        // Durations belong in --dur-*. Keyframe percentages and delays that
        // are part of a stagger sequence are allowed.
        const m = /(?:transition|animation)-duration:\s*[\d.]+m?s/.exec(line);
        if (m) offenders.push(`${file}:${i + 1}  ${m[0]}`);
      }
    }
    expect(offenders, `use var(--dur-…):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the themeColor meta tag matches --ink-850, which nothing else enforces', () => {
    // These two are duplicated by necessity (see ALLOWED). If --ink-850 changes
    // and this does not, the browser chrome no longer matches the page.
    const theme = readFileSync('src/styles/theme.css', 'utf8');
    const inkMatch = /--ink-850:\s*(#[0-9A-Fa-f]{6})/.exec(theme);
    expect(inkMatch?.[1]?.toUpperCase()).toBe(ALLOWED.get('src/app/layout.tsx')?.toUpperCase());
  });

  it('theme.css declares everything DESIGN-SPEC.md names', () => {
    const theme = readFileSync('src/styles/theme.css', 'utf8');
    for (const v of [
      '--ink-850', '--ink-800', '--saffron', '--saffron-lit', '--plaster', '--teal',
      '--radius-sm', '--radius-pill',
      '--font-display', '--font-body', '--font-mono',
      '--dur-fast', '--dur-base', '--dur-slow', '--dur-slower',
      '--touch-min',
    ]) {
      expect(theme, `theme.css must declare ${v}`).toContain(`${v}:`);
    }
  });

  it('handles prefers-reduced-motion once, globally', () => {
    const theme = readFileSync('src/styles/theme.css', 'utf8');
    expect(theme).toContain('prefers-reduced-motion');
    // Per-component handling is how one animation gets missed, and the person
    // who needs the setting is the one who notices.
    const perComponent = FILES.filter((f) => f.endsWith('.module.css'))
      .filter((f) => readFileSync(f, 'utf8').includes('prefers-reduced-motion'));
    expect(perComponent).toEqual([]);
  });
});
