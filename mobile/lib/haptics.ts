import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * The three moments this app is allowed to buzz. Phase 1 of the redesign.
 *
 * ─── Why there are exactly three functions and not a generic one ──────────
 *
 * A `haptic(style)` helper is an invitation to call it from the next screen
 * somebody touches, and haptics on everything is the fastest way to make an
 * app feel cheap — a phone that vibrates when you scroll is a phone you turn
 * the setting off on, which costs the two taps that were worth feeling.
 *
 * So the vocabulary is the list of events rather than the list of effects:
 * something went in the cart, something came out, the kitchen has the order.
 * Adding a fourth is a decision somebody has to make on purpose.
 *
 * ─── Light for the cart, success for the order ────────────────────────────
 *
 * Add and remove are the same weight on purpose. They are the same KIND of
 * event — a line of the cart changed — and giving removal a heavier tap would
 * tell somebody they had done something wrong by changing their mind.
 *
 * The order is the only one that gets the notification pattern, because it is
 * the only irreversible thing in the app: the kitchen has it, and the
 * three-beat success pattern is what the OS uses everywhere else to say a
 * thing has actually happened.
 *
 * ─── Fire and forget, deliberately ────────────────────────────────────────
 *
 * Every call is unawaited and its rejection is swallowed. The haptic engine
 * is missing on an emulator, disabled by the system setting, and absent on
 * web — none of which is a reason for `await addToCart()` to have failed.
 * A dropped buzz is invisible; an unhandled rejection in a cart handler is a
 * screen that stops working.
 */

/** A dish went into the cart. */
export function tapAdd(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A dish came out of it, or its quantity went down. */
export function tapRemove(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** The kitchen has the order. The one irreversible event in the app. */
export function orderPlaced(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/**
 * `Platform.OS` is checked rather than left to the module.
 *
 * `expo-haptics` has a web implementation that rejects with "not supported",
 * which the catch would handle — but it would also be a promise created and
 * rejected on every tap of the cart stepper in a browser, and the browser is
 * where this app is driven under test. Not asking is cheaper than not minding
 * the answer.
 */
function fire(effect: () => Promise<void>): void {
  if (Platform.OS === 'web') return;
  void effect().catch(() => {});
}
