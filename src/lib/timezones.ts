/**
 * The timezones a property can be set to, including the one it is already on.
 *
 * ─── The bug this exists to prevent ────────────────────────────────────────
 *
 * A `<select>` whose `value` matches no `<option>` does not render empty. The
 * browser selects the FIRST option, and the next submit posts that — so a form
 * opened to change the hotel's NAME silently moved its clock.
 *
 * That is not hypothetical: it happened here. `Intl.supportedValuesOf` returns
 * whatever spelling the runtime's ICU considers canonical, and on the Node this
 * is built with that is `Asia/Calcutta`, not `Asia/Kolkata` — which is the value
 * `provisionProperty()` stores and the one every property in the product is on.
 * The list had 418 valid zones and not the one zone that mattered, the select
 * fell back to `Africa/Abidjan`, and an e2e that only typed a new name moved The
 * Kesari to Ivory Coast. Every guest-facing time is rendered in this value.
 *
 * ─── Why the list is fixed rather than the stored value ────────────────────
 *
 * The obvious alternative is to canonicalise on write, so what is stored always
 * matches what is offered. That makes the database depend on the ICU build of
 * whichever machine last saved — a hotel set up on one Node would read
 * `Asia/Kolkata` and on another `Asia/Calcutta`, for the same hotel. Both are
 * valid IANA identifiers and both resolve correctly; the one a property chose is
 * the one it keeps.
 */
export function offeredTimezones(current: string): string[] {
  const supported = Intl.supportedValuesOf('timeZone');
  if (supported.includes(current)) return supported;
  // Sorted in, not appended: a list of 418 alphabetical zones with one stray at
  // the bottom is a list somebody scrolls past.
  return [...supported, current].sort((a, b) => a.localeCompare(b));
}
