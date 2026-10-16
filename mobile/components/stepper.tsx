import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, text as type, tabular, TOUCH_MIN } from '@/lib/theme';

/**
 * The + and − on a menu card. D-080.
 *
 * ─── Why it holds its own busy state ───────────────────────────────────────
 *
 * Every tap is a round trip — the cart is a table, not client state, exactly
 * as it is on the web. A stepper that re-rendered the whole list while one
 * card was in flight would make the other thirty flicker, so the pending state
 * is local and the cart that comes back replaces the shared one.
 *
 * Taps are swallowed while one is in flight rather than queued. Somebody
 * jabbing + four times means four, and four overlapping writes against one
 * cart row is a race the UI should not start — the server merges identical
 * lines, so the quantity that lands is the quantity they can see.
 */
export function Stepper({
  quantity,
  onAdjust,
  label,
}: {
  quantity: number;
  onAdjust: (direction: 'add' | 'remove') => Promise<void>;
  /** For the screen reader: "One more Laal maas". */
  label: string;
}) {
  const [busy, setBusy] = useState(false);

  const tap = async (direction: 'add' | 'remove') => {
    if (busy) return;
    setBusy(true);
    try {
      await onAdjust(direction);
    } finally {
      setBusy(false);
    }
  };

  if (quantity === 0) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${label}`}
        disabled={busy}
        onPress={() => void tap('add')}
        style={({ pressed }) => [s.add, pressed && s.pressed, busy && s.busy]}
      >
        {busy ? <ActivityIndicator size="small" color={colors.accent} /> : <Text style={s.addText}>+</Text>}
      </Pressable>
    );
  }

  return (
    <View style={s.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One fewer ${label}`}
        disabled={busy}
        onPress={() => void tap('remove')}
        style={({ pressed }) => [s.step, pressed && s.pressed]}
      >
        <Text style={s.stepText}>−</Text>
      </Pressable>

      <Text style={[s.count, tabular]} accessibilityLiveRegion="polite">
        {busy ? '·' : quantity}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One more ${label}`}
        disabled={busy}
        onPress={() => void tap('add')}
        style={({ pressed }) => [s.step, pressed && s.pressed]}
      >
        <Text style={s.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * 48, which is `TOUCH_MIN` and what everything else in the app uses.
 *
 * It was 44 — Apple's floor rather than Android's — because the control used
 * to sit in the row beside the dish name, and the four points pushed the name
 * onto a second line on a 390pt screen. Phase 2 moved it over the photograph,
 * into a 112pt column of its own, so the reason is gone and the bigger target
 * costs nothing.
 */
const SIZE = TOUCH_MIN;

const s = StyleSheet.create({
  add: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  addText: { fontSize: type.xl, lineHeight: 26, color: colors.accent, fontWeight: '600' },

  group: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentTint,
  },
  step: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: type.lg, color: colors.accent, fontWeight: '600' },
  count: { minWidth: 20, textAlign: 'center', fontSize: type.base, fontWeight: '700', color: colors.ink },

  pressed: { backgroundColor: colors.raised },
  busy: { opacity: 0.6 },
});
