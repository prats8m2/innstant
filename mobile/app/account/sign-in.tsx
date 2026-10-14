import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as api from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { Button, Notice, Screen } from '@/components/ui';
import { colors, radius, space, text as type, tabular } from '@/lib/theme';

/**
 * Signing in. A phone number, then a code. D-081.
 *
 * ─── What this screen is NOT ───────────────────────────────────────────────
 *
 * A wall. Nothing in this app requires it: the menu, the cart and placing an
 * order all work signed out and must keep doing so (#9). An account buys saved
 * addresses, a name the kitchen already knows, and a history that survives the
 * visit — and somebody who does not want one is never asked twice.
 *
 * ─── One screen, two steps ─────────────────────────────────────────────────
 *
 * Rather than two routes. Going "back" from a code entry should return to the
 * number you typed, not to wherever you were before signing in, and a stack
 * with two routes makes that an explicit thing to get right rather than the
 * default.
 */
export default function SignIn() {
  const { setCustomer } = useSession();
  const onError = useApiError();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<'PHONE' | 'CODE'>('PHONE');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeField = useRef<TextInput>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestOtp(phone.trim());
      setStep('CODE');
      // Focus after the render that mounts it, or there is nothing to focus.
      setTimeout(() => codeField.current?.focus(), 120);
    } catch (failure) {
      setError(onError(failure));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const signedIn = await api.verifyOtp({
        phone: phone.trim(),
        code: code.trim(),
        name: name.trim() || undefined,
      });
      setCustomer(signedIn.customer, signedIn.addresses);
      router.back();
    } catch (failure) {
      setError(onError(failure));
      // Clear the code but NOT the number: a wrong code is one field to
      // retype, and re-entering a phone number to fix a typo in six digits is
      // the kind of thing that makes somebody give up.
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: step === 'PHONE' ? 'Sign in' : 'Enter the code' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {step === 'PHONE' ? (
            <>
              <Text style={s.title}>Your orders, kept</Text>
              <Text style={s.lede}>
                Sign in to save your address and see what you have ordered
                before. You can keep ordering without one — nothing here is
                locked.
              </Text>

              <View style={s.field}>
                <Text style={s.label}>Phone</Text>
                <TextInput
                  value={phone}
                  onChangeText={(v) => { setPhone(v); setError(null); }}
                  placeholder="98290 11111"
                  placeholderTextColor={colors.inkFaint}
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  autoFocus
                  maxLength={32}
                  style={s.input}
                />
                <Text style={s.hint}>We text a six-digit code. No password.</Text>
              </View>

              {error ? <Notice>{error}</Notice> : null}
            </>
          ) : (
            <>
              <Text style={s.title}>Check your messages</Text>
              <Text style={s.lede}>
                We sent a six-digit code to {phone.trim()}.
              </Text>

              <View style={s.field}>
                <Text style={s.label}>Code</Text>
                <TextInput
                  ref={codeField}
                  value={code}
                  onChangeText={(v) => { setCode(v.replace(/\D/g, '')); setError(null); }}
                  placeholder="······"
                  placeholderTextColor={colors.inkFaint}
                  keyboardType="number-pad"
                  // The OS fills this from the SMS on both platforms, which is
                  // the single biggest thing that makes an OTP not feel like
                  // work.
                  textContentType="oneTimeCode"
                  autoComplete="sms-otp"
                  maxLength={6}
                  style={[s.input, s.codeInput, tabular]}
                />
              </View>

              <View style={s.field}>
                <Text style={s.label}>Name (optional)</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="What shall we call out?"
                  placeholderTextColor={colors.inkFaint}
                  autoComplete="name"
                  maxLength={80}
                  style={s.input}
                />
                <Text style={s.hint}>
                  Only used if this is your first order. It never changes a name
                  a hotel already has for you.
                </Text>
              </View>

              {error ? <Notice>{error}</Notice> : null}

              <Pressable onPress={() => { setStep('PHONE'); setCode(''); setError(null); }}>
                <Text style={s.link}>Wrong number? Change it</Text>
              </Pressable>
            </>
          )}
        </ScrollView>

        <View style={[s.foot, { paddingBottom: insets.bottom + space[4] }]}>
          {step === 'PHONE' ? (
            <Button
              label="Send me a code"
              busy={busy}
              disabled={phone.trim().length < 7}
              onPress={() => void send()}
            />
          ) : (
            <>
              <Button
                label="Sign in"
                busy={busy}
                disabled={code.length < 4}
                onPress={() => void verify()}
              />
              <Pressable onPress={() => void send()} disabled={busy}>
                <Text style={s.resend}>Send it again</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: space[5], paddingTop: space[5], gap: space[4] },
  title: { fontSize: type.xxl, fontWeight: '600', color: colors.ink, lineHeight: 34 },
  lede: { fontSize: type.base, lineHeight: 23, color: colors.inkDim },

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
  // Wide spacing and a large face: six digits typed on a phone by somebody
  // who wants their dinner.
  codeInput: { fontSize: type.xxl, letterSpacing: 12, textAlign: 'center' },
  hint: { fontSize: type.sm, lineHeight: 19, color: colors.inkFaint },

  link: { fontSize: type.sm, color: colors.accent, marginTop: space[2] },
  resend: {
    fontSize: type.sm,
    color: colors.accent,
    textAlign: 'center',
    paddingVertical: space[3],
  },

  foot: {
    paddingHorizontal: space[5],
    paddingTop: space[3],
    gap: space[1],
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
});
