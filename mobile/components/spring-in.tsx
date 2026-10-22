import { useEffect } from 'react';
import Animated, {
  useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/lib/motion';
import { duration } from '@/lib/theme';

/**
 * Something arriving at the size it was tapped at. Phase 4 of the redesign.
 *
 * ─── This is NOT a shared-element transition, and it is worth saying why ───
 *
 * The brief asked for the dish row's photograph to fly into the dish sheet.
 * React Native cannot do that here, for two separate reasons, and neither is
 * a thing this app can design its way around:
 *
 *   · Reanimated's shared-element transitions (`sharedTransitionTag`) were
 *     removed in Reanimated 4. This app is pinned at 4.5.1 and the pin is not
 *     ours to move — the worklets runtime is matched to it.
 *   · Even with them, they transition between two SCREENS of a navigator.
 *     The dish opens in a bottom sheet over the menu, which is a child of the
 *     screen that is already on top. There is no second screen to share with,
 *     and making one would undo phase 1's whole argument for the sheet.
 *
 * The remaining honest option was a ghost: measure the row's photograph, draw
 * a copy over everything, and fly it to where the sheet's photograph will be.
 * That needs the DESTINATION rect, and the destination is inside a sheet that
 * is mid-rise when it lays out — `measureInWindow` returns where it is at that
 * instant, not where it is going. Measuring after the rise settles means the
 * flight starts after the sheet has already arrived, which is a photograph
 * sliding around on a screen that has stopped moving. Both versions look
 * worse than nothing.
 *
 * ─── So: a spring scale-in, from the size it came from ─────────────────────
 *
 * The sheet's photograph starts at the dish row's 112pt and settles to its own
 * 84pt over a 300ms spring while the sheet rises underneath it. It does not
 * claim pixel continuity and does not pretend to be the same photograph. What
 * it does is make the sheet's picture start at the size of the one that was
 * tapped, so the eye reads it as the same object getting closer rather than as
 * a new thing appearing — which is most of what the real transition buys.
 *
 * ─── The one branch, in one place ──────────────────────────────────────────
 *
 * `ReducedMotionConfig` in the root layout already removes the TRAVEL: a
 * `withSpring` under reduced motion lands on its target immediately. What it
 * cannot decide is where the first frame starts, because that is a value and
 * not an animation — and starting at 1.33 and jumping to 1 is a flash. So
 * this component picks its own starting point, and it is the only place in
 * the app that has an entry state to pick one for.
 */
export function SpringIn({
  from,
  children,
}: {
  /** The starting scale, as a ratio of real sizes rather than a number
   *  somebody liked — see the caller. */
  from: number;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(reduced ? 1 : from);

  useEffect(() => {
    scale.value = withSpring(1, SPRING);
  }, [scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * 300ms, the top of the 180–320 band, with just enough overshoot to read as
 * physics rather than as a zoom.
 *
 * `duration` and `dampingRatio` rather than stiffness and mass: the band is
 * stated in milliseconds in `theme.css` and in `lib/theme.ts`, and a spring
 * specified by stiffness has no stated duration at all — it has one, but
 * nobody reviewing it can tell whether it is inside the band.
 */
const SPRING = { duration: duration.slow, dampingRatio: 0.78 };
