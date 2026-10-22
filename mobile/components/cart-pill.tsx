import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import type { ApiCart } from '@/lib/api';
import { colors, face, radius, space, tabular, text as type, TOUCH_MIN } from '@/lib/theme';

/**
 * "Review order", floating over a list. Phase 2 drew it on the menu; phase 3
 * moved it out, because search needs the same one.
 *
 * ─── Why this is NOT the home screen's bar ────────────────────────────────
 *
 * `HomeBottomBar` cross-fades between two faces and carries a page of
 * reasoning about which one it shows; this is a pill that appears when there
 * is something in the cart and is absent when there is not. They look similar
 * and are different controls, and the tab layout's own note explains why the
 * app deliberately has no single global cart bar.
 *
 * What this replaces is a straight copy of the menu's pill in the search
 * screen — two implementations of one total, which is the thing that comment
 * warns about.
 *
 * ─── `bottom` is a parameter because the two screens sit differently ──────
 *
 * The menu is pushed over the tab bar and has the whole screen; search is a
 * TAB and has 72pt of bar plus the home indicator under it. A pill that
 * assumed one would be floating in the middle of the other, so the caller
 * passes the clearance it knows about.
 */
export function CartPill({ cart, bottom }: { cart: ApiCart; bottom: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Review your order, ${cart.itemCount} items, ${cart.totals.total.text}`}
      onPress={() => router.push('/cart')}
      style={({ pressed }) => [
        s.pill,
        { bottom },
        // Lighter, not darker. The single most common thing to get wrong
        // when porting this palette.
        pressed && { backgroundColor: colors.accentHover },
      ]}
    >
      <Text style={[s.count, tabular]}>{cart.itemCount}</Text>
      <Text style={s.label}>Review order</Text>
      <Text style={[s.total, tabular]}>{cart.totals.total.text}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: space[5],
    right: space[5],
    minHeight: TOUCH_MIN + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  count: {
    minWidth: 26,
    textAlign: 'center',
    ...face('monoMedium'),
    fontSize: type.sm,
    color: colors.accent,
    backgroundColor: colors.accentInk,
    borderRadius: radius.xs,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  label: { flex: 1, ...face('bodyMedium'), fontSize: type.base, color: colors.accentInk },
  total: { ...face('monoMedium'), fontSize: type.base, color: colors.accentInk },
});
