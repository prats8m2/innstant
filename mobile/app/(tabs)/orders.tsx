import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { ReceiptText } from 'lucide-react-native';
import * as api from '@/lib/api';
import type { ApiOrderSummary } from '@/lib/api';
import { useApiFailure, useSession, type Failure } from '@/lib/session';
import { Screen } from '@/components/ui';
import { ListState } from '@/components/state';
import { OrdersSkeleton } from '@/components/skeleton';
import { colors, radius, space, text as type, tabular, TOUCH_MIN } from '@/lib/theme';

/**
 * What this visit has ordered. D-080.
 *
 * ─── Two scopes, chosen by whether somebody is signed in ───────────────────
 *
 * Signed OUT it is scoped to the VISIT and empties when the visit does — six
 * hours. Signed IN it is the account's own history, which spans every visit
 * and needs no context at all (D-081).
 *
 * What the account's history deliberately excludes: table orders and room
 * service. A table order belongs to the table and the moment — who ordered
 * and who pays are routinely different people — and room service belongs to
 * the hotel relationship that the room sticker governs. The empty state says
 * which list is being shown rather than letting somebody wonder where an
 * order went.
 */
export default function Orders() {
  const failureOf = useApiFailure();
  const { customer } = useSession();
  const [orders, setOrders] = useState<ApiOrderSummary[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  /** Bumped by the failed state's button; the focus effect is keyed on it, so
   *  "Try again" is the same read rather than a second one. */
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  /** Account history when there is an account; this visit's otherwise. */
  const read = useCallback(() => (
    customer ? api.listAccountOrders() : api.listOrders()
  ), [customer]);

  // On focus rather than on mount: somebody lands here, opens an order,
  // watches it reach the kitchen, and comes back. A list that only loaded once
  // would still say PLACED.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await read();
        if (!cancelled) { setOrders(loaded); setFailure(null); }
      } catch (thrown) {
        if (!cancelled) setFailure(failureOf(thrown));
      }
    })();
    return () => { cancelled = true; };
  }, [failureOf, read, attempt]));

  /**
   * Pull to refresh.
   *
   * This screen is where somebody checks whether the kitchen has started
   * their food, and it does not poll — the tracking screen behind a row does
   * that, at five seconds. Pulling is the gesture people already use to ask
   * "and now?", and it saves the alternative they currently use, which is
   * leaving the tab and coming back.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setOrders(await read());
      setFailure(null);
    } catch (thrown) {
      setFailure(failureOf(thrown));
    } finally {
      setRefreshing(false);
    }
  }, [failureOf, read]);

  /*
    `!orders?.length` and not `!orders`: an empty array is data, and after a
    failed re-read it is data that may no longer be true. There is nothing to
    look at either way, so the failure is the more useful of the two screens —
    "Nothing ordered yet" over a read that never landed is the app stating a
    fact it does not have. A read that fails over a list that DID load keeps
    the list, because stale orders are still the last thing we actually know.
  */
  if (failure && !orders?.length) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Orders' }} />
        <ListState
          tone={failure.kind}
          title={failure.kind === 'offline' ? 'Your orders did not load' : 'Your orders are not available'}
          body={failure.kind === 'offline'
            ? 'You are not reaching us. Check your signal, then try again. Anything already sent to the kitchen is still being cooked.'
            : undefined}
          message={failure.kind === 'refused' ? failure.message : undefined}
          actionLabel="Try again"
          onAction={() => setAttempt((n) => n + 1)}
        />
      </Screen>
    );
  }
  if (!orders) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Orders' }} />
        <OrdersSkeleton />
      </Screen>
    );
  }

  if (orders.length === 0) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Orders' }} />
        {/* The words are the ones this screen shipped with: which list is
            being shown, so nobody wonders where an order went. What changed
            is that it is now drawn the same way every other empty list in
            the app is, and can no longer be mistaken for a failed read. */}
        <ListState
          tone="empty"
          icon={ReceiptText}
          title="Nothing ordered yet"
          body={customer
            ? 'Orders you place from here are kept on your account. Table and room-service orders stay with the table and the room.'
            : 'Orders show up here while you are ordering. Sign in and they are kept after that.'}
          actionLabel={customer ? 'Back to the menu' : 'Sign in'}
          onAction={() => (customer
            ? router.replace('/menu')
            : router.push('/account/sign-in'))}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Orders' }} />
      <FlatList
        data={orders}
        keyExtractor={(order) => order.id}
        contentContainerStyle={s.list}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.card}
          />
        )}
        renderItem={({ item: order }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/order/${order.id}`)}
            style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.raised }]}
          >
            <View style={{ flex: 1 }}>
              <View style={s.rowHead}>
                <Text style={[s.number, tabular]}>{order.orderNumber}</Text>
                <View style={[s.badge, order.isLive && s.badgeLive]}>
                  <Text style={[s.badgeText, order.isLive && s.badgeTextLive]}>
                    {title(order.status)}
                  </Text>
                </View>
              </View>
              <Text style={s.summary} numberOfLines={2}>{order.summary}</Text>
            </View>
            <Text style={[s.total, tabular]}>{order.total.text}</Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

/** `OUT_FOR_DELIVERY` → `Out for delivery`. */
function title(status: string): string {
  const words = status.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const s = StyleSheet.create({
  list: { padding: space[4], gap: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: TOUCH_MIN + space[3],
    padding: space[4],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  number: { fontSize: type.base, fontWeight: '600', color: colors.ink },
  summary: { fontSize: type.sm, color: colors.inkDim, marginTop: space[1] },
  total: { fontSize: type.base, fontWeight: '600', color: colors.ink },

  badge: {
    paddingVertical: 2,
    paddingHorizontal: space[2],
    borderRadius: radius.xs,
    backgroundColor: colors.raised,
  },
  badgeLive: { backgroundColor: colors.attentionTint },
  badgeText: { fontSize: type.xs, color: colors.inkDim },
  badgeTextLive: { color: colors.attention, fontWeight: '600' },
});
