import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, text as type, TOUCH_MIN, tabular } from '@/lib/theme';

/**
 * The handful of things every screen needs. D-080.
 *
 * Deliberately small. The web app's rule applies here too — feature UI lives
 * beside its screen, and only what is genuinely shared lives in one place.
 * Five components is what turned out to be shared.
 */

export function Screen({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[s.screen, style]}>{children}</View>;
}

/** A section heading, in the display voice. */
export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Body({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return <Text style={[s.body, dim && { color: colors.inkDim }]}>{children}</Text>;
}

/** A price, a quantity, a time — anything that sits beside another number. */
export function Figure({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[s.figure, style]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  disabled,
  busy,
  tone = 'primary',
  trailing,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'primary' | 'quiet';
  /** A total on the right of the label — the send button's shape. */
  trailing?: string;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        s.button,
        tone === 'quiet' && s.buttonQuiet,
        // Saffron goes LIGHTER on press in this theme — the opposite of the
        // console's, and the thing most often got wrong when porting.
        pressed && !off && (tone === 'quiet' ? s.quietPressed : s.buttonPressed),
        off && s.buttonOff,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={tone === 'quiet' ? colors.ink : colors.accentInk} />
      ) : (
        <>
          <Text style={[s.buttonLabel, tone === 'quiet' && s.buttonLabelQuiet]}>{label}</Text>
          {trailing ? (
            <Text style={[s.buttonLabel, tone === 'quiet' && s.buttonLabelQuiet, tabular]}>
              {trailing}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

/**
 * A refusal, in the server's own words.
 *
 * The app never rewrites one. The sentence a customer reads is chosen by the
 * code that refused — "The kitchen has stopped taking orders for tonight", not
 * "Error 409" — which is what makes the web and the app say the same thing.
 */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <View accessibilityRole="alert" style={s.notice}>
      <Text style={s.noticeText}>{children}</Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={s.loading}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={[s.body, { color: colors.inkDim }]}>{label}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },

  title: {
    fontSize: type.xl,
    fontWeight: '600',
    color: colors.ink,
    letterSpacing: 0.2,
  },
  body: { fontSize: type.base, lineHeight: 22, color: colors.ink },
  figure: { fontSize: type.base, color: colors.ink, ...tabular },

  button: {
    minHeight: TOUCH_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingHorizontal: space[5],
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  buttonPressed: { backgroundColor: colors.accentHover },
  buttonQuiet: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.line,
  },
  quietPressed: { backgroundColor: colors.raised },
  buttonOff: { opacity: 0.45 },
  buttonLabel: { fontSize: type.base, fontWeight: '700', color: colors.accentInk },
  buttonLabelQuiet: { color: colors.ink, fontWeight: '600' },

  notice: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    backgroundColor: colors.attentionTint,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.sm,
  },
  noticeText: { fontSize: type.sm, lineHeight: 20, color: colors.ink },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[3] },
});
