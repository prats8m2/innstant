import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, text as type, tabular, TOUCH_MIN } from '@/lib/theme';

/**
 * The + and − on a menu card. D-080.
 *
 * ─── What phase 4 changed, and why the busy state went ─────────────────────
 *
 * This used to hold its own `busy` flag: a tap disabled the control, replaced
 * the count with a `·` and waited for the round trip. The cart is a table and
 * not client state, so that was honest — but it meant the number a person had
 * just changed was the one thing on screen that would not move, for as long
 * as hotel wifi took.
 *
 * The cart is optimistic now. `session.adjust` moves the count on the tap and
 * reconciles when the server answers, so `quantity` arriving here is already
 * the number this tap produced and there is nothing to wait for and nothing
 * to hide. A refusal rolls it back and says so — see `CartToast`.
 *
 * The swallow is unchanged and moved up: taps for a dish with a write in the
 * air are dropped rather than queued, because four overlapping writes against
 * one cart row is a race the UI should not start. It lives in `adjust` now,
 * because the stepper is no longer the only thing that can start one — the
 * featured rail's quick-add and the home screen's rows go through the same
 * door. A control that disabled itself would be a second, weaker copy of a
 * rule that is already enforced where it matters.
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
  if (quantity === 0) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${label}`}
        onPress={() => void onAdjust('add')}
        style={({ pressed }) => [s.add, pressed && s.pressed]}
      >
        <Text style={s.addText}>+</Text>
      </Pressable>
    );
  }

  return (
    <View style={s.group}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One fewer ${label}`}
        onPress={() => void onAdjust('remove')}
        style={({ pressed }) => [s.step, pressed && s.pressed]}
      >
        <Text style={s.stepText}>−</Text>
      </Pressable>

      <Text style={[s.count, tabular]} accessibilityLiveRegion="polite">
        {quantity}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One more ${label}`}
        onPress={() => void onAdjust('add')}
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
});
