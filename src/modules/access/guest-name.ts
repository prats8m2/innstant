/**
 * What to call a guest.
 *
 * Pure — no database, no clock — for the same reason `tiers.ts` is: it is a
 * rule, it is easy to get subtly wrong, and the only way to hold it still is a
 * test that can import it without a connection.
 */
/**
 * "Anjali Menon" → "Anjali". "Farah & Omar Haddad" → "Farah & Omar".
 *
 * A stay's `full_name` is whatever the desk typed, and a hotel's guest list is
 * full of things that are not "First Last": couples booked on one name, a
 * single mononym, an honorific, a name entered in the wrong order. So this is
 * conservative — it drops a trailing surname when the shape is clearly
 * "something Surname", keeps everything otherwise, and returns null rather
 * than guessing at anything it cannot read.
 *
 * Getting this wrong is not a rendering bug. It is a screen that greets a guest
 * by the wrong half of their name for the length of their stay.
 */
export function firstNameOf(fullName: string | null): string | null {
  const trimmed = fullName?.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  // One word is the whole name, whatever it is.
  if (parts.length === 1) return parts[0]!;
  // A joined booking — "Farah & Omar Haddad" — keeps both people and loses the
  // shared surname. Greeting only Farah would be worse than greeting neither.
  const joiner = parts.findIndex((p) => p === '&' || p.toLowerCase() === 'and');
  if (joiner > 0) return parts.slice(0, joiner + 2).join(' ');
  return parts[0]!;
}
