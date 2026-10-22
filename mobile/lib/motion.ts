import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether this phone has asked for less movement. D-080.
 *
 * ─── Why the app needs this now and did not before ─────────────────────────
 *
 * Nothing in the app animated until the home screen. Three things do: the
 * bottom bar cross-fading into the cart face, a live order's progress segment
 * filling, and the press transitions. CLAUDE.md asks for
 * `prefers-reduced-motion` to be respected on every surface, and the OS switch
 * React Native exposes is this one — `AccessibilityInfo`, which is the same
 * setting on both platforms (iOS "Reduce Motion", Android "Remove animations").
 *
 * ─── What honouring it means here ──────────────────────────────────────────
 *
 * Collapse to the END state, never to a half-played one. A segment that should
 * be filled is filled on the frame it changes; the bar swaps face instantly.
 * The information is identical — only the travel between states is removed,
 * which is the whole of what the setting asks for.
 *
 * Read once and subscribed to, because somebody can change it while the app is
 * open and a screen that only read it at mount would keep animating for the
 * rest of the session.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // The initial read is async on both platforms. Starting at `false` and
    // correcting is right rather than blocking the first paint on it: the only
    // animation that could begin before the answer arrives is one the person
    // triggered themselves.
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduced(enabled);
    });

    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      if (!cancelled) setReduced(enabled);
    });

    return () => { cancelled = true; sub.remove(); };
  }, []);

  return reduced;
}

/**
 * One millisecond. Phase 4, and the whole of what reduced motion costs.
 *
 * It is not zero. `Animated.timing` with a zero duration is a special case in
 * several easing implementations and in Reanimated's worklet scheduler, and a
 * zero-length animation is the kind of thing a library is allowed to decide
 * means "no animation" and skip — including skipping the completion callback
 * that the next thing was waiting on. 1ms is a real animation that lands on
 * the very next frame, so every code path downstream of it runs exactly as it
 * does at 240.
 */
export const REDUCED_MS = 1;

/**
 * What a duration MEANS on this phone. Phase 4.
 *
 * ─── Why this exists rather than a branch per component ────────────────────
 *
 * Every animating component used to carry the same three lines:
 *
 *     if (reduced) { value.setValue(to); return; }
 *     Animated.timing(value, { toValue: to, duration: duration.mid, … })
 *
 * Four components had it, each with its own chance to forget. The fifth one
 * somebody writes is the one that animates for a person who asked it not to,
 * and nothing fails — the bug is invisible to everybody who does not have the
 * setting turned on, which is almost everybody who would review it.
 *
 * So the decision moves into the duration itself. A component asks what
 * `duration.mid` is worth right now and animates for that long, with no branch
 * and no second code path:
 *
 *     const ms = useDuration();
 *     Animated.timing(value, { toValue: to, duration: ms(duration.mid), … })
 *
 * The end state is identical either way, which is what the setting asks for —
 * the information arrives, the travel does not. And because there is only one
 * path, the reduced-motion path is the same path everybody else exercises
 * rather than a branch nobody runs.
 *
 * ─── Reanimated is handled in the root layout instead ──────────────────────
 *
 * This covers React Native's own `Animated`, which has no global switch.
 * Reanimated has one — `ReducedMotionConfig`, mounted once in
 * `app/_layout.tsx` — and it reaches the skeletons, the dish screen's
 * parallax and the bottom sheet's rise, none of which this hook can see.
 */
export function useDuration(): (ms: number) => number {
  const reduced = useReducedMotion();
  return useCallback((ms: number) => (reduced ? REDUCED_MS : ms), [reduced]);
}
