/**
 * The small, pure half of the console's search (⌘K): what a typed query
 * becomes before any module turns it into SQL.
 *
 * Every pattern here is passed to Postgres as a PARAMETER, never spliced into
 * the statement; escaping `%` and `_` is about meaning ("50%" should not match
 * every room), not about injection.
 */

/** Longer than anything worth searching for, short enough to bound the work. */
export const SEARCH_MAX_LENGTH = 60;

/** `LIKE`'s own wildcards, and its escape character, made literal. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function likePrefix(term: string): string {
  return `${escapeLike(term)}%`;
}

export function likeContains(term: string): string {
  return `%${escapeLike(term)}%`;
}

/**
 * Collapse what somebody typed into one tidy line: trimmed, inner runs of
 * space made single, cut to the maximum. Empty means "do not search".
 */
export function normaliseQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_LENGTH);
}

/**
 * An order number the way a guest says it down the phone, as the letters and
 * digits of the stored one. "KE-1186", "ke 1186", "#1186" and "1186" all
 * become something `KE1186` contains. Null when there is no digit in it —
 * order numbers always have one, and "Priya" should not scan the orders.
 */
export function orderNeedle(query: string): string | null {
  const needle = query.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /\d/.test(needle) ? needle : null;
}

/**
 * Whether a query could be a person's name: two characters at least (one
 * letter matches half the guest book), and at least one letter in it.
 */
export function looksLikeName(query: string): boolean {
  return query.length >= 2 && /\p{L}/u.test(query);
}
