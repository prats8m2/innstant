import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CLAUDE.md: CSS custom properties are the only source of colour, radius, type
 * and motion values. A hardcoded hex in a component is a review failure.
 *
 * This is the check that makes that real. Without it the rule is a comment,
 * and the first hurried screen puts `#0F766E` in a component — at which point
 * `properties.branding` can never restyle it and D-016 quietly dies.
 *
 * It earned its keep at D-048: the palette was replaced wholesale, and the
 * only place the old ground survived was the one literal this file allows.
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
 * The only allowed literals, and why.
 *
 * `viewport.themeColor` becomes a <meta> tag that the browser reads to paint
 * its own chrome BEFORE any stylesheet loads — so it cannot be a CSS variable.
 * Without it the phone's address bar flashes a different shade before first
 * paint, which is the first thing a guest sees at 9:40pm.
 *
 * There are three because there are three themes (D-050, and the marketing
 * site after it): the root layout carries the staff console's ground, the guest
 * route group overrides it with the Kesari's, and the site group with its own.
 * Each must stay in step with `--paper` in ITS OWN palette block, by hand — the
 * assertions below enforce that, and they are the reason a palette swap cannot
 * silently leave one browser chrome behind.
 */
const ALLOWED = new Map([
  ['src/app/layout.tsx', '#F3F4F2'],
  ['src/app/(guest)/layout.tsx', '#0A1220'],
  ['src/app/(site)/layout.tsx', '#F3F4F1'],
]);

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

  /**
   * Each theme's chrome colour against each theme's own ground.
   *
   * The guest one is NOT `--paper` inside `[data-theme='kesari']` — that is
   * #101E33, the app's ground. It is `--paper-deep`, the deeper indigo the body
   * sits on, because the browser paints its chrome around the whole document
   * and a guest page that scrolls past its content shows that, not the app.
   */
  it('each themeColor meta tag matches its own palette, which nothing else enforces', () => {
    const theme = readFileSync('src/styles/theme.css', 'utf8');

    const blockFor = (selector: string) => {
      const at = theme.indexOf(`${selector} {`);
      expect(at, `theme.css has no ${selector} block`).toBeGreaterThan(-1);
      return theme.slice(at, theme.indexOf('\n}', at));
    };

    const consoleGround = /--paper:\s*(#[0-9A-Fa-f]{6})/.exec(blockFor(':root'));
    expect(consoleGround?.[1]?.toUpperCase())
      .toBe(ALLOWED.get('src/app/layout.tsx')?.toUpperCase());

    const guestGround = /--paper-deep:\s*(#[0-9A-Fa-f]{6})/
      .exec(blockFor("[data-theme='kesari']"));
    expect(guestGround?.[1]?.toUpperCase())
      .toBe(ALLOWED.get('src/app/(guest)/layout.tsx')?.toUpperCase());

    // The site's is its plain `--paper`: unlike the guest app it has no deeper
    // backdrop behind the content, so the chrome and the page are one colour.
    const siteGround = /--paper:\s*(#[0-9A-Fa-f]{6})/
      .exec(blockFor("[data-theme='innstant']"));
    expect(siteGround?.[1]?.toUpperCase())
      .toBe(ALLOWED.get('src/app/(site)/layout.tsx')?.toUpperCase());
  });

  /**
   * The guest route group must actually wear the theme. Without the attribute
   * the whole `[data-theme='kesari']` block is dead CSS and every guest screen
   * silently renders in the staff console's paper — which is precisely what
   * happened for the length of one session.
   */
  it('the guest route group applies the Kesari theme', () => {
    const layout = readFileSync('src/app/(guest)/layout.tsx', 'utf8');
    expect(layout).toMatch(/data-theme="kesari"/);
  });

  /** Same failure, same cost, one route group over. */
  it('the site route group applies the Innstant theme', () => {
    const layout = readFileSync('src/app/(site)/layout.tsx', 'utf8');
    expect(layout).toMatch(/data-theme="innstant"/);
  });

  it('theme.css declares the whole vocabulary the design names', () => {
    const theme = readFileSync('src/styles/theme.css', 'utf8');
    for (const v of [
      '--paper', '--paper-deep', '--paper-raised', '--white', '--line',
      '--ink', '--ink-secondary',
      '--teal-600', '--teal-700', '--teal-tint',
      '--accent', '--accent-hover', '--accent-ink', '--accent-tint',
      '--status-positive', '--status-attention', '--status-attention-mark',
      '--status-critical', '--note-bg', '--note-ink',
      '--text-2xs', '--text-xs', '--text-base',
      '--radius-sm', '--radius-lg', '--radius-pill',
      '--font-display', '--font-body', '--font-mono',
      '--dur-fast', '--dur-base', '--dur-slow', '--dur-slower',
      '--nav-w', '--panel-w', '--touch-min',
    ]) {
      expect(theme, `theme.css must declare ${v}`).toContain(`${v}:`);
    }
  });

  /**
   * The indigo theme's names are still referenced ~250 times across the module
   * stylesheets. D-048 remapped them by role rather than rewriting every call
   * site, so deleting one silently un-styles whatever still uses it. When the
   * modules have been migrated, delete the legacy block and this test together.
   */
  it('keeps the legacy aliases alive while anything still uses them', () => {
    const theme = readFileSync('src/styles/theme.css', 'utf8');
    const legacy = [
      '--ink-900', '--ink-850', '--ink-800', '--ink-700', '--ink-600',
      '--ink-500', '--ink-450', '--ink-400', '--ink-300',
      '--plaster', '--plaster-dim', '--plaster-faint',
      '--saffron', '--saffron-lit', '--teal', '--clay',
    ];
    const used = new Set(
      FILES.flatMap((f) => readFileSync(f, 'utf8').match(/--[a-z0-9-]+/g) ?? []),
    );
    for (const v of legacy.filter((v) => used.has(v))) {
      expect(theme, `${v} is still used by a component and must stay defined`)
        .toContain(`${v}:`);
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
