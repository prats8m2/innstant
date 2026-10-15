import { StyleSheet, Text, View } from 'react-native';
import { colors, face, space, text as type } from '@/lib/theme';

/**
 * The jharokha arch. D-080, and the only ornament in the app.
 *
 * ─── Borders, not an image and not an SVG ──────────────────────────────────
 *
 * Two nested Views with the top corners rounded all the way and the bottom
 * edge simply absent, plus a nine-point square turned forty-five degrees. The
 * designer's note is explicit about why: "The arch is CSS borders, not an
 * image, so it ships today." It costs no asset, no `react-native-svg` path, no
 * `@2x`/`@3x` set, and it is crisp at every density because there is nothing
 * to resample.
 *
 * It is also why the deferred image session has nothing to do here. The home
 * screen carries no photography by design — when images arrive they belong to
 * the dish detail and the menu list, which have slots for them. This hero
 * never needs one.
 *
 * ─── `dimmed` is the closed kitchen ────────────────────────────────────────
 *
 * Not opacity, which would take the headline down with it. Each of the three
 * strokes drops exactly one step — outer `lineFaint`→`line`, inner
 * `line`→`lineSoft` — and the saffron lozenge goes hollow rather than
 * disappearing. The saffron is still present; it is simply not lit.
 */
export function Arch({
  eyebrow,
  headline,
  dimmed,
}: {
  eyebrow: string;
  headline: string;
  /** The kitchen is shut. Three strokes drop a step; nothing moves. */
  dimmed?: boolean;
}) {
  return (
    <View style={[s.outer, dimmed && s.outerDim]}>
      {/* The second ring, inset on three sides and open at the bottom like the
          first. `pointerEvents` none because it sits over the text box. */}
      <View style={[s.ring, dimmed && s.ringDim]} pointerEvents="none" />

      <View style={[s.lozenge, dimmed && s.lozengeDim]} pointerEvents="none" />

      {/* `accessible` on the pair: a screen reader should read one sentence
          here, not an eyebrow and then a headline as two unrelated labels. */}
      <View accessible accessibilityRole="header" style={s.copy}>
        <Text style={[s.eyebrow, dimmed && s.eyebrowDim]}>{eyebrow}</Text>
        <Text style={s.headline}>{headline}</Text>
      </View>
    </View>
  );
}

/** 300pt across, which on the narrowest phone the design targets (390pt, less
 *  two 24pt gutters) leaves the arch comfortably inside the text column. */
const SIZE = 300;

const s = StyleSheet.create({
  outer: {
    width: SIZE,
    height: SIZE,
    alignSelf: 'center',
    marginTop: 20,
    borderWidth: 1,
    // The arch stands ON the hairline below it rather than closing itself.
    borderBottomWidth: 0,
    borderColor: colors.lineFaint,
    borderTopLeftRadius: SIZE / 2,
    borderTopRightRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 28,
    paddingBottom: 28,
  },
  outerDim: { borderColor: colors.line },

  ring: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    bottom: 0,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.line,
    // 140 rather than 150: the inner curve is the outer one less its inset,
    // so the two stay parallel instead of converging at the crown.
    borderTopLeftRadius: 140,
    borderTopRightRadius: 140,
  },
  ringDim: { borderColor: colors.lineSoft },

  lozenge: {
    position: 'absolute',
    top: 46,
    left: '50%',
    marginLeft: -4.5,
    width: 9,
    height: 9,
    backgroundColor: colors.accent,
    transform: [{ rotate: '45deg' }],
    // A literal 1, below `radius.xs`. At nine points across, 2 would read as a
    // circle and the diamond stops being a diamond.
    borderRadius: 1,
  },
  lozengeDim: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
  },

  copy: { alignItems: 'center' },
  eyebrow: {
    ...face('mono'),
    fontSize: type.xs,
    // .18em at 11pt. RN has no ems, so every tracking value on this screen is
    // the multiplication done once, here.
    letterSpacing: 1.98,
    textTransform: 'uppercase',
    color: colors.accent,
    textAlign: 'center',
  },
  eyebrowDim: { color: colors.inkDim },
  headline: {
    ...face('display'),
    fontSize: type.display,
    lineHeight: type.display * 1.12,
    color: colors.ink,
    textAlign: 'center',
    marginTop: space[3],
  },
});
