import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as api from '@/lib/api';
import type { ApiOrderSummary } from '@/lib/api';
import { useApiError } from '@/lib/session';
import { Button, Loading, Notice, Screen } from '@/components/ui';
import { colors, radius, space, text as type, tabular, TOUCH_MIN } from '@/lib/theme';

/**
 * What this visit has ordered. D-080.
 *
 * ─── The honest limit of this screen ───────────────────────────────────────
 *
 * It is scoped to the VISIT, so it empties when the visit does — six hours,
 * or sooner if it is closed. There is no account behind this app (that was the
 * sign-in decision in D-080), so "your orders from last Tuesday" has nowhere
 * to come from: the server has them, and nothing ties them to this phone.
 *
 * That is a real cost of the no-signup design and it is the thing phone-and-
 * OTP accounts would buy. The empty state says so plainly rather than
 * implying the orders were lost.
 */
export default function Orders() {
  const onError = useApiError();
  const [orders, setOrders] = useState<ApiOrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On focus rather than on mount: somebody lands here, opens an order,
  // watches it reach the kitchen, and comes back. A list that only loaded once
  // would still say PLACED.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await api.listOrders();
        if (!cancelled) { setOrders(loaded); setError(null); }
      } catch (failure) {
        if (!cancelled) setError(onError(failure));
      }
    })();
    return () => { cancelled = true; };
  }, [onError]));

  if (error && !orders) return <Screen style={s.center}><Notice>{error}</Notice></Screen>;
  if (!orders) return <Loading />;

  if (orders.length === 0) {
    return (
      <Screen style={s.center}>
        <Stack.Screen options={{ title: 'Orders' }} />
        <Text style={s.emptyTitle}>Nothing ordered yet</Text>
        <Text style={s.emptyBody}>
          Orders you place show up here while you are at the restaurant. They are
          not kept after that — there is no account to keep them on.
        </Text>
        <Button label="Back to the menu" tone="quiet" onPress={() => router.replace('/menu')} />
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
