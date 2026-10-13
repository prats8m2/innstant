import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as api from '@/lib/api';
import type { ApiCartLine, ApiFulfilment } from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { Button, Loading, Notice, Screen } from '@/components/ui';
import { colors, radius, space, text as type, tabular, TOUCH_MIN } from '@/lib/theme';

/**
 * The order, and the one question this flow asks. D-080.
 *
 * ─── Why the fields are here rather than behind a step ─────────────────────
 *
 * The same shape as the web cart, for the same reason: the fields are on the
 * screen they are needed on, under the order they belong to, and sending
 * answers them and places the order in ONE call — so either the kitchen has
 * the order and the number, or neither happened and this screen still holds
 * what was typed.
 *
 * A separate "your details" step would be a second screen between somebody and
 * their dinner, and the thing it would protect — a room charge — does not
 * exist on this path (D-079).
 */
export default function Cart() {
  const { session, cart, setCart, refreshCart } = useSession();
  const onError = useApiError();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [addressNotes, setAddressNotes] = useState('');
  const [mode, setMode] = useState<ApiFulfilment>('TAKEAWAY');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * One key per visit to this screen (#8).
   *
   * Minted once and kept for as long as the screen is mounted, so every tap of
   * the button that is on the page right now carries the SAME value and places
   * one order. A key minted per tap would make a double-tap two dinners, which
   * is the most common duplicate in this product.
   *
   * A successful send navigates away and unmounts this, so the next order gets
   * a new one — which is correct: it is a different order.
   */
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => { void refreshCart(); }, [refreshCart]);

  // A table tent fixes the answer. Offering "delivery" to somebody sitting in
  // the dining room is an invitation to a mistake, and `setVisitDetails()`
  // overrules a posted fulfilment for a dine-in visit regardless.
  const fixed = Boolean(session?.visit.tableLabel);
  useEffect(() => {
    if (session?.visit.tableLabel) setMode('DINE_IN');
  }, [session?.visit.tableLabel]);

  const where = useMemo(() => {
    if (session?.visit.tableLabel) return `To ${session.visit.tableLabel}`;
    return mode === 'DELIVERY' ? 'For delivery' : 'For collection';
  }, [session, mode]);

  const changeLine = useCallback(async (line: ApiCartLine, quantity: number) => {
    try {
      setCart(quantity === 0
        ? await api.removeLine(line.id)
        : await api.setLineQuantity(line.id, quantity));
      setError(null);
    } catch (failure) {
      setError(onError(failure));
    }
  }, [setCart, onError]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const placed = await api.placeOrder({
        idempotencyKey,
        name: name.trim(),
        phone: phone.trim(),
        fulfilment: mode,
        deliveryAddress: mode === 'DELIVERY' ? address.trim() : undefined,
        deliveryNotes: mode === 'DELIVERY' ? addressNotes.trim() || undefined : undefined,
      });
      // `replace`, not `push`: the cart is emptied server-side at placement,
      // and a back gesture onto an empty cart is a dead end.
      router.replace(`/order/${placed.orderId}`);
    } catch (failure) {
      setError(onError(failure));
    } finally {
      setBusy(false);
    }
  };

  if (!cart || !session) return <Loading />;

  if (cart.lines.length === 0) {
    return (
      <Screen style={s.center}>
        <Stack.Screen options={{ title: 'Your order' }} />
        <Text style={s.emptyLine}>Nothing in the order yet.</Text>
        <Button label="Back to the menu" tone="quiet" onPress={() => router.back()} />
      </Screen>
    );
  }

  const unavailable = cart.lines.filter((line) => !line.isAvailable);
  const canSend = name.trim().length >= 2
    && phone.trim().length >= 7
    && (mode !== 'DELIVERY' || address.trim().length > 0)
    && !cart.shortfall;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Your order' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={90}
      >
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={s.where}>{where}</Text>

          {cart.lines.map((line) => (
            <View key={line.id} style={[s.line, !line.isAvailable && { opacity: 0.55 }]}>
              <View style={{ flex: 1 }}>
                <Text style={s.lineName}>{line.name}</Text>
                {line.modifiers.length ? (
                  <Text style={s.lineMods}>
                    {line.modifiers.map((m) => m.name).join(' · ')}
                  </Text>
                ) : null}
                {line.notes ? <Text style={s.lineNote}>“{line.notes}”</Text> : null}
                {!line.isAvailable ? (
                  <Text style={s.lineGone}>
                    The kitchen has taken this off tonight. It is not charged.
                  </Text>
                ) : null}
              </View>

              <View style={s.lineRight}>
                <View style={s.stepper}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`One fewer ${line.name}`}
                    onPress={() => void changeLine(line, line.quantity - 1)}
                    style={s.step}
                  >
                    <Text style={s.stepText}>−</Text>
                  </Pressable>
                  <Text style={[s.stepCount, tabular]}>{line.quantity}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`One more ${line.name}`}
                    onPress={() => void changeLine(line, line.quantity + 1)}
                    style={s.step}
                  >
                    <Text style={s.stepText}>+</Text>
                  </Pressable>
                </View>
                {line.isAvailable ? (
                  <Text style={[s.lineTotal, tabular]}>{line.lineTotal.text}</Text>
                ) : null}
              </View>
            </View>
          ))}

          <View style={s.totals}>
            <Row label="Subtotal" value={cart.totals.subtotal.text} />
            {cart.totals.serviceCharge.minor > 0
              ? <Row label="Service" value={cart.totals.serviceCharge.text} /> : null}
            {cart.totals.tax.minor > 0
              ? <Row label="Tax" value={cart.totals.tax.text} /> : null}
            {cart.totals.deliveryFee.minor > 0
              ? <Row label="Delivery" value={cart.totals.deliveryFee.text} /> : null}
            <Row label="Total" value={cart.totals.total.text} strong />
          </View>

          {unavailable.length ? (
            <Notice>
              {unavailable.length === 1
                ? 'One dish came off the menu while you were choosing. It is not in the total.'
                : `${unavailable.length} dishes came off the menu while you were choosing. They are not in the total.`}
            </Notice>
          ) : null}

          {cart.shortfall ? (
            <Notice>Orders start higher than this — {cart.shortfall.text} to go.</Notice>
          ) : null}

          {/* Only an ONLINE link has a question here; a tent and a till both
              already know. */}
          {!fixed ? (
            <View style={s.field}>
              <Text style={s.label}>How are you getting it?</Text>
              <View style={s.modes}>
                {([
                  ['TAKEAWAY', 'Collecting', 'You come to the counter'],
                  ['DELIVERY', 'Delivery', 'We bring it to you'],
                ] as const).map(([value, title, sub]) => (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: mode === value }}
                    onPress={() => setMode(value)}
                    style={[s.mode, mode === value && s.modeOn]}
                  >
                    <Text style={s.modeTitle}>{title}</Text>
                    <Text style={s.modeSub}>{sub}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View style={s.field}>
            <Text style={s.label}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="What shall we call out?"
              placeholderTextColor={colors.inkFaint}
              autoComplete="name"
              textContentType="name"
              maxLength={80}
              style={s.input}
            />
          </View>

          <View style={s.field}>
            <Text style={s.label}>Phone</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              placeholder="So the kitchen can call"
              placeholderTextColor={colors.inkFaint}
              // `phone-pad`, not `numeric`: it brings up the keypad, keeps a
              // leading zero, and survives a +91.
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={32}
              style={s.input}
            />
          </View>

          {mode === 'DELIVERY' ? (
            <>
              <View style={s.field}>
                <Text style={s.label}>Where to</Text>
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Flat, building, street, landmark"
                  placeholderTextColor={colors.inkFaint}
                  multiline
                  maxLength={400}
                  style={[s.input, s.multiline]}
                />
              </View>
              <View style={s.field}>
                <Text style={s.label}>Anything the rider should know</Text>
                <TextInput
                  value={addressNotes}
                  onChangeText={setAddressNotes}
                  placeholder="Gate code, which floor, ring twice"
                  placeholderTextColor={colors.inkFaint}
                  maxLength={280}
                  style={s.input}
                />
              </View>
            </>
          ) : null}

          {error ? <Notice>{error}</Notice> : null}
        </ScrollView>

        <View style={[s.foot, { paddingBottom: insets.bottom + space[4] }]}>
          <Button
            label="Send to the kitchen"
            trailing={cart.totals.total.text}
            busy={busy}
            disabled={!canSend}
            onPress={() => void send()}
          />
          <Text style={s.payment}>
            {mode === 'DELIVERY' ? 'You pay the rider.' : 'You pay at the counter.'}
            {' '}Nothing is charged now.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.totalRow}>
      <Text style={[s.totalLabel, strong && s.totalStrong]}>{label}</Text>
      <Text style={[s.totalValue, tabular, strong && s.totalStrong]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center', padding: space[5], gap: space[4] },
  emptyLine: { fontSize: type.base, color: colors.inkDim },

  body: { paddingHorizontal: space[5], paddingVertical: space[4], gap: space[3] },
  where: { fontSize: type.sm, color: colors.inkDim, marginBottom: space[1] },

  line: {
    flexDirection: 'row',
    gap: space[3],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  lineName: { fontSize: type.base, fontWeight: '600', color: colors.ink },
  lineMods: { fontSize: type.sm, color: colors.inkDim, marginTop: 2 },
  lineNote: { fontSize: type.sm, fontStyle: 'italic', color: colors.inkDim, marginTop: 2 },
  lineGone: { fontSize: type.sm, color: colors.critical, marginTop: space[1] },
  lineRight: { alignItems: 'flex-end', gap: space[2] },
  lineTotal: { fontSize: type.sm, color: colors.ink },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  step: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: type.lg, color: colors.ink },
  stepCount: { minWidth: 20, textAlign: 'center', fontSize: type.sm, fontWeight: '700', color: colors.ink },

  totals: { gap: space[2], paddingTop: space[3] },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: type.sm, color: colors.inkDim },
  totalValue: { fontSize: type.sm, color: colors.ink },
  totalStrong: { fontSize: type.base, fontWeight: '700', color: colors.ink },

  field: { gap: space[2], marginTop: space[2] },
  label: {
    fontSize: type.xs,
    letterSpacing: 1.3,
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
  multiline: { minHeight: 84, paddingTop: space[3], textAlignVertical: 'top' },

  modes: { flexDirection: 'row', gap: space[2] },
  mode: {
    flex: 1,
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  modeOn: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  modeTitle: { fontSize: type.sm, fontWeight: '600', color: colors.ink },
  modeSub: { fontSize: type.xs, color: colors.inkDim, marginTop: 2 },

  foot: {
    paddingHorizontal: space[5],
    paddingTop: space[3],
    gap: space[2],
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
  payment: { fontSize: type.xs, color: colors.inkFaint, textAlign: 'center' },
});
