import { StyleSheet, Text, View } from 'react-native';
import { CloudOff, TriangleAlert, type LucideIcon } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { colors, face, radius, space, text as type } from '@/lib/theme';

/**
 * A list with nothing in it, drawn. Phase 4 of the redesign.
 *
 * ─── Why this is one component and not five empty states ───────────────────
 *
 * Every list in this app had the same hole in it. The menu had a sentence for
 * filtered-to-nothing and nothing at all for a menu that failed to load; the
 * orders tab had an empty state and a bare `Notice` for a failure; addresses
 * had a line of dim text; the cart had a line of dim text and a button. Five
 * screens, five shapes, and on three of them an empty list and a failed
 * request looked identical — which is the one distinction that has to survive,
 * because a person who cannot tell them apart concludes the app is broken and
 * closes it.
 *
 * Search was the exception and is where the pattern comes from: it has
 * deliberately separate idle, nothing-matched and failed states, and its own
 * comment says why. This is that, made available to the other five.
 *
 * ─── Three tones, and the middle one is the one apps skip ──────────────────
 *
 *   · `empty`   — the request worked and there is genuinely nothing. Quiet:
 *                 ink on a raised square, no alarm, because nothing is wrong.
 *   · `offline` — the request never reached a server. Saffron, because it is
 *                 a condition rather than a fault, and because the advice
 *                 ("try again") is actually worth following.
 *   · `refused` — it reached one and the answer was no. Terracotta.
 *
 * The last two are spelled exactly as `Failure['kind']` is, so a screen
 * holding a failure writes `tone={failure.kind}` and cannot map it wrong.
 *
 * Offline is the one nobody draws, and it is the one this product cannot skip:
 * the app runs on hotel wifi and on a phone standing outside a restaurant. A
 * generic "something went wrong" there tells somebody to doubt the kitchen
 * when what they should doubt is the signal.
 *
 * ─── The copy rules, applied ───────────────────────────────────────────────
 *
 * CLAUDE.md: guest-facing messages say what happened and what to do; they do
 * not apologise and are never vague. So every caller passes a `title` that is
 * a statement of fact and a `body` that is an instruction, and `message` —
 * when there is one — is the server's own sentence, rendered verbatim
 * underneath. The app never rewrites a refusal it did not decide.
 */
export function ListState({
  tone,
  icon,
  title,
  body,
  message,
  actionLabel,
  onAction,
  fill = true,
}: {
  tone: 'empty' | 'offline' | 'refused';
  /** Required for `empty`, where the right picture is about the list rather
   *  than about the failure. The other two have one answer each. */
  icon?: LucideIcon;
  /** What happened. A fact, not an apology. */
  title: string;
  /** What to do about it. */
  body?: string;
  /** The server's own words, when a server said something. Never rewritten. */
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Centred in whatever space is left, which is right for a whole screen and
   * wrong inside a `ListHeaderComponent` — a `flex: 1` child of a scroll
   * container collapses to nothing and the state disappears entirely.
   */
  fill?: boolean;
}) {
  const Icon = icon ?? DEFAULT_ICON[tone];

  return (
    <View
      style={[s.wrap, fill && s.fill]}
      // Said once, as one announcement, rather than three Texts read in
      // sequence with no relationship between them.
      accessibilityRole={tone === 'empty' ? undefined : 'alert'}
      accessibilityLiveRegion="polite"
    >
      <View style={[s.badge, TINT[tone]]}>
        <Icon size={22} color={INK[tone]} strokeWidth={1.75} />
      </View>

      <Text style={s.title}>{title}</Text>
      {body ? <Text style={s.body}>{body}</Text> : null}
      {message ? <Text style={[s.message, { color: INK[tone] }]}>{message}</Text> : null}

      {actionLabel && onAction ? (
        <View style={s.action}>
          <Button label={actionLabel} tone="quiet" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

/** `CloudOff` rather than `WifiOff`: the thing that is missing is the kitchen
 *  at the other end, not the radio in the phone — a hotel's wifi is very
 *  often connected and going nowhere, which is exactly this state. */
const DEFAULT_ICON: Record<'empty' | 'offline' | 'refused', LucideIcon> = {
  empty: TriangleAlert,
  offline: CloudOff,
  refused: TriangleAlert,
};

const TINT = {
  empty: { backgroundColor: colors.raised },
  offline: { backgroundColor: colors.attentionTint },
  refused: { backgroundColor: colors.criticalTint },
} as const;

const INK = {
  empty: colors.inkFaint,
  offline: colors.attention,
  refused: colors.critical,
} as const;

const s = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingHorizontal: space[5],
    paddingTop: space[6],
    paddingBottom: space[5],
    gap: space[3],
  },
  fill: { flex: 1, justifyContent: 'center' },

  badge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },

  title: {
    ...face('display'),
    fontSize: type.xl,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    ...face('body'),
    fontSize: type.base,
    lineHeight: 22,
    color: colors.inkDim,
    textAlign: 'center',
    maxWidth: 320,
  },
  /* The server's sentence, set apart from the app's. It is the one line here
     this app did not write, and it is tinted to the tone so it reads as the
     reason rather than as more advice. */
  message: {
    ...face('body'),
    fontSize: type.sm,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 320,
  },
  /* Width, not `alignSelf: stretch` — stretch overrides the column's own
     centring and parks the button against the left gutter. */
  action: { marginTop: space[2], width: '100%', maxWidth: 280 },
});
