import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, ShoppingBag } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ApiCart } from '@contract';
import { HOME_COPY } from '@/lib/copy';
import { useReducedMotion } from '@/lib/motion';
import {
  colors, duration, face, paperTransparent, radius, space, tabular, text as type,
} from '@/lib/theme';

/**
 * The one thing on this screen that does not scroll. D-080.
 *
 * ─── One box, two faces and two treatments ─────────────────────────────────
 *
 * It never changes height and never moves. An empty cart invites somebody into
 * the menu; the first add turns the same button into the cart with a running
 * total. A bar that resized between those would shift the page under a thumb
 * already travelling towards it.
 *
 * The designer's note is explicit that the swap is a cross-fade rather than a
 * replacement: "Swaps to View cart on first add with a 240ms cross-fade; the
 * total ticks in tabular figures so it does not shift." Because the box is
 * identical in both, the fade is opacity only — nothing is laid out twice.
 *
 * WHICH FACE and WHAT TREATMENT are two independent questions, and conflating
 * them is what stranded a cart filled at 2am:
 *
 *   · the FACE is the cart whenever there is a cart, open or shut. The design
 *     draws the closed state with an empty one, and its own note says adding
 *     still works while the kitchen is shut ("the cart's place-order button is
 *     replaced by the opening time"). A bar that went back to "Read the menu"
 *     the moment the kitchen closed would be the only button in the app with
 *     no route to the cart somebody had just filled.
 *   · the TREATMENT is filled saffron while the kitchen is cooking and
 *     outlined while it is not, in both faces. That is what the design means
 *     by "browsing stays fully open, ordering waits" — the button still goes
 *     somewhere, it just stops looking like a place-order.
 *
 * ─── The label and the destination are the same fact ───────────────────────
 *
 * `onBrowse` and `onCart`, not one `onPress`. A single handler is how a button
 * reading "View cart · 2 items  ₹2,480" came to open the menu.
 *
 * ─── The fade behind it is the same hue as the ground ──────────────────────
 *
 * `paper` to `paper at zero alpha`, not to `transparent`. On Android
 * `transparent` is BLACK at zero alpha, so a gradient that ends there goes
 * grey through the middle and the page visibly dirties as it scrolls under.
 *
 * The 16pt side padding is narrower than the body's 24 on purpose: the button
 * is meant to be wider than the text column it sits over.
 */
export function HomeBottomBar({
  cart,
  isOpen,
  dishCount,
  opensAt,
  onBrowse,
  onCart,
}: {
  cart: ApiCart | null;
  /** The kitchen's own state. Closed outlines the button and changes its
   *  right-hand figure — it never takes a destination away (#9). */
  isOpen: boolean;
  /** Distinct dishes on the menu, counted from the payload (#5's sibling rule:
   *  a figure on screen is derived, never typed). */
  dishCount: number;
  /** When ordering starts again — "noon" — or null. The server sets it only
   *  when a bare clock time is the whole truth; see `ApiOutlet.opensAt`. */
  opensAt: string | null;
  onBrowse: () => void;
  onCart: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const itemCount = cart?.itemCount ?? 0;
  const hasCart = itemCount > 0;

  // Starts where it already is, so an app resumed with a full cart shows the
  // cart face immediately instead of fading into it.
  const toCart = useRef(new Animated.Value(hasCart ? 1 : 0)).current;

  useEffect(() => {
    const to = hasCart ? 1 : 0;
    if (reduced) { toCart.setValue(to); return; }
    Animated.timing(toCart, {
      toValue: to,
      duration: duration.mid,
      useNativeDriver: true,
    }).start();
  }, [hasCart, reduced, toCart]);

  const browseLabel = isOpen ? HOME_COPY.ctaBrowse : HOME_COPY.ctaBrowseClosed;
  const cartLabel = `${HOME_COPY.ctaCart} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`;
  const dishes = `${dishCount} ${dishCount === 1 ? 'dish' : 'dishes'}`;

  /*
    The design's closed bar reads "Ordering opens 12:00" on the right, and it
    is the server that decides whether there is an hour worth printing. When
    there is not — a kitchen stopped by hand, or one reopening tomorrow, where
    the status strip two lines up has already said so in a full sentence — the
    dish count is still true and is what the open face shows anyway.
  */
  const browseFigure = !isOpen && opensAt ? `${HOME_COPY.ctaOpensAt} ${opensAt}` : dishes;

  // The ink on every glyph and figure in the box. Filled saffron takes the
  // GROUND; the outlined treatment takes saffron itself, because saffron on a
  // saffron wash is the one thing this palette must never draw.
  const ink = isOpen ? colors.accentInk : colors.accent;

  return (
    <View
      style={[s.wrap, { paddingBottom: space[5] - space[1] + insets.bottom }]}
      // The gradient is decoration over scrolling content; taps that miss the
      // button must reach the page underneath.
      pointerEvents="box-none"
    >
      <LinearGradient
        colors={[colors.paper, paperTransparent]}
        locations={[0.62, 1]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={hasCart
          ? `${cartLabel}, ${cart?.totals.total.text ?? ''}`
          : `${browseLabel}, ${browseFigure}`}
        // The label and the destination are one decision, made once.
        onPress={hasCart ? onCart : onBrowse}
        style={({ pressed }) => [
          s.cta,
          !isOpen && s.ctaOutlined,
          // Filled saffron goes LIGHTER under a thumb. The outlined one is the
          // single exception on this screen: a saffron wash behind saffron text
          // would leave the label unreadable, so it takes a tint of the ground.
          pressed && (isOpen ? s.ctaPressed : s.ctaOutlinedPressed),
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[s.face, { opacity: toCart.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
        >
          <Text style={[s.label, !isOpen && s.labelOutlined]}>{browseLabel}</Text>
          <View style={s.right}>
            <Text style={[s.figure, !isOpen && s.figureOutlined, tabular]}>{browseFigure}</Text>
            <ArrowRight size={18} color={ink} strokeWidth={2} strokeLinecap="round" />
          </View>
        </Animated.View>

        <Animated.View pointerEvents="none" style={[s.face, { opacity: toCart }]}>
          <View style={s.left}>
            <ShoppingBag size={20} color={ink} strokeWidth={2} strokeLinecap="round" />
            <Text style={[s.label, !isOpen && s.labelOutlined]}>{cartLabel}</Text>
          </View>
          {/* `.text` verbatim — formatted once, server-side, Indian-grouped
              (#5). Tabular so the digits do not shift width as it ticks. */}
          <Text style={[s.total, !isOpen && s.totalOutlined, tabular]}>
            {cart?.totals.total.text ?? ''}
          </Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space[6],
    paddingHorizontal: space[4],
  },

  cta: {
    width: '100%',
    height: 56,
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  ctaPressed: { backgroundColor: colors.accentHover },
  ctaOutlined: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  ctaOutlinedPressed: { backgroundColor: colors.accentTint },

  /** Both faces occupy the same box, so the cross-fade lays nothing out. */
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },

  left: { flexDirection: 'row', alignItems: 'center', gap: space[2] + 2 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space[2] },

  // The ground, never white — on every filled saffron surface in the app.
  label: { ...face('bodyMedium'), fontSize: type.lg, color: colors.accentInk },
  labelOutlined: { color: colors.accent },
  // Explicitly the regular weight: it sits beside a 600 label and does not
  // inherit from it.
  figure: { ...face('mono'), fontSize: type.sm, color: colors.accentInk },
  figureOutlined: { color: colors.accent },
  total: { ...face('monoMedium'), fontSize: type.base, color: colors.accentInk },
  totalOutlined: { color: colors.accent },
});
