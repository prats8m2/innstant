import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors, face, space, tabular, text as type } from '@/lib/theme';

/**
 * One line of the menu's table of contents. D-080.
 *
 * ─── It is a BUTTON in every state, including a shut kitchen ───────────────
 *
 * The design draws these as plain divs in the closed mock, which is an
 * artefact of a static crop rather than a decision — and shipping it would
 * break #9. Browsing is never gated: a closed kitchen withholds PLACEMENT, on
 * the cart screen, and nothing else. Making the menu untappable at midnight
 * would be the wall that rule exists to remove.
 *
 * ─── The blurb is dropped rather than left empty ───────────────────────────
 *
 * Five of the seven live sections have `menu_categories.description` null. An
 * empty `<Text>` still takes a line box, so a row with no blurb would be as
 * tall as one with a blurb and look like it had lost its copy. Dropping the
 * element collapses the row onto one baseline, which is what a contents list
 * with a bare section name should look like.
 */
export function ContentsRow({
  numeral,
  title,
  blurb,
  count,
  onPress,
}: {
  /** Roman, positional — `I` for the first section, not an id. */
  numeral: string;
  title: string;
  blurb: string | null;
  /** Zero-padded by the caller, because it is set in a column. */
  count: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${count.replace(/^0+(?=\d)/, '')} dishes`}
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.pressed]}
    >
      <Text style={s.numeral}>{numeral}</Text>

      <View style={s.body}>
        <Text style={s.title}>{title}</Text>
        {blurb ? <Text style={s.blurb}>{blurb}</Text> : null}
      </View>

      <Text style={[s.count, tabular]}>{count}</Text>
      {/* `inkFaint` is a borders-and-ornament colour and this is one of the
          exactly two places it appears — as a chevron stroke, never as text. */}
      <ChevronRight size={18} color={colors.inkFaint} strokeWidth={2} strokeLinecap="round" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 72,
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  pressed: { backgroundColor: colors.lineSoft },

  numeral: {
    ...face('display'),
    width: 32,
    fontSize: type.base,
    color: colors.accent,
  },
  body: { flex: 1 },
  title: { ...face('display'), fontSize: type.lg, color: colors.ink },
  blurb: {
    ...face('body'),
    fontSize: type.sm,
    lineHeight: type.sm * 1.4,
    color: colors.inkDim,
    marginTop: 2,
  },
  count: { ...face('mono'), fontSize: type.sm, color: colors.inkDim },
});
