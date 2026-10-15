import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { RotateCcw } from 'lucide-react-native';
import type { ApiReorder } from '@contract';
import { HOME_COPY } from '@/lib/copy';
import {
  colors, face, radius, space, tabular, text as type, TOUCH_MIN,
} from '@/lib/theme';

/**
 * "Same as last time" — the returning customer's one-tap repeat. D-080.
 *
 * ─── What it is allowed to decide, which is nothing ────────────────────────
 *
 * Every word and figure on it arrives composed: `summary` is the same
 * "2× Laal maas · Masala chai" the orders list renders, `placedOn` is a date
 * in the PROPERTY's timezone, and `total` is an `ApiMoney.text` printed
 * verbatim (#5). The block exists at all only because the server said it
 * could — the designer's "Hidden if any line is now unavailable" is a
 * server-side availability check, so there is no branch here for a dish that
 * went off the menu and no half-reorder to explain.
 *
 * ─── The total is a memory, not a quote ────────────────────────────────────
 *
 * It is what that order COST. The cart this fills is priced live, exactly like
 * every other cart (`cart.ts`), so the figure here and the figure on the next
 * screen are allowed to differ — one is a receipt and the other is a price
 * today. Labelling it as the past order's, beside that order's number and
 * date, is what keeps the difference from reading as a bug.
 *
 * ─── Taps are swallowed, not queued ────────────────────────────────────────
 *
 * The same rule the quick-add and the stepper follow. A reorder is a cart
 * write, and two of them overlapping is four lines where there should be two.
 */
export function ReorderRow({
  reorder,
  onReorder,
}: {
  reorder: ApiReorder;
  /** Fills the cart and opens it. Resolves when the request has settled —
   *  the button stays busy until it does. */
  onReorder: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const tap = async () => {
    if (busy) return;
    setBusy(true);
    try { await onReorder(); } finally { setBusy(false); }
  };

  return (
    <View style={s.block}>
      <View style={s.head}>
        <Text style={s.eyebrow}>{HOME_COPY.reorderEyebrow}</Text>
        {/* The order's own identity, in one line: "KE-1142 · 12 Oct". Tabular
            so the number and the date do not wobble against the eyebrow. */}
        <Text style={[s.stamp, tabular]}>
          {reorder.orderNumber}
          {reorder.placedOn ? ` · ${reorder.placedOn}` : ''}
        </Text>
      </View>

      <View style={s.body}>
        <View style={s.lines}>
          {/* One line, and it may be long. It wraps rather than truncating:
              a reorder somebody cannot read the whole of is a reorder they
              have to open the history to understand. */}
          <Text style={s.summary}>{reorder.summary}</Text>
          <Text style={[s.total, tabular]}>{reorder.total.text}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${HOME_COPY.reorderAction}, ${reorder.summary}`}
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={() => void tap()}
          style={({ pressed }) => [s.button, pressed && !busy && s.buttonPressed]}
        >
          {({ pressed }) => {
            // Outlined until a thumb is on it, then filled — and the moment the
            // ground is saffron the ink becomes the GROUND colour, never white
            // and never another saffron.
            const ink = pressed && !busy ? colors.accentInk : colors.accent;
            return busy ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <>
                <RotateCcw size={16} color={ink} strokeWidth={2} strokeLinecap="round" />
                <Text style={[s.buttonLabel, { color: ink }]}>{HOME_COPY.reorderAction}</Text>
              </>
            );
          }}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  block: {
    // 20 under the greeting, which is the design's own figure here and the
    // same 20 the arch takes under the top row.
    marginTop: 20,
    gap: space[3],
    paddingVertical: space[4],
    // Two different rules on purpose: the HEAVIER one above, because this
    // block opens a new region under the greeting, and the lighter one below,
    // because what follows it is another section head with its own rule.
    borderTopWidth: 1,
    borderTopColor: colors.lineFaint,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },

  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space[2],
  },
  eyebrow: {
    ...face('mono'),
    fontSize: type.xs,
    // .12em at 11pt.
    letterSpacing: 1.32,
    textTransform: 'uppercase',
    color: colors.inkDim,
  },
  stamp: { ...face('mono'), fontSize: type.xs, color: colors.inkDim },

  body: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[4],
  },
  // `flex: 1` is RN's `min-width: 0` — without it a long summary pushes the
  // button off the right edge instead of wrapping.
  lines: { flex: 1, gap: 2 },
  summary: { ...face('display'), fontSize: type.lg, color: colors.ink },
  total: { ...face('mono'), fontSize: type.sm, color: colors.inkSecondary },

  button: {
    height: TOUCH_MIN,
    // `flex: none` — the button keeps its width and the summary gives way.
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingHorizontal: space[4],
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
  },
  buttonPressed: { backgroundColor: colors.accent },
  buttonLabel: { ...face('bodyMedium'), fontSize: type.base },
});
