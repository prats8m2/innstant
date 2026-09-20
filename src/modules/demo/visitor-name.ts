/**
 * The name a stranger types on the marketing site, made fit for a heading.
 *
 * Its own file, with no database import, for the reason `guest-name.ts` and
 * `kitchen-ticket.ts` are: a pure function is worth testing on its own, and a
 * test that has to stand up a Postgres connection to check that two spaces
 * become one is a test nobody runs.
 */

/** What a name field may contain before we stop taking it seriously. */
const MAX_NAME = 60;

/**
 * Trim, collapse and cap. A name typed on a phone arrives with whatever the
 * keyboard added; what is shown back on the guest screen should be what a
 * person would recognise as their name.
 *
 * Deliberately NOT sanitised beyond whitespace. React escapes at render, so
 * the defence is at the output — stripping apostrophes and accents here to
 * feel safer would mangle a large share of real names to solve a problem that
 * is already solved.
 *
 * Returns null for anything not worth greeting, so the caller carries on
 * without a name rather than writing an empty row.
 */
export function cleanVisitorName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return name.slice(0, MAX_NAME);
}
