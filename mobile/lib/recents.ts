import * as SecureStore from 'expo-secure-store';

/**
 * The last few things somebody searched for. Phase 3 of the redesign.
 *
 * ─── Why the keychain, for something that is not a secret ─────────────────
 *
 * It is the only durable store this app already has. React Native dropped
 * `AsyncStorage` from core, and the community package is a NATIVE module —
 * adding one means a prebuild and a new dependency in the middle of a phase,
 * to hold six short strings. `expo-secure-store` is already installed and
 * already wrapped for exactly this failure shape in `api.ts`.
 *
 * It is a slightly odd home and worth saying so plainly: the keychain is for
 * credentials, and search terms are not. Nothing here is sensitive, nothing
 * here is sent anywhere, and if a real key-value store ever lands for another
 * reason, this is four lines to move. What would NOT be acceptable is the
 * other direction — a token in a plaintext store because the recents went
 * there first.
 *
 * ─── In memory first, so the web target still works ───────────────────────
 *
 * SecureStore no-ops on web, which is where this app is driven under test.
 * The cache is therefore the source of truth within a session and the
 * keychain is what survives a relaunch — so recents work in a browser for as
 * long as the tab is open, and on a phone forever. The same shape `api.ts`'s
 * `keychain()` uses, and for the same reason: a device that cannot persist
 * must still work now.
 */

const KEY = 'kesari.search.recents';

/**
 * Six.
 *
 * It is a list under a keyboard on a 390pt screen — four rows are visible
 * before the fold on the shortest phone the app targets, and a seventh entry
 * is one nobody scrolls to. Android's SecureStore also refuses values over
 * 2048 bytes, which six menu-length terms come nowhere near and sixty might.
 */
const LIMIT = 6;

/** Undefined until the first read. Null is a real answer — nothing stored. */
let cached: string[] | undefined;

export async function readRecents(): Promise<string[]> {
  if (cached !== undefined) return cached;

  try {
    const raw = await SecureStore.getItemAsync(KEY);
    cached = raw ? (JSON.parse(raw) as string[]).filter((term) => typeof term === 'string') : [];
  } catch {
    // A keychain that throws, or a value somebody's older build wrote in a
    // shape this one cannot read. Neither is worth a broken screen over a
    // convenience, and the next write repairs it.
    cached = [];
  }
  return cached;
}

/**
 * Remember a term, newest first, case-insensitively de-duplicated.
 *
 * Returns the new list rather than nothing, so the caller sets state from
 * the same value that was stored instead of re-reading it.
 */
export async function rememberSearch(term: string): Promise<string[]> {
  const trimmed = term.trim();
  if (!trimmed) return readRecents();

  const existing = await readRecents();
  // "Laal maas" typed again after "laal maas" is the same search, and the
  // spelling that survives is the newer one — it is what they just typed.
  const next = [
    trimmed,
    ...existing.filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase()),
  ].slice(0, LIMIT);

  return write(next);
}

export async function forgetSearch(term: string): Promise<string[]> {
  const existing = await readRecents();
  return write(existing.filter((entry) => entry !== term));
}

export async function clearRecents(): Promise<string[]> {
  return write([]);
}

async function write(next: string[]): Promise<string[]> {
  cached = next;
  try {
    if (next.length > 0) await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // The in-memory copy holds for this session. Losing the list on the next
    // launch is a smaller harm than a search box that throws.
  }
  return next;
}
