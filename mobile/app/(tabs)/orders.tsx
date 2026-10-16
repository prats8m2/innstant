import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as api from '@/lib/api';
import type { ApiOrderSummary } from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { Button, Notice, Screen } from '@/components/ui';
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
  const onError = useApiError();
  const { customer } = useSession();
  const [orders, setOrders] = useState<ApiOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
        if (!cancelled) { setOrders(loaded); setError(null); }
      } catch (failure) {
        if (!cancelled) setError(onError(failure));
      }
    })();
    return () => { cancelled = true; };
  }, [onError, read]));

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
      setError(null);
    } catch (failure) {
      setError(onError(failure));
    } finally {
      setRefreshing(false);
    }
  }, [onError, read]);

  if (error && !orders) return <Screen style={s.center}><Notice>{error}</Notice></Screen>;
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
      <Screen style={s.center}>
        <Stack.Screen options={{ title: 'Orders' }} />
        <Text style={s.emptyTitle}>Nothing ordered yet</Text>
        <Text style={s.emptyBody}>
          {customer
            ? 'Orders you place from here are kept on your account. Table and room-service orders stay with the table and the room.'
            : 'Orders show up here while you are ordering. Sign in and they are kept after that.'}
        </Text>
        {customer
          ? <Button label="Back to the menu" tone="quiet" onPress={() => router.replace('/menu')} />
          : <Button label="Sign in" onPress={() => router.push('/account/sign-in')} />}
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
  center: { justifyContent: 'center', alignItems: 'center', padding: space[5], gap: space[3] },
  emptyTitle: { fontSize: type.lg, fontWeight: '600', color: colors.ink },
  emptyBody: { fontSize: type.base, lineHeight: 22, color: colors.inkDim, textAlign: 'center' },

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
