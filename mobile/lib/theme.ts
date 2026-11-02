/**
 * The Kesari palette, for React Native. D-080.
 *
 * ─── Why this is a hand-kept copy and not generated ────────────────────────
 *
 * The source of truth is `design/tokens/innstant-themes.css` (D-100), whose
 * Kesari guest theme this is; `innstant-themes.json` beside it mirrors it.
 * React Native has no CSS custom properties and no `color-mix()`, and Metro
 * does not reach outside `mobile/`, so this stays a copy that says it is one.
 * `tests/unit/mobile-theme.test.ts` keeps it honest: every colour here that
 * IS a token must equal that token in the JSON.
 *
 * The rest are the web's `color-mix()` steps (a hover, a tint, a soft line),
 * resolved for Kesari and written down; their comments name the mix.
 *
 *   · Text on the accent is --g-on-accent, a dark brown, never white.
 *   · The accent's hover moves toward the ink: lighter, on this dark theme.
 */

export const colors = {
  /** The page. Direction A put the app's ground on --g-page (D-100). */
  paperDeep: '#0A1220',
  /** The app's ground. */
  paper: '#0A1220',
  /** A card, a tile, a sheet. */
  card: '#1B2B45',
  /** A step above a card — color-mix(--g-line 55%, --g-card), resolved. */
  raised: '#23344F',

  line: '#2A3B58',
  /** color-mix(--g-line 60%, --g-card), resolved. */
  lineSoft: '#243550',
  /** Borders and dividers ONLY. Never a text colour. */
  lineFaint: '#56647D',

  /** Saffron in Kesari. `accentHover` moves toward the ink. */
  accent: '#E9A227',
  accentHover: '#EBAF48',
  accentTint: '#3C3E40',
  /** Text on the accent. */
  accentInk: '#1A1206',

  /** Warm ivory, not white — pure white glares in a dark room. */
  ink: '#F4ECDD',
  inkSecondary: '#B9C2D0',
  /** The design's third ink, --g-ink-3; both older steps read it. */
  inkDim: '#8B97AB',
  inkFaint: '#8B97AB',

  positive: '#6E9C95',
  attention: '#E9A227',
  /** "Running late": a soft sindoor, honesty rather than an alarm. */
  critical: '#F08A6C',
  attentionTint: '#292621',
  criticalTint: '#2A232B',
  noteBg: '#292621',
  noteInk: '#F0D29D',
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
 * How tall the tab bar is, without the home indicator under it.
 *
 * `(tabs)/_layout.tsx` sets this height and a screen inside the tabs has to
 * know it: a cart pill pinned to the bottom of a tab is pinned above the bar
 * rather than behind it, and the number has to be the same one in both files
 * or the pill floats. Add `insets.bottom` at the point of use — the inset is
 * the device's and not the bar's.
 *
 * A size rather than a layout accident, which is why it is here: the
 * alternative is the figure written twice, and the second copy is the one
 * that is wrong after somebody retunes the bar.
 */
export const TAB_BAR_H = TOUCH_MIN + space[5];

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
 * different colour in: `rgba(10, 18, 32, 0)` IS `--paper` with the alpha
 * removed, so content sliding under it loses opacity without shifting colour.
 * Written once here because a gradient stop is still a colour, and a component
 * holding `'rgba(10, 18, 32, 0)'` is a hardcoded hex wearing a hat.
 *
 * Not in the MAPPING of the drift test: there is no `--paper-transparent` on
 * the web, because CSS can write `transparent` and get the same result without
 * naming the hue. RN's gradient cannot — `transparent` is black at zero alpha
 * on Android and the fade goes grey.
 */
export const paperTransparent = 'rgba(10, 18, 32, 0)';

/**
 * The scrim over the hero photograph. Phase 2 of the redesign.
 *
 * `paperDeep` at four alphas, written here for the same reason
 * `paperTransparent` is: a gradient stop is a colour, and a component holding
 * `'rgba(10, 18, 32, 0.86)'` is a hardcoded hex wearing a hat. RN cannot
 * compute `color-mix()`, and the web has no counterpart because the web home
 * has no photograph — so these are not in the drift test's MAPPING.
 *
 * Why a scrim at all: the arch is drawn in one-pixel strokes and the headline
 * is 34pt of lime plaster, and both have to stay legible over a photograph
 * nobody chose for its contrast. The top stop carries the wordmark row, the
 * middle is the lightest the photograph is ever allowed to be, and the bottom
 * closes into the ground so the hero has no visible edge.
 *
 * `shut` is the flat wash laid over the photograph when the kitchen is — the
 * same step the arch's three strokes take, applied to the picture. Not
 * `opacity` on the image, which would fade it towards whatever is behind it
 * rather than towards the ground.
 */
export const heroScrim = {
  top: 'rgba(10, 18, 32, 0.86)',
  mid: 'rgba(10, 18, 32, 0.52)',
  bottom: 'rgba(10, 18, 32, 0.97)',
  shut: 'rgba(10, 18, 32, 0.62)',
} as const;

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
 *
 * `shimmer` is the one value outside the 180–320 band, and the skeletons are
 * why. Everything else here times a transition somebody waits through; that
 * one times a loop that runs while a screen loads and has no end to wait for.
 * A sweep at 320ms strobes.
 */
export const duration = {
  fast: 180, base: 200, mid: 240, slow: 300, slower: 320, shimmer: 1200,
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
