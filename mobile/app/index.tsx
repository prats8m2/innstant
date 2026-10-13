import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Loading, Notice, Screen, Title } from '@/components/ui';
import { useSession } from '@/lib/session';
import { colors, radius, space, text as type } from '@/lib/theme';

/**
 * The way in. D-080.
 *
 * ─── Three ways to arrive, one of them the real one ────────────────────────
 *
 *   1. A UNIVERSAL LINK. Somebody taps `innstant.in/p/{code}` in a message or
 *      a bio and the OS opens this app instead of the browser. This is the
 *      path that matters and the one the app exists for — see `app.json` for
 *      the `associatedDomains` and `intentFilters` that make it work.
 *   2. The CAMERA, for a code on a table that was never a link anybody tapped.
 *   3. TYPING it, which exists because the first two fail in ways a person
 *      cannot fix: a camera permission refused, a QR too scratched to read,
 *      an iPhone that decided to open Safari anyway.
 *
 * ─── What this screen deliberately does not have ───────────────────────────
 *
 * A sign-in. There is none in this product (#9), and an app whose first screen
 * asks for a phone number is the wall D-012 was written to remove. Somebody
 * who has a link is one tap from a menu.
 */
export default function Entry() {
  const { open, isLoading, session } = useSession();
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();

  const openCode = useCallback(async (raw: string) => {
    const trimmed = extractCode(raw);
    if (!trimmed) {
      setError('That does not look like a link from a restaurant.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await open(trimmed);
    } catch (failure) {
      // The server's own sentence. It says what happened and what to do, and
      // the app does not second-guess it.
      setError(failure instanceof Error ? failure.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }, [open]);

  /**
   * A link that launched the app, or arrived while it was running.
   *
   * `getInitialURL` covers a cold start — the app was not running and the OS
   * handed it a URL. The listener covers the warm case, which is the common
   * one: somebody already has the app open, switches to WhatsApp, and taps a
   * link. Without the listener that tap does nothing at all.
   */
  useEffect(() => {
    if (params.code) void openCode(params.code);
  }, [params.code, openCode]);

  useEffect(() => {
    let cancelled = false;

    void Linking.getInitialURL().then((url) => {
      if (!cancelled && url) {
        const found = extractCode(url);
        if (found) void openCode(found);
      }
    });

    const sub = Linking.addEventListener('url', ({ url }) => {
      const found = extractCode(url);
      if (found) void openCode(found);
    });

    return () => { cancelled = true; sub.remove(); };
  }, [openCode]);

  // A live session from a previous launch goes straight to the menu. Showing
  // this screen first would make every cold start a screen somebody has to
  // get past.
  useEffect(() => {
    if (!isLoading && session) router.replace('/menu');
  }, [isLoading, session]);

  if (isLoading) return <Loading />;

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[
            s.body,
            { paddingTop: insets.top + space[7], paddingBottom: insets.bottom + space[5] },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.mark} accessible accessibilityLabel="The Kesari">
            <Text style={s.markText}>के</Text>
          </View>

          <Title>Order from the table</Title>
          <Text style={s.lede}>
            Scan the code on your table, or open the link the restaurant sent
            you. No account, nothing to sign up for.
          </Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/scan')}
            style={({ pressed }) => [s.scan, pressed && { backgroundColor: colors.raised }]}
          >
            <Text style={s.scanIcon}>⌗</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.scanTitle}>Scan a code</Text>
              <Text style={s.scanSub}>The one on your table or at the counter</Text>
            </View>
          </Pressable>

          <View style={s.orRow}>
            <View style={s.rule} />
            <Text style={s.or}>or type it</Text>
            <View style={s.rule} />
          </View>

          <TextInput
            value={code}
            onChangeText={(value) => { setCode(value); setError(null); }}
            placeholder="the-kesari-table-4"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            // `url`, so the keyboard offers a slash and no autocorrection —
            // somebody is as likely to paste a whole link as to type a code.
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => void openCode(code)}
            style={s.input}
            accessibilityLabel="The code from your table"
          />

          {error ? <Notice>{error}</Notice> : null}

          <Button
            label="Open the menu"
            busy={busy}
            disabled={!code.trim()}
            onPress={() => void openCode(code)}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

/**
 * The code out of whatever somebody gave us.
 *
 * A full URL (`https://innstant.in/p/the-kesari-table-4`), a path (`/p/x`), or
 * the bare code. All three happen: the first from a deep link or a paste, the
 * second from a half-copied link, the third from reading a card aloud.
 *
 * Returns null for anything that is not a plausible code, so the screen can
 * say so before a round trip. The shape check is the server's own
 * (`resolveVisitLink`) — kept in step deliberately, because a code this
 * rejects would have been rejected there anyway and a round trip to learn
 * that is a second of somebody's evening.
 */
export function extractCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const fromPath = trimmed.match(/\/p\/([A-Za-z0-9_-]+)/);
  const candidate = fromPath ? fromPath[1]! : trimmed;

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(candidate)) return null;
  return candidate;
}

const s = StyleSheet.create({
  body: { paddingHorizontal: space[5], gap: space[4] },

  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space[2],
  },
  markText: { fontSize: type.xl, fontWeight: '700', color: colors.accentInk },

  lede: { fontSize: type.base, lineHeight: 23, color: colors.inkDim, marginBottom: space[2] },

  scan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    padding: space[4],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  scanIcon: { fontSize: 26, color: colors.accent },
  scanTitle: { fontSize: type.base, fontWeight: '600', color: colors.ink },
  scanSub: { fontSize: type.sm, color: colors.inkDim, marginTop: 2 },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rule: { flex: 1, height: 1, backgroundColor: colors.line },
  or: {
    fontSize: type.xs,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.inkFaint,
  },

  input: {
    minHeight: 56,
    paddingHorizontal: space[4],
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    color: colors.ink,
    fontSize: type.base,
  },
});
