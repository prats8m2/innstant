import { useCallback } from 'react';
import { router } from 'expo-router';
import { useSession } from './session';

/**
 * Opening a code, from wherever it came from. D-081.
 *
 * One implementation shared by the boot screen, the scanner and both deep-link
 * routes — because "what happens when somebody gives us a code" is one
 * question, and four copies of the answer is three chances for them to
 * disagree about what a revoked link does.
 */
export function useLinkOpener() {
  const { open } = useSession();

  return useCallback(async (raw: string) => {
    const code = extractCode(raw);

    if (!code) {
      // Not a code at all. Home, which opens the default link — the one
      // thing that always works.
      router.replace('/');
      return;
    }

    try {
      await open(code);
    } catch {
      // `open()` already surfaces the server's own sentence through the
      // session context; this is the navigation half.
      router.replace('/');
    }
  }, [open]);
}

/**
 * The code out of whatever we were given.
 *
 * A full URL, a path, or a bare code — all three happen: the first from a deep
 * link, the second from a half-copied link, the third from reading a card
 * aloud. The shape check is the server's own (`resolveVisitLink`), kept in
 * step deliberately: a code this rejects would be rejected there anyway, and a
 * round trip to learn that is a second of somebody's evening.
 */
export function extractCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const fromPath = trimmed.match(/\/[pr]\/([A-Za-z0-9_-]+)/);
  const candidate = fromPath ? fromPath[1]! : trimmed;

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(candidate)) return null;
  return candidate;
}
