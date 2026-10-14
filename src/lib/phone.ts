/**
 * One phone number, one row. D-081.
 *
 * In `src/lib` rather than `modules/customer` because it is cross-cutting like
 * money and dates: `modules/stay` owns `guests` and has to normalise before it
 * writes, and a stay → customer → stay import cycle to reach one pure function
 * is not a module boundary worth having.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 *
 * `guests` is unique on `(tenant_id, phone)` — EXTENSION-POINTS §2 — and that
 * uniqueness is only worth anything if the same human number always produces
 * the same string. "+91 98290 11111", "9829011111" and "+919829011111" are one
 * person, and without normalisation they are three rows, three accounts and
 * three order histories.
 *
 * Worse, they are three separate rate-limit buckets: an attacker who wants
 * more than five OTP attempts just adds a space.
 *
 * ─── Why this is not libphonenumber ────────────────────────────────────────
 *
 * CLAUDE.md says take the package for a solved problem, and phone parsing is
 * one — `libphonenumber-js` is the right answer the day this product sells
 * outside India. It is ~145KB, which is over the ~50KB bar that says ask
 * first, and today every property is `Asia/Kolkata` with an INR currency.
 *
 * So this is deliberately narrow: it canonicalises Indian numbers and leaves
 * anything else alone rather than guessing. When a second country arrives,
 * this function is the one place that has to change, and the test beside it
 * says what it promised.
 */

/** E.164 for an Indian mobile; otherwise the input, trimmed of noise. */
export function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, '');

  // Already E.164 India.
  if (/^\+91[6-9]\d{9}$/.test(digits)) return digits;

  // 00 as the international prefix, which a phone's own keypad produces.
  if (/^0091[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(4)}`;

  // Bare ten digits starting 6-9 — the way anybody in India writes their own
  // number. The leading-digit check is what stops a landline or a short code
  // being promoted to a mobile.
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;

  // A trunk-prefixed ten digits: 0 98290 11111.
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;

  // Not something this function understands. Returned with separators removed
  // so it is at least stable, and NOT rejected: a property outside India must
  // still be able to take an order.
  return digits;
}

/** Is this something we can actually send an SMS to? */
export function isDialable(normalised: string): boolean {
  const digits = normalised.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * For a screen: `+91 98290 11111`.
 *
 * Never for storage or comparison — `normalisePhone` owns those. This exists
 * so the app can show somebody the number it is about to text without them
 * reading a run of thirteen digits.
 */
export function formatPhone(normalised: string): string {
  const m = normalised.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : normalised;
}
