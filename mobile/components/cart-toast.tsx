import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CloudOff, Undo2 } from 'lucide-react-native';
import { useSession } from '@/lib/session';
import { useDuration } from '@/lib/motion';
import {
  colors, duration, face, radius, space, TAB_BAR_H, text as type, TOUCH_MIN,
} from '@/lib/theme';

/**
 * What a rolled-back cart tap says. Phase 4 of the redesign.
 *
 * ─── Why a rollback needs words at all ─────────────────────────────────────
 *
 * The cart is optimistic now: the count moves on the tap and the server is
 * asked afterwards. When the server refuses, the count has to go back — and a
 * number that goes up and then comes down on its own is the worst thing this
 * screen can do. It is indistinguishable from an add that worked and then
 * evaporated, and somebody who sees it twice stops trusting the cart, which
 * is the one part of the app that spends money.
 *
 * So the rollback and the sentence are set in the same commit, in
 * `session.adjust`. This draws it. "Not added." is the app saying what
 * happened to the tap; the sentence after it is the kitchen's or the
 * network's, verbatim.
 *
 * ─── Mounted once, in the root layout ──────────────────────────────────────
 *
 * A dish row exists on three screens and the refusal is the same refusal on
 * all of them. The alternative was a floating `Notice` per screen — which is
 * what the menu had, and search had its own, and the home screen a third —
 * three positions, three dismissal rules and three chances for the sentence
 * to be missing on the screen somebody was actually on.
 *
 * ─── Where it sits ─────────────────────────────────────────────────────────
 *
 * Above the tallest thing the bottom of this app ever holds: a tab bar with a
 * cart pill floating over it. It is placed for that case everywhere, so on
 * the pushed menu screen — which has a pill and no tab bar — it floats a bar's
 * height higher than it strictly needs to. That is the trade for one position
 * instead of a prop every screen has to get right, and the alternative is the
 * toast landing on top of the cart total on the one screen where somebody is
 * most likely to be reading it.
 */
export function CartToast() {
  const { cartNotice, dismissCartNotice } = useSession();
  const insets = useSafeAreaInsets();
  const ms = useDuration();

  /** Kept after the notice clears, so the bar has something to draw while it
   *  is sliding out. Cleared only by the next notice replacing it. */
  const shown = useRef(cartNotice);
  if (cartNotice) shown.current = cartNotice;

  const on = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(on, {
      toValue: cartNotice ? 1 : 0,
      duration: ms(duration.base),
      useNativeDriver: true,
    }).start();
  }, [cartNotice, ms, on]);

  /**
   * It goes by itself after five seconds.
   *
   * Not a motion value and deliberately not from `duration`: nothing is
   * animating for five seconds, this is how long a sentence stays readable.
   * Long enough to finish reading one line twice, short enough that it is not
   * still sitting over the menu when somebody taps the next dish.
   */
  useEffect(() => {
    if (!cartNotice) return;
    const timer = setTimeout(dismissCartNotice, 5000);
    return () => clearTimeout(timer);
  }, [cartNotice, dismissCartNotice]);

  const notice = shown.current;
  if (!notice) return null;

  const offline = notice.kind === 'offline';
  const Icon = offline ? CloudOff : Undo2;
  const ink = offline ? colors.attention : colors.critical;

  return (
    <View
      pointerEvents="box-none"
      style={[s.wrap, { bottom: insets.bottom + TAB_BAR_H + TOUCH_MIN + space[5] }]}
    >
      <Animated.View
        style={{
          opacity: on,
          // Up from under itself, by its own height rather than a guess at
          // the screen's — a bar that slides in from off-screen crosses the
          // tab bar on the way and reads as something being dragged out of it.
          transform: [{
            translateY: on.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
          }],
        }}
        // Gone from the tree for a screen reader AND untappable once it has
        // faded, which `opacity: 0` alone is not.
        pointerEvents={cartNotice ? 'auto' : 'none'}
      >
        <Pressable
          accessibilityRole="alert"
          accessibilityLabel={`${notice.lead} ${notice.message}. Tap to dismiss.`}
          onPress={dismissCartNotice}
          style={({ pressed }) => [s.bar, { borderLeftColor: ink }, pressed && s.pressed]}
        >
          <Icon size={18} color={ink} strokeWidth={2} />
          <Text style={s.text}>
            <Text style={[s.lead, { color: ink }]}>{notice.lead}</Text>
            {' '}{notice.message}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: space[5], right: space[5] },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    minHeight: TOUCH_MIN,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    /* A card, not a tint. This sits over a scrolling menu rather than inside
       a column of content, and it has to be opaque enough to read a sentence
       through — the `Notice` treatment is a tinted panel that belongs in a
       flow with a ground behind it. */
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 3,
  },
  pressed: { backgroundColor: colors.raised },
  text: { flex: 1, ...face('body'), fontSize: type.sm, lineHeight: 20, color: colors.ink },
  lead: { ...face('bodyMedium') },
});
