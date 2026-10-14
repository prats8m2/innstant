import { useCallback, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as api from '@/lib/api';
import type { ApiAddress } from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { Button, Notice, Screen } from '@/components/ui';
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
  const onError = useApiError();

  const [editing, setEditing] = useState<ApiAddress | 'NEW' | null>(null);
  const [label, setLabel] = useState('');
  const [line, setLine] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => { void refreshAccount(); }, [refreshAccount]));

  if (!customer) {
    return (
      <Screen style={s.center}>
        <Stack.Screen options={{ title: 'Addresses' }} />
        <Text style={s.lede}>Sign in to save an address.</Text>
        <Button label="Sign in" onPress={() => router.push('/account/sign-in')} />
      </Screen>
    );
  }

  const begin = (address: ApiAddress | 'NEW') => {
    setEditing(address);
    setLabel(address === 'NEW' ? '' : address.label);
    setLine(address === 'NEW' ? '' : address.line);
    setNotes(address === 'NEW' ? '' : address.notes ?? '');
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
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
    } catch (failure) {
      setError(onError(failure));
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
            } catch (failure) {
              setError(onError(failure));
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
    } catch (failure) {
      setError(onError(failure));
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
            {error ? <Notice>{error}</Notice> : null}
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
        {error ? <Notice>{error}</Notice> : null}

        {addresses.length === 0 ? (
          <Text style={s.lede}>
            No addresses saved. Add one and it fills itself in at checkout.
          </Text>
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
  center: { justifyContent: 'center', paddingHorizontal: space[5], gap: space[4] },
  body: { padding: space[4], gap: space[3] },
  lede: { fontSize: type.base, lineHeight: 23, color: colors.inkDim },

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
