import { randomUUID } from 'expo-crypto';

/**
 * A UUID that exists on a phone. D-080.
 *
 * ─── Why this file exists at all ───────────────────────────────────────────
 *
 * `crypto.randomUUID()` is a WEB global. Hermes does not have a `crypto`
 * object, so the call throws `ReferenceError: Property 'crypto' doesn't
 * exist` — and it threw from a `useState` initialiser, which means the cart
 * screen died before it rendered anything. Tapping "Review order" closed the
 * app.
 *
 * It survived review because every screen was verified through Expo's WEB
 * target, where `crypto` is the browser's and works perfectly. That is the
 * precise limit of that verification, written down in mobile/README.md before
 * this happened and now demonstrated: a browser cannot prove a phone.
 *
 * `expo-crypto`'s `randomUUID()` is a real v4 from the platform CSPRNG —
 * `SecRandomCopyBytes` on iOS, `SecureRandom` on Android. Not `Math.random()`:
 * this value is an idempotency key (#8), and two customers colliding on one
 * would mean the second tap returns the first person's order.
 */
export function newIdempotencyKey(): string {
  return randomUUID();
}
