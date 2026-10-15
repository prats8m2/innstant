import { useEffect, useState } from 'react';
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
