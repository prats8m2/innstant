import { Stack, router } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { Button, Screen } from '@/components/ui';
import { colors, space, text as type } from '@/lib/theme';

/**
 * `/r/{code}` — a ROOM sticker, arriving as a deep link. D-081.
 *
 * ─── Why the file exists when the feature does not ─────────────────────────
 *
 * The room surface is explicitly out of scope for this app
 * (docs/CUSTOMER-ACCOUNTS-PROPOSAL.md). But a guest who has this app installed
 * and scans a nightstand sticker is routed HERE by the OS regardless — and
 * without a route file they would get expo-router's white "Unmatched Route"
 * page, which on a dark app in a release build is indistinguishable from a
 * crash. Having the app installed would be worse than not having it.
 *
 * ─── Why it explains rather than redirects ─────────────────────────────────
 *
 * The code is real and it works — on the web, which is what the room flow was
 * built for (D-080). Sending it to `POST /visits` would get a truthful 404
 * (it is a `room_qr_codes` row, not a `visit_links` one) and the customer
 * would read "this link is not active", which is a lie about a perfectly good
 * sticker.
 */
export default function RoomLink() {
  return (
    <Screen style={s.center}>
      <Stack.Screen options={{ title: 'Room service' }} />
      <Text style={s.title}>Room service is on the web</Text>
      <Text style={s.body}>
        Scanning the code in your room opens everything for your stay — food,
        amenities, your bill, checkout — in the browser. Nothing to install and
        nothing to sign in to.
      </Text>
      <Text style={s.body}>
        This app is for ordering from the restaurant directly.
      </Text>
      <Button label="Back to the menu" onPress={() => router.replace('/')} />
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', paddingHorizontal: space[5], gap: space[4] },
  title: { fontSize: type.xl, fontWeight: '600', color: colors.ink },
  body: { fontSize: type.base, lineHeight: 23, color: colors.inkDim },
});
