import { Stack, router } from 'expo-router';
import { Text, StyleSheet } from 'react-native';
import { Button, Screen } from '@/components/ui';
import { colors, space, text as type } from '@/lib/theme';

/**
 * Anything the router cannot match. D-081.
 *
 * Expo Router ships its own unmatched page — a white screen with a developer
 * message on it, which on a dark app, in a release build, in somebody's hand,
 * is indistinguishable from a crash. This is the same dead end the web's
 * `/p/{code}` route handler renders, in the app's own clothes: it says what
 * happened, and it offers the one thing that always works.
 */
export default function NotFound() {
  return (
    <Screen style={s.center}>
      <Stack.Screen options={{ title: '' }} />
      <Text style={s.title}>That link did not open</Text>
      <Text style={s.body}>
        It may be an old code, or one this app does not handle yet. The menu is
        always one tap away.
      </Text>
      <Button label="Go to the menu" onPress={() => router.replace('/')} />
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', paddingHorizontal: space[5], gap: space[4] },
  title: { fontSize: type.xl, fontWeight: '600', color: colors.ink },
  body: { fontSize: type.base, lineHeight: 22, color: colors.inkDim },
});
