import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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

export default function RootLayout() {
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
          <Stack.Screen name="menu" options={{ title: 'Menu' }} />
          <Stack.Screen name="dish/[itemId]" options={{ title: '' }} />
          <Stack.Screen name="cart" options={{ title: 'Your order', presentation: 'modal' }} />
          <Stack.Screen name="order/[orderId]" options={{ title: 'Your order' }} />
          <Stack.Screen name="orders" options={{ title: 'Orders' }} />
          {/* Deep links. The router owns the launch URL and routes to these
              before any screen mounts — see app/p/[code].tsx. */}
          <Stack.Screen name="p/[code]" options={{ headerShown: false }} />
          <Stack.Screen name="r/[code]" options={{ title: 'Room service' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
