import { StyleSheet, View } from 'react-native';
import { dietMarkFor } from '@/lib/format';
import { colors } from '@/lib/theme';

/**
 * The square. Phase 2 of the redesign.
 *
 * ─── It is a legal convention, so it is drawn to the convention ───────────
 *
 * A bordered square with a filled shape inside it: a dot for vegetarian, a
 * triangle for not. Indian menus and packaging carry this mark because the
 * rules say they do, and every Indian reads it without reading anything —
 * which is the whole reason it is worth drawing instead of the word "Veg".
 *
 * Two departures from the literal convention, both deliberate:
 *
 *   · The colours are the theme's `positive` and `critical` rather than the
 *     statutory green and brown. This app is one restaurant's menu, not a
 *     label on a packet, and a pure #008000 square on indigo is the only
 *     thing on the screen that is not in the palette. Both clear AA on all
 *     three grounds, which the statutory pair does not.
 *   · The triangle is drawn with borders rather than `react-native-svg` —
 *     a 6pt triangle is three border widths, and the dependency buys nothing
 *     at this size.
 *
 * ─── Nothing is drawn where nothing was declared ──────────────────────────
 *
 * `dietMarkFor` returns null when a dish carries neither flag, and this
 * renders null for it. See that function for why a missing tick is not an
 * assertion of meat.
 */
export function DietMark({
  flags,
  size = 14,
}: {
  flags: readonly string[];
  /** The outer square. 14 beside a 15pt dish name; 16 in a 22pt heading. */
  size?: number;
}) {
  const mark = dietMarkFor(flags);
  if (!mark) return null;

  const veg = mark === 'VEG';
  const tone = veg ? colors.positive : colors.critical;
  /** The inner shape is half the square, which is the proportion every
   *  printed version of this mark uses. */
  const inner = Math.round(size / 2);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={veg ? 'Vegetarian' : 'Non-vegetarian'}
      style={[s.box, { width: size, height: size, borderColor: tone }]}
    >
      {veg ? (
        <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: tone }} />
      ) : (
        <View
          style={{
            // A triangle, as a zero-width box with a coloured bottom border
            // and transparent sides. `borderTopWidth: 0` keeps it pointing up.
            borderLeftWidth: inner / 2,
            borderRightWidth: inner / 2,
            borderBottomWidth: inner,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: tone,
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    // A literal 2 rather than `radius.xs`: this is a reproduction of a
    // printed mark, not a surface of the app, and at 14pt across anything
    // softer stops reading as a square.
    borderRadius: 2,
  },
});
