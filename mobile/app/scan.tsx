import { useCallback, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack } from 'expo-router';
import { Button, Notice, Screen } from '@/components/ui';
import { useSession } from '@/lib/session';
import { extractCode } from './index';
import { colors, radius, space, text as type } from '@/lib/theme';

/**
 * The camera. D-080.
 *
 * ─── Why the app scans at all, when the phone already does ─────────────────
 *
 * A phone's own camera reads the QR and opens `innstant.in/p/{code}`, which a
 * universal link turns into this app. That is the main path and it needs no
 * screen. This exists for the cases where it does not happen: a code read from
 * inside the app by somebody who already has it open, an Android launcher
 * whose camera does not scan, an iPhone that opened Safari because the user
 * once told it to.
 *
 * ─── The permission is asked for in context, not at launch ─────────────────
 *
 * Asking on first launch is asking before there is a reason, and a refusal
 * then is permanent in practice — iOS never asks twice. Asking here means the
 * prompt arrives one tap after somebody pressed a button that says "Scan a
 * code", which is the only moment the answer is obviously yes.
 *
 * A refusal is not a dead end: the entry screen takes a typed code, and the
 * message below says so rather than just naming the problem.
 */
export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  const { open } = useSession();
  const [error, setError] = useState<string | null>(null);
  /**
   * The camera fires `onBarcodeScanned` continuously — many times a second
   * while a code is in frame. Without this latch the first scan opens a visit
   * and the next twenty open twenty more, each one its own row.
   */
  const handled = useRef(false);

  const onScan = useCallback(async (value: string) => {
    if (handled.current) return;
    const code = extractCode(value);
    if (!code) {
      // Not ours — a wifi QR, a payment code, a poster. Say so and keep the
      // camera live rather than bouncing back to the previous screen.
      setError('That code is not from a restaurant using this app.');
      return;
    }

    handled.current = true;
    try {
      await open(code);
    } catch (failure) {
      handled.current = false;
      setError(failure instanceof Error ? failure.message : 'That did not work.');
    }
  }, [open]);

  if (!permission) return <Screen />;

  if (!permission.granted) {
    const askedAndRefused = !permission.canAskAgain;
    return (
      <Screen style={s.center}>
        <Stack.Screen options={{ title: 'Scan a code' }} />
        <Text style={s.title}>
          {askedAndRefused ? 'The camera is switched off for this app' : 'Use the camera?'}
        </Text>
        <Text style={s.body}>
          {askedAndRefused
            ? 'You can turn it back on in Settings — or go back and type the code from your table instead.'
            : 'To read the code on your table. Nothing is recorded and no photo is kept.'}
        </Text>
        <Button
          label={askedAndRefused ? 'Open Settings' : 'Use the camera'}
          onPress={() => {
            if (askedAndRefused) void Linking.openSettings();
            else void requestPermission();
          }}
        />
        <Button label="Type it instead" tone="quiet" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Scan a code' }} />
      <CameraView
        style={StyleSheet.absoluteFill}
        // QR only. Letting it read every format means a till's barcode or a
        // book's ISBN fires the handler, and every one of those is a round
        // trip and an error message.
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => void onScan(data)}
      />

      <View style={s.overlay} pointerEvents="box-none">
        {/* Drawn rather than left to the viewfinder: a plain camera feed gives
            no clue how close to hold a phone, and people hold it too far. */}
        <View style={s.frame} />
        <Text style={s.hint}>Point it at the code on your table</Text>
        {error ? <View style={s.error}><Notice>{error}</Notice></View> : null}
        <Pressable onPress={() => router.back()} style={s.cancel}>
          <Text style={s.cancelText}>Type it instead</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', padding: space[5], gap: space[4] },
  title: { fontSize: type.xl, fontWeight: '600', color: colors.ink },
  body: { fontSize: type.base, lineHeight: 22, color: colors.inkDim },

  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[5] },
  frame: {
    width: 240,
    height: 240,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  hint: {
    fontSize: type.base,
    color: '#FFFFFF',
    // A scrim behind the words: the frame sits over whatever the table looks
    // like, and white on a white tablecloth is unreadable.
    backgroundColor: 'rgba(10, 18, 32, 0.78)',
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  error: { paddingHorizontal: space[5] },
  cancel: {
    position: 'absolute',
    bottom: space[7],
    paddingVertical: space[3],
    paddingHorizontal: space[5],
  },
  cancelText: { fontSize: type.base, fontWeight: '600', color: '#FFFFFF' },
});
