import { useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as api from '@/lib/api';
import type { ApiOrder } from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { Button, Loading, Notice, Screen } from '@/components/ui';
import { colors, radius, space, text as type, tabular } from '@/lib/theme';

/**
 * Tracking an order. D-080.
 *
 * ─── Why this polls rather than opening an SSE stream ──────────────────────
 *
 * The web tracking screen streams: `LISTEN/NOTIFY` → SSE → a nudge → re-read.
 * It is the right design there and the wrong one here, and the reason is the
 * app lifecycle rather than the protocol.
 *
 * An iOS app that goes to the background has its sockets torn down within
 * seconds and gets no event saying so. A long-lived connection in a mobile app
 * is therefore a connection that silently stops delivering — and the failure
 * looks exactly like a kitchen that has not touched the order, which is the
 * one thing this screen must never fake. Reconnect logic for backgrounding,
 * network switches (wifi to cellular in a doorway) and proxy timeouts is a
 * meaningful amount of code whose bugs are all invisible.
 *
 * A poll has none of those properties. It is stateless, each request either
 * answers or does not, and `AppState` makes "stop while backgrounded" one
 * line rather than a reconnection strategy.
 *
 * ─── And it stops on its own ───────────────────────────────────────────────
 *
 * `isLive` comes from the server's own `trackView()` — the same function the
 * web screen uses to decide whether to stream. Once the tray is handed over,
 * or the kitchen rejects it, polling stops: a finished order costs nothing,
 * and an app that kept asking would drain a battery to learn nothing.
 */
const POLL_MS = 5_000;

export default function Order() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { refreshCart } = useSession();
  const onError = useApiError();

  const [order, setOrder] = useState<ApiOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const read = async () => {
      try {
        const next = await api.getOrder(orderId);
        if (cancelled) return;
        setOrder(next);
        setError(null);
        live.current = next.isLive;
      } catch (failure) {
        if (cancelled) return;
        // A failed poll is not a reason to blank a screen that is already
        // showing a correct order. Only the FIRST read can fail visibly.
        setOrder((current) => {
          if (!current) setError(onError(failure));
          return current;
        });
      } finally {
        if (!cancelled && live.current) timer = setTimeout(read, POLL_MS);
      }
    };

    void read();

    // Backgrounded apps do not poll. Coming back to the foreground reads
    // immediately rather than waiting out the interval — somebody who opens
    // the app to check on their food should not watch a stale screen for five
    // seconds.
    const sub = AppState.addEventListener('change', (state) => {
      if (cancelled) return;
      if (state === 'active' && live.current) {
        if (timer) clearTimeout(timer);
        void read();
      } else if (timer) {
        clearTimeout(timer);
      }
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [orderId, onError]);

  // The cart was emptied server-side at placement. Refreshing it here is what
  // clears the menu's pill when somebody navigates back.
  useEffect(() => { void refreshCart(); }, [refreshCart]);

  if (error && !order) return <Screen style={s.center}><Notice>{error}</Notice></Screen>;
  if (!order) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: order.orderNumber, headerBackVisible: false }} />
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.destination}>{order.destination}</Text>

        {order.etaLabel && order.etaFrom ? (
          <View style={s.hero}>
            <Text style={s.heroLabel}>{order.etaLabel}</Text>
            <Text style={[s.heroTime, tabular]}>
              {clock(order.etaFrom)}{order.etaTo ? ` – ${clock(order.etaTo)}` : ''}
            </Text>
          </View>
        ) : null}

        {order.haltTitle ? (
          <View style={s.halt} accessibilityRole="alert">
            <Text style={s.haltTitle}>{order.haltTitle}</Text>
            {order.haltReason ? <Text style={s.haltReason}>“{order.haltReason}”</Text> : null}
          </View>
        ) : null}

        {order.steps.length ? (
          <View style={s.steps}>
            {/* What a screen reader needs from an animated timeline: the state
                it is in now. The steps themselves are a list. */}
            <Text
              accessibilityLiveRegion="polite"
              style={s.srOnly}
            >
              {order.steps.find((step) => step.state === 'ACTIVE')?.title ?? 'Order sent'}
            </Text>

            {order.steps.map((step, index) => (
              <View key={step.key} style={s.step}>
                <View style={s.rail}>
                  <View style={[
                    s.dot,
                    step.state === 'DONE' && s.dotDone,
                    step.state === 'ACTIVE' && s.dotActive,
                  ]} />
                  {index < order.steps.length - 1 ? (
                    <View style={[s.railLine, step.state === 'DONE' && s.railLineDone]} />
                  ) : null}
                </View>

                <View style={s.stepBody}>
                  <View style={s.stepHead}>
                    <Text style={[
                      s.stepTitle,
                      step.state === 'PENDING' && { color: colors.inkFaint },
                    ]}>
                      {step.title}
                    </Text>
                    {step.at ? <Text style={[s.stepTime, tabular]}>{clock(step.at)}</Text> : null}
                  </View>
                  <Text style={s.stepSub}>{step.sub}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={s.summary}>
          <Text style={s.summaryTitle}>Your order</Text>
          {order.lines.map((line) => (
            <View key={line.id} style={s.summaryLine}>
              <Text style={[s.quantity, tabular]}>{line.quantity}×</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.lineName}>{line.name}</Text>
                {line.modifiers.length ? (
                  <Text style={s.lineMods}>{line.modifiers.map((m) => m.name).join(' · ')}</Text>
                ) : null}
                {line.notes ? <Text style={s.lineMods}>“{line.notes}”</Text> : null}
              </View>
              <Text style={[s.lineTotal, tabular]}>{line.lineTotal.text}</Text>
            </View>
          ))}

          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Total</Text>
            <Text style={[s.totalValue, tabular]}>{order.total.text}</Text>
          </View>
          <Text style={s.payment}>{order.paymentLine}</Text>
        </View>

        <Button label="Order something else" tone="quiet" onPress={() => router.replace('/menu')} />
      </ScrollView>
    </Screen>
  );
}

/**
 * `9:41pm`, not `9:41 PM`.
 *
 * The meridiem is lowercased and its space closed, matching the web screen —
 * which does it because the promise renders large and the gap pushes a range
 * onto a second line on a 390px screen. The same is true here.
 *
 * The device's timezone, not the property's. A customer collecting from a
 * restaurant is in the same city as it; the web renders in the property's
 * timezone because a browser can be anywhere, and that distinction stops
 * mattering the moment somebody has to physically arrive.
 */
function clock(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s?([ap])\.?m\.?/i, (_, meridiem: string) => `${meridiem.toLowerCase()}m`);
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', padding: space[5] },
  body: { paddingHorizontal: space[5], paddingVertical: space[4], gap: space[5] },

  destination: { fontSize: type.sm, color: colors.inkDim },

  hero: { gap: space[1] },
  heroLabel: {
    fontSize: type.xs,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.inkFaint,
  },
  heroTime: { fontSize: type.display, fontWeight: '600', color: colors.ink },

  halt: {
    borderLeftWidth: 2,
    borderLeftColor: colors.critical,
    backgroundColor: colors.criticalTint,
    padding: space[4],
    borderRadius: radius.sm,
    gap: space[2],
  },
  haltTitle: { fontSize: type.lg, fontWeight: '600', color: colors.ink },
  haltReason: { fontSize: type.base, fontStyle: 'italic', color: colors.inkDim },

  steps: { gap: 0 },
  srOnly: { height: 0, opacity: 0 },
  step: { flexDirection: 'row', gap: space[4] },
  rail: { alignItems: 'center', width: 16 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.lineFaint,
    marginTop: 4,
  },
  dotDone: { borderColor: colors.positive, backgroundColor: colors.positive },
  dotActive: { borderColor: colors.accent, backgroundColor: colors.accent, width: 14, height: 14 },
  railLine: { flex: 1, width: 1.5, backgroundColor: colors.line, marginVertical: 2 },
  railLineDone: { backgroundColor: colors.positive },

  stepBody: { flex: 1, paddingBottom: space[5] },
  stepHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  stepTitle: { fontSize: type.base, fontWeight: '600', color: colors.ink },
  stepTime: { fontSize: type.sm, color: colors.inkDim },
  stepSub: { fontSize: type.sm, lineHeight: 20, color: colors.inkDim, marginTop: 2 },

  summary: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: space[4],
    gap: space[3],
  },
  summaryTitle: { fontSize: type.base, fontWeight: '600', color: colors.ink },
  summaryLine: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  quantity: { fontSize: type.sm, color: colors.inkDim, minWidth: 26 },
  lineName: { fontSize: type.sm, color: colors.ink },
  lineMods: { fontSize: type.xs, color: colors.inkDim, marginTop: 2 },
  lineTotal: { fontSize: type.sm, color: colors.ink },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: space[3],
    borderTopWidth: 1,
    borderTopColor: colors.lineSoft,
  },
  totalLabel: { fontSize: type.base, fontWeight: '700', color: colors.ink },
  totalValue: { fontSize: type.base, fontWeight: '700', color: colors.ink },
  payment: { fontSize: type.xs, color: colors.inkFaint },
});
