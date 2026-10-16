import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as api from '@/lib/api';
import type { ApiCartLine, ApiFulfilment } from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { newIdempotencyKey } from '@/lib/ids';
import { orderPlaced, tapAdd, tapRemove } from '@/lib/haptics';
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
  const { session, customer, addresses, cart, setCart, refreshCart } = useSession();
  const onError = useApiError();
  const insets = useSafeAreaInsets();

  /**
   * Prefilled from the account when there is one. D-081.
   *
   * `useState`'s initialiser so the fields are right on the FIRST render when
   * the account is already in hand — an effect alone would paint empty boxes
   * and then fill them, which reads as the app losing what it knew about you.
   *
   * The initialiser is not SUFFICIENT, though, and assuming it was is what
   * shipped this screen saying "Sign in to keep your orders" to somebody who
   * was signed in. On a cold start the identity restore is a round trip that
   * deliberately does not gate the first paint (#9 — browsing never waits on
   * an account), so this screen can mount before `customer` arrives. The
   * initialiser runs once, reads null, and the fields stay empty forever.
   *
   * So: initialiser for the warm path, effect below for the cold one.
   *
   * They stay editable. Somebody ordering for a colleague puts the colleague's
   * name on it, and that does not change their account.
   */
  const [name, setName] = useState(() => customer?.name ?? '');
  const [phone, setPhone] = useState(() => customer?.phone ?? '');
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const [pickedAddressId, setPickedAddressId] = useState<string | null>(
    () => defaultAddress?.id ?? null,
  );
  const [address, setAddress] = useState(() => defaultAddress?.line ?? '');
  const [addressNotes, setAddressNotes] = useState(() => defaultAddress?.notes ?? '');

  /**
   * Set the moment a human types in one of these, and never cleared.
   *
   * A late prefill must not overwrite what somebody has already put in the
   * box. Checking "is the field still empty?" is not the same test: clearing
   * a prefilled name to type a colleague's is a field that is briefly empty
   * and emphatically touched, and refilling it under their cursor is worse
   * than never filling it at all.
   */
  const touched = useRef({ name: false, phone: false, address: false });
  // Named `onType`, not `type` — `type` is the typography token in this file.
  const onType = <T,>(field: keyof typeof touched.current, set: (v: T) => void) => (v: T) => {
    touched.current[field] = true;
    set(v);
  };

  // The cold path. Fires when the restored account lands after this mounted.
  useEffect(() => {
    if (!customer) return;
    if (!touched.current.name && customer.name) setName(customer.name);
    if (!touched.current.phone && customer.phone) setPhone(customer.phone);
  }, [customer]);

  useEffect(() => {
    if (touched.current.address || !defaultAddress) return;
    setPickedAddressId(defaultAddress.id);
    setAddress(defaultAddress.line);
    setAddressNotes(defaultAddress.notes ?? '');
    // The address itself, not the object — `defaultAddress` is rebuilt every
    // render and depending on it would re-run this on every keystroke.
  }, [defaultAddress?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
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
  const [idempotencyKey] = useState(newIdempotencyKey);

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
      // Same weight either way. Going down is not a mistake being corrected,
      // and a heavier tap on remove would say it was.
      if (quantity > line.quantity) tapAdd(); else tapRemove();
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
      // The one irreversible thing in the app, and the only notification
      // pattern in it. The kitchen has the order.
      orderPlaced();
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
      {/*
        `behavior` must be set on BOTH platforms. It was
        `Platform.OS === 'ios' ? 'padding' : undefined`, and a
        KeyboardAvoidingView with `behavior={undefined}` does nothing at all —
        Android's correctness then rested on window resizing, which edge-to-edge
        (default since SDK 54) no longer provides. The "Send to the kitchen"
        footer is a sibling OUTSIDE the ScrollView, so the primary action of
        the whole app sat under the keyboard.

        The offset was a hardcoded 90, which was a guess and wrong twice over:
        this screen is `presentation: 'modal'`, whose header height differs
        from a card route's, and it differs again by device. It is 0 now
        because the view is already mounted BELOW the header — the number it
        was compensating for was never in this view's coordinate space.

        `useHeaderHeight()` would be the principled source, but SDK 57 moved
        off `@react-navigation` and does not re-export it. Not worth a
        dependency for a number that should be zero.

        NOT VERIFIED ON A DEVICE — see docs/STATUS.md. This is the fix the
        code says is right; the keyboard is one of the things only a phone can
        actually settle.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
          // Lets iOS inset the scroll content for the keyboard on its own,
          // which is what makes a field near the bottom of a long form
          // reachable rather than merely not-covered.
          automaticallyAdjustKeyboardInsets
        >
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
              onChangeText={onType('name', setName)}
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
              onChangeText={onType('phone', setPhone)}
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
              {/*
                Saved addresses, when there are any. A picker beats a text box
                every time here: the address is the thing most likely to be
                mistyped and the most expensive to get wrong, and somebody who
                has ordered before has already typed it correctly once.
              */}
              {addresses.length > 0 ? (
                <View style={s.field}>
                  <Text style={s.label}>Deliver to</Text>
                  {addresses.map((saved) => (
                    <Pressable
                      key={saved.id}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: pickedAddressId === saved.id }}
                      onPress={() => {
                        touched.current.address = true;
                        setPickedAddressId(saved.id);
                        setAddress(saved.line);
                        setAddressNotes(saved.notes ?? '');
                      }}
                      style={[s.saved, pickedAddressId === saved.id && s.savedOn]}
                    >
                      <Text style={s.savedLabel}>{saved.label}</Text>
                      <Text style={s.savedLine} numberOfLines={2}>{saved.line}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: pickedAddressId === null }}
                    onPress={() => {
                      touched.current.address = true;
                      setPickedAddressId(null);
                      setAddress('');
                      setAddressNotes('');
                    }}
                    style={[s.saved, pickedAddressId === null && s.savedOn]}
                  >
                    <Text style={s.savedLabel}>Somewhere else</Text>
                  </Pressable>
                </View>
              ) : null}

              {/* The free-text box, for a new address or for somebody with no
                  account at all — which must keep working (#9). */}
              {pickedAddressId === null ? (
                <>
                  <View style={s.field}>
                    <Text style={s.label}>Where to</Text>
                    <TextInput
                      value={address}
                      onChangeText={onType('address', setAddress)}
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
                      onChangeText={onType('address', setAddressNotes)}
                      placeholder="Gate code, which floor, ring twice"
                      placeholderTextColor={colors.inkFaint}
                      maxLength={280}
                      style={s.input}
                    />
                  </View>
                </>
              ) : null}
            </>
          ) : null}

          {error ? <Notice>{error}</Notice> : null}

          {/* Offered, never required. Somebody who ignores this orders exactly
              as they did before (#9). */}
          {!customer ? (
            <Pressable onPress={() => router.push('/account/sign-in')} style={s.signInRow}>
              <Text style={s.signInText}>
                Sign in to save this address and keep your orders
              </Text>
            </Pressable>
          ) : null}
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

  saved: {
    minHeight: 56,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  savedOn: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  savedLabel: { fontSize: type.sm, fontWeight: '600', color: colors.ink },
  savedLine: { fontSize: type.xs, color: colors.inkDim, marginTop: 2 },

  signInRow: { paddingVertical: space[3] },
  signInText: { fontSize: type.sm, color: colors.accent, textAlign: 'center' },

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
