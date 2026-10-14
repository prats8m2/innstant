import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Linking from 'expo-linking';
import { Button, Loading, Notice, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';
import { DEFAULT_LINK_CODE } from '@/lib/api';
import { colors, radius, space, text as type } from '@/lib/theme';

/**
 * The boot screen. D-080.
 *
 * ─── It is not a screen anybody should SEE ─────────────────────────────────
 *
 * This app belongs to one restaurant. Its icon says so and its name says so,
 * and a first screen asking "which restaurant?" would be asking a question the
 * branding has already answered — the same wall #9 exists to remove, just
 * moved to the front door.
 *
 * So: open `DEFAULT_LINK_CODE` and go straight to the menu. On a warm start a
 * stored session skips even that. What renders here is only ever the half
 * second before a redirect, or a failure worth explaining.
 *
 * ─── What still overrides the default ──────────────────────────────────────
 *
 * A DEEP LINK — somebody tapped `innstant.in/p/{code}` for a specific table —
 * and a SCAN, reachable from the menu. Both call `open()` with their own code
 * and replace whatever this opened. A deep link that arrives while the default
 * is still loading wins: `claimed` below is what stops the slower default
 * landing on top of the table somebody actually scanned.
 */
export default function Boot() {
  const { open, isLoading, session } = useSession();
  const [error, setError] = useState<string | null>(null);

  /**
   * Set the instant anything commits to a code — a deep link, or the default.
   *
   * Without it the two race: `getInitialURL()` resolves a table code while the
   * default is mid-flight, both call `open()`, and the customer lands on
   * whichever network call finished last. A ref rather than state because the
   * effects below read it synchronously, before any re-render could deliver it.
   */
  const claimed = useRef(false);

  const openCode = useCallback(async (code: string) => {
    if (claimed.current) return;
    claimed.current = true;
    try {
      await open(code);
    } catch (failure) {
      claimed.current = false;
      setError(failure instanceof Error ? failure.message : 'That did not work.');
    }
  }, [open]);

  // A link that launched the app, or arrived while it was running. Checked
  // BEFORE the default, so a tapped table link is never overtaken by it.
  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      const code = url && extractCode(url);
      if (code) void openCode(code);
    });

    const sub = Linking.addEventListener('url', ({ url }) => {
      const code = extractCode(url);
      // A deep link arriving while the app is OPEN replaces the current
      // context deliberately — somebody sat down at a table and scanned.
      if (code) { claimed.current = false; void openCode(code); }
    });

    return () => sub.remove();
  }, [openCode]);

  useEffect(() => {
    if (isLoading) return;

    // A live session from a previous launch. Straight to the menu — a cold
    // start should not cost a round trip to learn what it already knows.
    if (session) { router.replace('/menu'); return; }

    void openCode(DEFAULT_LINK_CODE);
  }, [isLoading, session, openCode]);

  if (!error) return <Loading label="Opening the menu" />;

  /**
   * The only state worth rendering: the default link did not open.
   *
   * Which means the server is unreachable, or the link was revoked — and the
   * second is a real possibility for a code compiled into an app somebody
   * installed in March. Retry covers the first; scanning covers the second,
   * because a customer standing in the restaurant has a working code on the
   * table in front of them.
   */
  return (
    <Screen style={s.center}>
      <View style={s.mark} accessible accessibilityLabel="The Kesari">
        <Text style={s.markText}>के</Text>
      </View>
      <Text style={s.title}>The menu did not load</Text>
      <Notice>{error}</Notice>
      <Button
        label="Try again"
        onPress={() => { setError(null); void openCode(DEFAULT_LINK_CODE); }}
      />
      <Button label="Scan a code instead" tone="quiet" onPress={() => router.push('/scan')} />
    </Screen>
  );
}

/**
 * The code out of whatever we were given.
 *
 * A full URL, a path, or a bare code — all three happen: the first from a deep
 * link, the second from a half-copied link, the third from reading a card
 * aloud. The shape check is the server's own (`resolveVisitLink`), kept in
 * step deliberately: a code this rejects would be rejected there anyway, and a
 * round trip to learn that is a second of somebody's evening.
 *
 * Room stickers (`/r/{code}`) are matched too, so a guest who scans the card on
 * a nightstand reaches the right place rather than nothing.
 */
export function extractCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const fromPath = trimmed.match(/\/[pr]\/([A-Za-z0-9_-]+)/);
  const candidate = fromPath ? fromPath[1]! : trimmed;

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(candidate)) return null;
  return candidate;
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', paddingHorizontal: space[5], gap: space[4] },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { fontSize: type.xl, fontWeight: '700', color: colors.accentInk },
  title: { fontSize: type.xl, fontWeight: '600', color: colors.ink },
});
