import { StyleSheet, Text, View } from 'react-native';
import type { ApiOutlet } from '@contract';
import { colors, face, space, tabular, text as type } from '@/lib/theme';

/**
 * Open, ready in, minimum — three columns under the hero. D-080.
 *
 * ─── Everything here is the server's sentence, rendered verbatim ───────────
 *
 * The designer's note is one line and it is the whole specification:
 * "openLine, prepTimeMinutes and minimumOrder, verbatim. Nothing else is
 * claimed." So there is no "closes in 2h" arithmetic, no re-wording of the
 * opening line into the app's voice, and no reformatting of the ₹ figure —
 * `minimumOrder.text` arrives Indian-grouped from the one place allowed to
 * format money (#5), and a second implementation here is how the two start
 * disagreeing about ₹1,150.
 *
 * The strip is the only place on this screen that says whether the kitchen is
 * cooking, and saying it wrongly is worse than not saying it.
 */
export function StatusStrip({ outlet }: { outlet: ApiOutlet }) {
  const open = outlet.isOpen;

  return (
    <View style={s.strip}>
      <View style={s.first}>
        <View style={s.labelRow}>
          {/* Filled when open, hollow when not. A shut kitchen is a state to
              notice, not an error to alarm somebody with — terracotta rather
              than red, and an outline rather than a solid. */}
          <View style={[s.dot, open ? s.dotOpen : s.dotClosed]} />
          <Text style={[s.label, open ? s.labelOpen : s.labelClosed]}>
            {open ? 'Open' : 'Closed'}
          </Text>
        </View>
        <Text style={s.sub}>{outlet.openLine}</Text>
      </View>

      <View style={s.column}>
        <Text style={s.label}>Ready in</Text>
        {/* An em dash, not "0 min" and not a stale number. A closed kitchen
            has no prep time, and inventing one is a promise. */}
        <Text style={[s.value, tabular, !open && s.valueOff]}>
          {open ? `~${outlet.prepTimeMinutes} min` : '—'}
        </Text>
      </View>

      <View style={s.column}>
        <Text style={s.label}>Minimum</Text>
        <Text style={[s.value, tabular]}>{outlet.minimumOrder.text}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  strip: { flexDirection: 'row', marginTop: 20 },

  // 1.3 / 1 / 1 — the first column carries a whole sentence and the other two
  // carry a figure each.
  first: { flex: 1.3, gap: space[1], paddingRight: space[3] },
  column: {
    flex: 1,
    gap: space[1],
    paddingHorizontal: space[3],
    borderLeftWidth: 1,
    borderLeftColor: colors.line,
  },

  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotOpen: { backgroundColor: colors.positive },
  dotClosed: { borderWidth: 1, borderColor: colors.critical },

  label: {
    ...face('mono'),
    fontSize: type.xs,
    // .1em at 11pt.
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.inkDim,
  },
  labelOpen: { color: colors.positive },
  labelClosed: { color: colors.critical },

  sub: { ...face('body'), fontSize: type.sm, color: colors.inkSecondary },

  /* Tabular on both figures. The design source drops it from this strip in
     one of the three states; that is a slip rather than a decision — #5 — and
     1a is the version that is right. */
  value: { ...face('mono'), fontSize: type.sm, color: colors.ink },
  valueOff: { color: colors.inkDim },
});
