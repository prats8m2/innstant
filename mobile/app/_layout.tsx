import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Marcellus_400Regular } from '@expo-google-fonts/marcellus';
import { Mukta_400Regular, Mukta_600SemiBold } from '@expo-google-fonts/mukta';
import { DMMono_400Regular, DMMono_500Medium } from '@expo-google-fonts/dm-mono';
/**
 * `initialWindowMetrics` makes the safe-area insets correct on the FIRST
 * frame. Without it they start at zero and arrive a frame or two later, so the
 * pinned cart pill, the checkout footer and the dish footer each jump by the
 * home-indicator height as a screen appears.
 */
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { SessionProvider } from '@/lib/session';
import { colors } from '@/lib/theme';

/**
 * The app's shell. D-080.
 *
 * One provider, one navigator, one status bar. The guest web app's layout does
 * the same job in the same number of lines, and for the same reason: the theme
 * is dark everywhere, so it is set once at the top rather than per screen —
 * a screen that forgot would flash the system background on every push.
 */
/**
 * Expo Router renders this instead of a blank screen when a route throws.
 *
 * In a RELEASE build there is no redbox: an uncaught render error is a white
 * screen and nothing else. That is exactly how the `crypto.randomUUID` crash
 * presented — the app simply closed, with no way for anybody holding the phone
 * to say what happened. Exporting `ErrorBoundary` from a layout is how
 * expo-router is told to catch it.
 */
export { ErrorBoundary } from 'expo-router';

/**
 * Hold the splash until the faces are in memory.
 *
 * Without this the first frame paints on the system font and then reflows as
 * each family resolves — on this design that is the 34pt arch headline
 * changing shape under the reader, which is worse than a splash screen that
 * lasts a few hundred milliseconds longer.
 *
 * `preventAutoHideAsync` is deliberately NOT awaited and its rejection is
 * swallowed: it throws when the splash has already gone (a fast reload, a
 * remount), and a module-scope throw here is a white screen on launch.
 */
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsReady, fontError] = useFonts({
    Marcellus_400Regular,
    Mukta_400Regular,
    Mukta_600SemiBold,
    DMMono_400Regular,
    DMMono_500Medium,
  });

  /**
   * Render on the system face rather than never rendering.
   *
   * A font that fails to load is a typeface problem; a splash that never
   * lifts is the app being broken. `face()` already falls back to a weight
   * when a family is missing, so the screen that appears is the one this
   * shipped with yesterday — not an error.
   */
  const ready = fontsReady || Boolean(fontError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      {/* Light content, because the ground is indigo. Set here so a screen
          cannot forget it and show black text on a dark bar. */}
      <StatusBar style="light" />
      <SessionProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.paper },
            headerTintColor: colors.ink,
            headerTitleStyle: { color: colors.ink, fontWeight: '600' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.paper },
            // The whole app is one restaurant's menu. A large title would
            // spend a third of a small screen saying so.
            headerLargeTitle: false,
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          {/* The landing. It draws its own 64pt top row — a wordmark and the
              account corner — so there is no header to show, and a native one
              above it would be a second title bar. */}
          <Stack.Screen name="home" options={{ headerShown: false }} />
          <Stack.Screen name="menu" options={{ title: 'Menu' }} />
          <Stack.Screen name="dish/[itemId]" options={{ title: '' }} />
          <Stack.Screen name="cart" options={{ title: 'Your order', presentation: 'modal' }} />
          <Stack.Screen name="order/[orderId]" options={{ title: 'Your order' }} />
          <Stack.Screen name="orders" options={{ title: 'Orders' }} />
          {/* D-081 — the account. None of it gates ordering (#9). */}
          <Stack.Screen name="account/index" options={{ title: 'Account' }} />
          <Stack.Screen name="account/sign-in" options={{ title: 'Sign in' }} />
          <Stack.Screen name="account/addresses" options={{ title: 'Addresses' }} />
          {/* Deep links. The router owns the launch URL and routes to these
              before any screen mounts — see app/p/[code].tsx. */}
          <Stack.Screen name="p/[code]" options={{ headerShown: false }} />
          <Stack.Screen name="r/[code]" options={{ title: 'Room service' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
