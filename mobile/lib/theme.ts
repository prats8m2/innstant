/**
 * The Kesari palette, for React Native. D-080.
 *
 * ─── Why this is a hand-kept copy and not generated ────────────────────────
 *
 * The web's single source of truth is `src/styles/theme.css`, hand-maintained
 * (D-023 killed the token build pipeline on purpose — there is no tokens.json
 * and no `pnpm tokens:build`). React Native has no CSS custom properties and
 * no `color-mix()`, so the web file cannot be consumed here whatever we do.
 *
 * The options were a build step that parses CSS to produce this file —
 * reintroducing the generator D-023 removed, for one consumer — or a copy that
 * says it is one. This is the copy. `mobile/lib/theme.test.ts` is the thing
 * that keeps it honest: it reads `theme.css` off disk and asserts every value
 * here still matches its `[data-theme='kesari']` primitive.
 *
 * ─── The two traps when porting from the web theme ─────────────────────────
 *
 *   · Saffron HOVER goes LIGHTER on this theme, not darker. It is the opposite
 *     of the console's and the single most common thing to get wrong.
 *   · Text on saffron is the GROUND (#101E33), never white.
 *
 * `color-mix()` values are resolved to their literal equivalents here, because
 * RN cannot compute them: `--ink-dim` is 62% of --ink over the ground, and
 * `--ink-faint` is 45%. Those two percentages are asserted in theme.css's own
 * contrast test and are repeated in the comment there for this reason.
 */

export const colors = {
  /** The full-bleed backdrop behind a hero — NOT the app's ground. */
  paperDeep: '#0A1220',
  /** The app's ground. */
  paper: '#101E33',
  /** A card, a tile, a sheet. On a dark ground, raised means lighter. */
  card: '#1B2B45',
  /** A step above a card. */
  raised: '#22354F',

  line: '#243755',
  lineSoft: '#223353',
  /** Borders and dividers ONLY — 2.39:1 on the surface, nowhere near AA.
   *  Never a text colour. */
  lineFaint: '#4A5A73',

  /** Saffron. `accentHover` is LIGHTER — see the note above. */
  accent: '#E9A227',
  accentHover: '#F2B84B',
  accentTint: '#22354F',
  /** Text on saffron is the ground, not white. */
  accentInk: '#101E33',

  /** Lime plaster, not white — the wall colour of the haveli. */
  ink: '#E3E5DB',
  inkSecondary: '#C3C7BC',
  /** 62% of --ink over the ground, resolved. */
  inkDim: 'rgba(227, 229, 219, 0.62)',
  /** 45%. */
  inkFaint: 'rgba(227, 229, 219, 0.45)',

  positive: '#7FA9A2',
  attention: '#E9A227',
  /** Terracotta rather than a pure red: it sits in the haveli palette beside
   *  saffron, and it clears AA on all three grounds. */
  critical: '#E4867A',
  attentionTint: '#2A2416',
  criticalTint: '#33201D',
  noteBg: '#2A2416',
  noteInk: '#F0D9A8',
} as const;

/**
 * Deliberately sharp. 8px-everywhere is the shadcn default the brief ruled
 * out; 3px is the strongest single signal that this is not a template (D-050).
 */
export const radius = { xs: 2, sm: 3, md: 4, lg: 4, sheet: 18 } as const;

/** The web's spacing scale, in points. 4px base. */
export const space = {
  1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48,
} as const;

export const text = {
  xs: 11, sm: 13, base: 15, lg: 17, xl: 22, xxl: 28, display: 34,
} as const;

/**
 * 44pt minimum touch target (CLAUDE.md "UI"). Apple's HIG says 44 and
 * Android's says 48dp; the larger is the safe one to standardise on and the
 * difference is invisible.
 */
export const TOUCH_MIN = 48;

/**
 * Tabular figures, for every number that sits next to another number.
 *
 * Prices in a column, a quantity beside a stepper, a time in a timeline. A
 * proportional `1` is narrower than a `0` and a column of prices visibly
 * wobbles without this — the web uses a `.tabular` utility class for exactly
 * the same set of places.
 */
export const tabular = { fontVariant: ['tabular-nums' as const] };
