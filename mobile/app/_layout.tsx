import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
export default function RootLayout() {
  return (
    <SafeAreaProvider>
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
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
