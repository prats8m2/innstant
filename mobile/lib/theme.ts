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

/**
 * The same hue as `paper`, at zero alpha.
 *
 * The bottom bar's gradient fades the ground out rather than fading a
 * different colour in: `rgba(16, 30, 51, 0)` IS `--paper` with the alpha
 * removed, so content sliding under it loses opacity without shifting colour.
 * Written once here because a gradient stop is still a colour, and a component
 * holding `'rgba(16, 30, 51, 0)'` is a hardcoded hex wearing a hat.
 *
 * Not in the MAPPING of the drift test: there is no `--paper-transparent` on
 * the web, because CSS can write `transparent` and get the same result without
 * naming the hue. RN's gradient cannot — `transparent` is black at zero alpha
 * on Android and the fade goes grey.
 */
export const paperTransparent = 'rgba(16, 30, 51, 0)';

/**
 * Motion, in milliseconds. The mirror of theme.css's `--dur-*`.
 *
 * Same argument as the palette: RN has no custom properties, so the web file
 * cannot be read here and this is the hand-kept copy that
 * `tests/unit/mobile-theme.test.ts` holds to it. It exists so that CLAUDE.md's
 * "never hardcode a duration in a component" survives the crossing — a screen
 * that animates writes `duration.mid`, not `240`.
 *
 * Where each one is spent on the home screen, which is the only screen that
 * animates at all today:
 *
 *   · `fast`   — the quick-add button filling with saffron when the first one
 *                lands in the cart.
 *   · `mid`    — the bottom bar turning from "See the full menu" into
 *                "View cart" on the first add.
 *   · `slower` — a live order's progress segment filling.
 *
 * PRESSES are not in that list. The design specifies 180ms on them, and React
 * Native's answer is `Pressable`'s pressed style, which swaps immediately —
 * the design doc says either is fine, and an animated press state costs an
 * `Animated.Value` per tappable row to make a 180ms fade nobody waits out.
 *
 * `base` and `slow` have no caller yet. They are here because the drift test
 * checks the whole set, and a partial copy is the kind that rots.
 */
export const duration = {
  fast: 180, base: 200, mid: 240, slow: 300, slower: 320,
} as const;

/**
 * The three families the design is set in. D-080.
 *
 * ─── These are NOT installed yet, and that is deliberate ───────────────────
 *
 * CLAUDE.md says to ask before adding a dependency over ~50KB of SHIPPED
 * bytes. Three Google font families — Marcellus, Mukta at two weights, DM Mono
 * at two — are somewhere near a megabyte of TTF inside the APK, which is well
 * over that bar and is a question for a person rather than a decision to take
 * quietly in a commit.
 *
 * So every value below is `undefined` today, which React Native reads as the
 * system face. The screen builds, lays out and behaves correctly; it simply is
 * not set in the typefaces the design is drawn in, and the 34pt arch headline
 * is the place that shows it most.
 *
 * ─── Turning them on is this file plus one effect ──────────────────────────
 *
 *   cd mobile && npx expo install expo-font expo-splash-screen \
 *     @expo-google-fonts/marcellus @expo-google-fonts/mukta \
 *     @expo-google-fonts/dm-mono
 *
 * The names below are the real families, loaded with `useFonts` in
 * `app/_layout.tsx`, which holds the splash until they resolve. Nothing in any
 * component changed to turn them on: every style asks for a face through
 * `face()` and none of them names a family, which is the whole reason the
 * indirection exists.
 *
 * Roughly a megabyte of TTF in the APK, which is over CLAUDE.md's ask-first
 * bar and was asked about. The answer was yes, and the reasoning is that this
 * design is typography-led BECAUSE it has no photography — rendering it on the
 * system face gives up the thing it was built around, to save under one per
 * cent of a 118MB APK.
 */
export const fonts: Record<FaceRole, string | undefined> = {
  display: 'Marcellus_400Regular',
  body: 'Mukta_400Regular',
  bodyMedium: 'Mukta_600SemiBold',
  mono: 'DMMono_400Regular',
  monoMedium: 'DMMono_500Medium',
};

export type FaceRole = 'display' | 'body' | 'bodyMedium' | 'mono' | 'monoMedium';

/** Deliberately a string union rather than RN's `TextStyle['fontWeight']`:
 *  this file imports nothing, so the web's unit suite can read it. */
type Weight = '400' | '500' | '600' | '700';

/**
 * A typeface, as a style fragment to spread into a `StyleSheet` entry.
 *
 * The weight is the half that matters while `fonts` is empty. A Google family
 * carries its own weight in its NAME — `Mukta_600SemiBold` is a separate font
 * file, not a 600 of one — so once the packages land the `fontWeight` here is
 * dropped: setting both is what produces synthesised fake-bold on Android, on
 * top of a face that is already semibold.
 *
 * Until then it is the only lever left, and it is what keeps a heading reading
 * as a heading on the system face.
 */
export function face(role: FaceRole): { fontFamily?: string; fontWeight?: Weight } {
  const family = fonts[role];
  if (family) return { fontFamily: family };
  return { fontWeight: FALLBACK_WEIGHT[role] };
}

/**
 * What each role weighs when it is rendered on the system face.
 *
 * `display` is the one that is not a transcription. Marcellus is a 400-weight
 * serif and reads as a display face because of its shapes; a system sans at
 * 400 and 34pt reads as a paragraph that got large. 600 is the nearest thing
 * to its presence that a weight can buy.
 */
const FALLBACK_WEIGHT: Record<FaceRole, Weight> = {
  display: '600',
  body: '400',
  bodyMedium: '600',
  mono: '400',
  monoMedium: '600',
};
