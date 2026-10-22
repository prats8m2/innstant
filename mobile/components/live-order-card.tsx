import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import type { ApiOrderSummary } from '@contract';
import { useDuration } from '@/lib/motion';
import {
  colors, duration, face, radius, space, tabular, text as type, TOUCH_MIN,
} from '@/lib/theme';

/**
 * An order that is still happening, where the arch would be. D-080.
 *
 * ─── The app holds no copy of the order state machine ──────────────────────
 *
 * Every word and every number on this card arrives decided: `statusLabel` is
 * the pill, `headline` is the sentence, `etaLabel`/`etaFrom`/`etaTo` are the
 * promise, and `stepIndex` of `stepCount` is the progress. They come off the
 * same `orderStateFor()`, `trackEta()` and `TRACK_STEPS` the tracking screen
 * uses, run once more in the list serialiser. An app that mapped a status to a
 * headline itself would be a second state machine, shipped inside an APK that
 * cannot be redeployed when the first one changes.
 *
 * ─── Five segments, and the number comes off the wire ──────────────────────
 *
 * The design draws six, one per live status. The timeline has FIVE steps:
 * ACCEPTED and PREPARING are deliberately one step ("In the kitchen"), with
 * the difference carried in the sub-line. Splitting a shipped state machine's
 * presentation half is a thing to ask about rather than to do, so the card
 * reads `stepCount` from the payload and draws whatever it says — which also
 * means a sixth step arriving later needs no new build.
 */
export function LiveOrderCard({
  order,
  timezone,
  onPress,
}: {
  order: ApiOrderSummary;
  /** The PROPERTY's timezone. The ETA is a time in the kitchen's day. */
  timezone: string;
  onPress: () => void;
}) {
  const eta = etaSentence(order, timezone);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${order.orderNumber}, ${order.statusLabel}. ${order.headline}${eta ? ` ${eta}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [s.card, pressed && s.pressed]}
    >
      <View style={s.head}>
        <Text style={[s.number, tabular]}>{order.orderNumber}</Text>
        <View style={s.pill}>
          <View style={s.pillDot} />
          <Text style={s.pillText}>{order.statusLabel}</Text>
        </View>
      </View>

      {order.stepCount > 0 ? (
        <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{
          min: 0, max: order.stepCount, now: order.stepIndex,
        }}>
          {Array.from({ length: order.stepCount }, (_, index) => (
            <Segment key={index} filled={index < order.stepIndex} />
          ))}
        </View>
      ) : null}

      <View style={s.foot}>
        <View style={s.footText}>
          <Text style={s.headline}>{order.headline}</Text>
          {eta ? <Text style={s.sub}>{eta}</Text> : null}
        </View>

        {/* Inside a card that is itself the target, so this is an affordance
            rather than a second button — but it is still 48 tall, because a
            thumb aiming at the word must not land between two things. */}
        <View style={s.track48}>
          <Text style={s.trackLabel}>Track</Text>
          <ChevronRight size={18} color={colors.accent} strokeWidth={2} strokeLinecap="round" />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * One segment of the progress bar.
 *
 * The animated value starts at its CURRENT state, so a card that mounts three
 * steps in appears three steps in — only a segment that actually changes
 * fills, which is what the 320ms is for. Reduced motion lands on the end
 * state on the next frame, never on a half-played one — `useDuration` is what
 * decides that, here and everywhere else, rather than a branch per component.
 *
 * The hook is called per segment rather than passed down from the card. It
 * reads one subscription's worth of state and there are at most five of them;
 * a `reduced` prop threaded through was the shape that made the card know
 * about an accessibility setting it has nothing to do with.
 */
function Segment({ filled }: { filled: boolean }) {
  const ms = useDuration();
  const on = useRef(new Animated.Value(filled ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(on, {
      toValue: filled ? 1 : 0,
      duration: ms(duration.slower),
      useNativeDriver: true,
    }).start();
  }, [filled, ms, on]);

  return (
    <View style={s.segment}>
      <Animated.View style={[StyleSheet.absoluteFill, s.segmentOn, { opacity: on }]} />
    </View>
  );
}

/**
 * "Leaves the kitchen around 9:40pm" — the server's label, the server's times.
 *
 * All three parts are null together when there is nothing honest to promise:
 * a halted order, or one placed before the outlet had a prep time. The card
 * then says only the headline, which is the truthful amount.
 */
function etaSentence(order: ApiOrderSummary, timezone: string): string | null {
  if (!order.etaLabel || !order.etaFrom) return null;
  const from = clock(order.etaFrom, timezone);
  const to = order.etaTo ? clock(order.etaTo, timezone) : null;
  return `${order.etaLabel} ${to ? `${from} – ${to}` : from}`;
}

/**
 * `9:41pm`, not `9:41 PM`, and in the PROPERTY's timezone.
 *
 * The lowercased, space-closed meridiem matches the web tracking screen, which
 * does it because the gap pushes a range onto a second line on a 390px screen.
 *
 * The timezone is the difference from `order/[orderId].tsx`, which renders in
 * the DEVICE's on the argument that somebody collecting food is in the same
 * city as the kitchen. That holds on a screen somebody opened to walk to a
 * counter; it does not hold here, where the same figure sits directly under an
 * opening line that is already property-local. CLAUDE.md's rule is the
 * property's timezone and this is the screen where the two would visibly
 * disagree.
 */
function clock(iso: string, timezone: string): string {
  try {
    return new Date(iso)
      .toLocaleTimeString('en-IN', {
        timeZone: timezone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
      .replace(/\s?([ap])\.?m\.?/i, (_, meridiem: string) => `${meridiem.toLowerCase()}m`);
  } catch {
    // An unknown IANA zone throws. A time in the wrong zone is still better
    // than a card that will not render.
    return new Date(iso)
      .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
      .replace(/\s?([ap])\.?m\.?/i, (_, meridiem: string) => `${meridiem.toLowerCase()}m`);
  }
}

const s = StyleSheet.create({
  card: {
    width: '100%',
    gap: space[3],
    padding: space[4],
    // No top margin. The 20 above the ARCH is the arch's own (the design gives
    // it `margin: 20px auto 0 auto`); this card REPLACES the arch and butts
    // straight against the 64pt top row, which is what the design draws.
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineFaint,
    // radius.md — one step rounder than every button, and the only card on
    // this screen allowed to read as raised.
    borderRadius: radius.md,
  },
  pressed: { borderColor: colors.accent },

  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  number: { ...face('mono'), fontSize: type.sm, color: colors.ink },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  pillText: {
    ...face('mono'),
    fontSize: type.xs,
    // .1em at 11pt.
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.accent,
  },

  track: { flexDirection: 'row', gap: 3 },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: 1,
    backgroundColor: colors.lineFaint,
    overflow: 'hidden',
  },
  segmentOn: { backgroundColor: colors.accent, borderRadius: 1 },

  foot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: space[3],
  },
  footText: { flex: 1, gap: 2 },
  headline: {
    ...face('display'),
    fontSize: type.xl,
    lineHeight: type.xl * 1.2,
    color: colors.ink,
  },
  sub: { ...face('body'), fontSize: type.sm, color: colors.inkSecondary },

  track48: {
    minHeight: TOUCH_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  trackLabel: { ...face('bodyMedium'), fontSize: type.base, color: colors.accent },
});
