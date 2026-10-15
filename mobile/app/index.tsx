import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
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
 * So: open `DEFAULT_LINK_CODE` and go straight to the home screen. On a warm
 * start a stored session skips even that. What renders here is only ever the
 * half second before a redirect, or a failure worth explaining.
 *
 * ─── What still overrides the default ──────────────────────────────────────
 *
 * A DEEP LINK and a SCAN, and neither of them passes through here any more.
 *
 * Expo Router owns the launch URL: a tap on `innstant.in/p/{code}` is routed
 * to `/p/{code}` before any screen mounts, so this screen never sees it and
 * the `Linking.getInitialURL()` that used to live here never ran for a cold
 * launch. It is `app/p/[code].tsx` and `app/r/[code].tsx` that handle those
 * now, which is also why a deep link cannot race the default: the router
 * simply never comes here.
 *
 * ─── `extractCode` used to live here, and no longer does ───────────────────
 *
 * There were two verbatim copies of it — one here, one in `lib/open-link.ts` —
 * and the scanner imported the one on a BOOT SCREEN. That made a screen
 * nobody sees into a dependency of the camera, so rewriting this file broke
 * the scanner at a distance. The lib copy is the one that survives, and it is
 * the copy the deep-link routes already used.
 */
export default function Boot() {
  const { open, isLoading, session } = useSession();
  const [error, setError] = useState<string | null>(null);

  /**
   * One attempt per mount.
   *
   * The effect below depends on `isLoading` and `session`, both of which move
   * while a request is in flight — without this, a re-render fires a second
   * `open()` against the same link and the customer lands on whichever
   * finished last. A ref rather than state because the effect reads it
   * synchronously, before a re-render could deliver it.
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

  useEffect(() => {
    if (isLoading) return;

    // A live session from a previous launch. Straight through — a cold start
    // should not cost a round trip to learn what it already knows.
    if (session) { router.replace('/home'); return; }

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
