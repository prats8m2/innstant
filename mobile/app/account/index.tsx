import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as api from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { Button, Notice, Screen } from '@/components/ui';
import { colors, radius, space, text as type, TOUCH_MIN } from '@/lib/theme';

/**
 * The account. D-081.
 *
 * Signed out this screen is an invitation, not a gate — it says what an
 * account is for and offers one. Nothing behind it is required to order.
 */
export default function Account() {
  const { customer, addresses, setCustomer, refreshAccount, signOut } = useSession();
  const onError = useApiError();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => { void refreshAccount(); }, [refreshAccount]));

  if (!customer) {
    return (
      <Screen style={s.center}>
        <Stack.Screen options={{ title: 'Account' }} />
        <Text style={s.title}>No account yet</Text>
        <Text style={s.lede}>
          Sign in to save your address and keep your order history. Ordering
          works perfectly well without one.
        </Text>
        <Button label="Sign in" onPress={() => router.push('/account/sign-in')} />
      </Screen>
    );
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateProfile({
        name: name.trim() || undefined,
        email: email.trim() || null,
      });
      setCustomer(updated);
      setEditing(false);
    } catch (failure) {
      setError(onError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Account' }} />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {editing ? (
          <View style={s.card}>
            <View style={s.field}>
              <Text style={s.label}>Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={customer.name}
                placeholderTextColor={colors.inkFaint}
                maxLength={80}
                style={s.input}
                autoFocus
              />
            </View>
            <View style={s.field}>
              <Text style={s.label}>Email (optional)</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={customer.email ?? 'you@example.com'}
                placeholderTextColor={colors.inkFaint}
                keyboardType="email-address"
                autoCapitalize="none"
                maxLength={160}
                style={s.input}
              />
            </View>
            {error ? <Notice>{error}</Notice> : null}
            <Button label="Save" busy={busy} onPress={() => void save()} />
            <Button label="Cancel" tone="quiet" onPress={() => { setEditing(false); setError(null); }} />
          </View>
        ) : (
          <View style={s.card}>
            <Text style={s.name}>{customer.name}</Text>
            <Text style={s.detail}>{customer.phone}</Text>
            {customer.email ? <Text style={s.detail}>{customer.email}</Text> : null}
            {/* Said because it is the thing that makes the account trustworthy
                — the number was proved, not typed into a form by somebody. */}
            {customer.phoneVerified ? (
              <Text style={s.verified}>Phone confirmed</Text>
            ) : null}
            <Pressable
              onPress={() => { setName(customer.name); setEmail(customer.email ?? ''); setEditing(true); }}
              style={s.editRow}
            >
              <Text style={s.link}>Edit</Text>
            </Pressable>
          </View>
        )}

        <Row
          title="Saved addresses"
          sub={addresses.length
            ? addresses.map((x) => x.label).join(' · ')
            : 'None yet'}
          onPress={() => router.push('/account/addresses')}
        />
        <Row
          title="Your orders"
          sub="Everything you have ordered from here"
          onPress={() => router.push('/orders')}
        />

        <View style={s.outRow}>
          <Button label="Sign out" tone="quiet" onPress={() => void signOut()} />
          <Text style={s.outNote}>
            You stay signed in on other devices, and you can keep ordering
            without an account.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Row({ title, sub, onPress }: { title: string; sub: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.raised }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.rowSub} numberOfLines={1}>{sub}</Text>
      </View>
      <Text style={s.chevron}>›</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', paddingHorizontal: space[5], gap: space[4] },
  body: { padding: space[4], gap: space[3] },

  title: { fontSize: type.xl, fontWeight: '600', color: colors.ink },
  lede: { fontSize: type.base, lineHeight: 23, color: colors.inkDim },

  card: {
    padding: space[4],
    gap: space[2],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  name: { fontSize: type.lg, fontWeight: '600', color: colors.ink },
  detail: { fontSize: type.base, color: colors.inkDim },
  verified: { fontSize: type.xs, color: colors.positive, marginTop: space[1] },
  editRow: { marginTop: space[2] },
  link: { fontSize: type.sm, color: colors.accent, fontWeight: '600' },

  field: { gap: space[2] },
  label: {
    fontSize: type.xs,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.inkFaint,
  },
  input: {
    minHeight: 52,
    paddingHorizontal: space[4],
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    color: colors.ink,
    fontSize: type.base,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_MIN + space[2],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  rowTitle: { fontSize: type.base, fontWeight: '600', color: colors.ink },
  rowSub: { fontSize: type.sm, color: colors.inkDim, marginTop: 2 },
  chevron: { fontSize: type.xl, color: colors.inkFaint },

  outRow: { marginTop: space[4], gap: space[2] },
  outNote: {
    fontSize: type.xs,
    lineHeight: 17,
    color: colors.inkFaint,
    textAlign: 'center',
  },
});
