import { useCallback, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { MapPin, UserRound } from 'lucide-react-native';
import * as api from '@/lib/api';
import type { ApiAddress } from '@/lib/api';
import { useApiFailure, useSession, type Failure } from '@/lib/session';
import { Button, Notice, Screen } from '@/components/ui';
import { ListState } from '@/components/state';
import { colors, radius, space, text as type, TOUCH_MIN } from '@/lib/theme';

/**
 * Saved addresses. D-081.
 *
 * ─── One free-text line, not a structured form ─────────────────────────────
 *
 * The same decision the visit's delivery address made, and for the same
 * reason: an Indian address is a landmark and a floor as often as it is a
 * street and a postcode, and a form that insists on structure gets "near the
 * temple" typed into the first line anyway. A rider reads it; nothing parses
 * it.
 */
export default function Addresses() {
  const { customer, addresses, setCustomer, refreshAccount } = useSession();
  const failureOf = useApiFailure();

  const [editing, setEditing] = useState<ApiAddress | 'NEW' | null>(null);
  const [label, setLabel] = useState('');
  const [line, setLine] = useState('');
  const [notes, setNotes] = useState('');
  /** A refusal from a save, a delete or a default change. It is shown in the
   *  flow rather than as a whole-screen state: the list is still correct, and
   *  the thing that failed is one row's worth of work. */
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  // The one caller that reads the answer: with no addresses in hand, "No
  // addresses saved" over a read that never landed is a claim this screen
  // cannot make, so the failure is drawn instead.
  useFocusEffect(useCallback(() => { void refreshAccount().then(setFailure); }, [refreshAccount]));

  if (!customer) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Addresses' }} />
        <ListState
          tone="empty"
          icon={UserRound}
          title="Sign in to save an address"
          body="A saved address fills itself in at checkout. Ordering works without one."
          actionLabel="Sign in"
          onAction={() => router.push('/account/sign-in')}
        />
      </Screen>
    );
  }

  const begin = (address: ApiAddress | 'NEW') => {
    setEditing(address);
    setLabel(address === 'NEW' ? '' : address.label);
    setLine(address === 'NEW' ? '' : address.line);
    setNotes(address === 'NEW' ? '' : address.notes ?? '');
    setFailure(null);
  };

  const save = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const body = {
        label: label.trim(),
        line: line.trim(),
        notes: notes.trim() || null,
      };
      if (editing === 'NEW') await api.createAddress(body);
      else if (editing) await api.updateAddress(editing.id, body);

      // The server owns which one is default and re-sorts the list; re-reading
      // is cheaper than reproducing that rule here and getting it wrong.
      setCustomer(customer, await api.listAddresses());
      setEditing(null);
    } catch (thrown) {
      setFailure(failureOf(thrown));
    } finally {
      setBusy(false);
    }
  };

  const remove = (address: ApiAddress) => {
    // A saved address is not precious, but deleting one somebody is about to
    // order to is annoying enough to be worth one tap.
    Alert.alert('Remove this address?', address.line, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await api.removeAddress(address.id);
              setCustomer(customer, await api.listAddresses());
            } catch (thrown) {
              setFailure(failureOf(thrown));
            }
          })();
        },
      },
    ]);
  };

  const makeDefault = async (address: ApiAddress) => {
    try {
      await api.updateAddress(address.id, {
        label: address.label,
        line: address.line,
        notes: address.notes,
        isDefault: true,
      });
      setCustomer(customer, await api.listAddresses());
    } catch (thrown) {
      setFailure(failureOf(thrown));
    }
  };

  if (editing) {
    return (
      <Screen>
        <Stack.Screen options={{ title: editing === 'NEW' ? 'New address' : 'Edit address' }} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <View style={s.field}>
              <Text style={s.label}>Name it</Text>
              <TextInput
                value={label}
                onChangeText={setLabel}
                placeholder="Home"
                placeholderTextColor={colors.inkFaint}
                maxLength={40}
                style={s.input}
                autoFocus
              />
            </View>
            <View style={s.field}>
              <Text style={s.label}>Where to</Text>
              <TextInput
                value={line}
                onChangeText={setLine}
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
                value={notes}
                onChangeText={setNotes}
                placeholder="Gate code, which floor, ring twice"
                placeholderTextColor={colors.inkFaint}
                maxLength={280}
                style={s.input}
              />
            </View>
            {failure ? <Notice>{failure.message}</Notice> : null}
          </ScrollView>
          <View style={s.foot}>
            <Button
              label="Save"
              busy={busy}
              disabled={!label.trim() || !line.trim()}
              onPress={() => void save()}
            />
            <Button label="Cancel" tone="quiet" onPress={() => setEditing(null)} />
          </View>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Addresses' }} />
      <ScrollView contentContainerStyle={s.body}>
        {/* Only when there IS a list behind it — with none, the state below
            is already saying the same thing in a larger voice. */}
        {failure && addresses.length > 0 ? <Notice>{failure.message}</Notice> : null}

        {addresses.length === 0 && failure ? (
          /* Nothing in hand AND a read that failed. Saying "none saved" here
             would be the app stating a fact it does not have. */
          <ListState
            tone={failure.kind}
            fill={false}
            title={failure.kind === 'offline' ? 'Your addresses did not load' : 'Your addresses are not available'}
            body={failure.kind === 'offline'
              ? 'You are not reaching us. Check your signal and come back.'
              : undefined}
            message={failure.kind === 'refused' ? failure.message : undefined}
          />
        ) : addresses.length === 0 ? (
          <ListState
            tone="empty"
            icon={MapPin}
            /* Not `fill` — a flex child of a scroll container collapses to
               nothing and the whole state disappears. */
            fill={false}
            title="No addresses saved"
            body="Add one and it fills itself in at checkout."
          />
        ) : (
          addresses.map((address) => (
            <View key={address.id} style={s.card}>
              <View style={s.cardHead}>
                <Text style={s.cardLabel}>{address.label}</Text>
                {address.isDefault ? <Text style={s.badge}>Default</Text> : null}
              </View>
              <Text style={s.cardLine}>{address.line}</Text>
              {address.notes ? <Text style={s.cardNotes}>{address.notes}</Text> : null}

              <View style={s.actions}>
                <Pressable onPress={() => begin(address)} hitSlop={8}>
                  <Text style={s.link}>Edit</Text>
                </Pressable>
                {!address.isDefault ? (
                  <Pressable onPress={() => void makeDefault(address)} hitSlop={8}>
                    <Text style={s.link}>Make default</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => remove(address)} hitSlop={8}>
                  <Text style={[s.link, { color: colors.critical }]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}

        <Button label="Add an address" tone="quiet" onPress={() => begin('NEW')} />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { padding: space[4], gap: space[3] },

  card: {
    padding: space[4],
    gap: space[1],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  cardLabel: { fontSize: type.base, fontWeight: '600', color: colors.ink },
  badge: {
    fontSize: type.xs,
    color: colors.accent,
    backgroundColor: colors.accentTint,
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
  cardLine: { fontSize: type.sm, lineHeight: 20, color: colors.inkDim },
  cardNotes: { fontSize: type.xs, color: colors.inkFaint },
  actions: { flexDirection: 'row', gap: space[5], marginTop: space[3] },
  link: { fontSize: type.sm, color: colors.accent, fontWeight: '600' },

  field: { gap: space[2] },
  label: {
    fontSize: type.xs,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.inkFaint,
  },
  input: {
    minHeight: TOUCH_MIN + 4,
    paddingHorizontal: space[4],
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    color: colors.ink,
    fontSize: type.base,
  },
  multiline: { minHeight: 84, paddingTop: space[3], textAlignVertical: 'top' },

  foot: {
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[2],
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
