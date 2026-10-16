import { useEffect, useState } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReducedMotion } from '@/lib/motion';
import {
  colors, duration, radius, space, text as type, TOUCH_MIN,
} from '@/lib/theme';

/**
 * What a screen shows while it is fetching. Phase 1 of the redesign.
 *
 * ─── Why not the spinner that was here ─────────────────────────────────────
 *
 * A spinner says "something is happening". A skeleton says "a menu is
 * happening, and it will have a photo on the right and three lines on the
 * left" — so the page does not rearrange itself under a thumb that has
 * already started moving towards where the first dish is about to be. The
 * wait is identical; what changes is whether it is spent knowing anything.
 *
 * That only holds if the skeleton is the SHAPE of the content. These mirror
 * the real rows deliberately down to the padding, and the day the menu row
 * changes shape this file is wrong and should be changed with it. A generic
 * stack of grey bars would be a spinner with extra steps.
 *
 * ─── Reanimated, and on the UI thread ──────────────────────────────────────
 *
 * The rest of the app animates with RN's `Animated`, which is fine for the
 * one-shot fades it does. A skeleton is a loop running during a network
 * request — exactly when the JS thread is busiest — and a loop driven from JS
 * stutters precisely when somebody is looking at it. Reanimated's worklet
 * runs on the UI thread and does not care what JS is doing.
 */

/**
 * One block.
 *
 * The sweep is a gradient the width of the block, travelling from one edge to
 * the other, whose two ends are the block's own colour so there is no seam
 * where it enters and leaves. It needs the measured width to travel across,
 * which is why nothing moves until `onLayout` has fired — one frame, and the
 * static block is already on screen for it.
 */
export function Skeleton({
  width,
  height,
  round = radius.xs,
  /** On a card rather than on the ground. The ladder is paper → card →
   *  raised, so a block that is `card` on the ground has to step up to
   *  `raised` on a card or it disappears into it. */
  onCard = false,
  style,
}: {
  width: DimensionValue;
  height: number;
  round?: number;
  onCard?: boolean;
  style?: object;
}) {
  const reduced = useReducedMotion();
  const [measured, setMeasured] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    // Honouring the setting means rendering the block and leaving it alone.
    // There is no end state to collapse to the way the rest of the app does —
    // a loop's end is the data arriving, and that is not an animation.
    if (reduced || measured === 0) return;

    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: duration.shimmer, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [reduced, measured, progress]);

  const sweep = useAnimatedStyle(() => ({
    transform: [{ translateX: -measured + progress.value * measured * 2 }],
  }));

  const base = onCard ? colors.raised : colors.card;
  const peak = onCard ? colors.lineFaint : colors.raised;

  return (
    <View
      onLayout={(event) => setMeasured(event.nativeEvent.layout.width)}
      style={[{ width, height, borderRadius: round, backgroundColor: base, overflow: 'hidden' }, style]}
    >
      {reduced || measured === 0 ? null : (
        <Animated.View style={[s.sweep, { width: measured }, sweep]}>
          <LinearGradient
            colors={[base, peak, base]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

/**
 * The menu, mid-fetch: the outlet bar, the section rail, and five dish rows.
 *
 * Five rather than "enough to fill the screen" — a tall phone shows four and
 * a half, and the half is what says the list continues.
 */
export function MenuSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading the menu">
      <View style={s.menuBar}>
        <Skeleton width={150} height={type.sm} />
        <Skeleton width={190} height={type.sm} />
        <View style={s.rail}>
          {[96, 78, 112].map((chipWidth) => (
            <Skeleton key={chipWidth} width={chipWidth} height={CHIP_H} round={radius.sm} />
          ))}
        </View>
      </View>

      <View style={s.sectionHead}>
        <Skeleton width={168} height={type.lg} />
        <Skeleton width="82%" height={type.sm} style={{ marginTop: space[1] }} />
      </View>

      {[0, 1, 2, 3, 4].map((index) => <DishRowSkeleton key={index} index={index} />)}
    </View>
  );
}

/** One menu row: text on the left, a 112pt photo on the right. */
function DishRowSkeleton({ index }: { index: number }) {
  // Alternating line lengths. A column of identically ragged rows reads as a
  // pattern rather than as text that has not arrived.
  const wide = index % 2 === 0;
  return (
    <View style={s.dishRow}>
      <View style={s.dishBody}>
        <Skeleton width={wide ? '74%' : '58%'} height={type.base} />
        <Skeleton width="92%" height={type.sm} />
        <Skeleton width={wide ? '64%' : '78%'} height={type.sm} />
        <Skeleton width={72} height={type.base} style={{ marginTop: space[1] }} />
      </View>
      <Skeleton width={112} height={112} round={radius.md} />
    </View>
  );
}

/** The orders list: four cards, each a number, a status chip and a total. */
export function OrdersSkeleton() {
  return (
    <View style={s.orderList} accessibilityRole="progressbar" accessibilityLabel="Loading your orders">
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={s.orderCard}>
          <View style={s.orderBody}>
            <View style={s.orderHead}>
              <Skeleton width={84} height={type.base} onCard />
              <Skeleton width={96} height={type.base} round={radius.xs} onCard />
            </View>
            <Skeleton width={index % 2 === 0 ? '86%' : '62%'} height={type.sm} onCard />
          </View>
          <Skeleton width={64} height={type.base} onCard />
        </View>
      ))}
    </View>
  );
}

/**
 * The home screen: the hero well, the status strip, three featured dishes and
 * the contents list.
 *
 * The well is the one surface in the app darker than the ground, and the
 * skeleton keeps it — the alternative is the page changing colour from top to
 * bottom the moment the menu lands, which is more movement than the thing it
 * is standing in for.
 */
export function HomeSkeleton() {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={s.home}
      accessibilityRole="progressbar"
      accessibilityLabel="Opening the menu"
    >
      <View style={[s.well, { paddingTop: insets.top }]}>
        <View style={s.topRow}>
          <Skeleton width={170} height={type.base} />
          <Skeleton width={34} height={34} round={17} />
        </View>

        {/* Where the hero is: one full-bleed block the height of the
            photograph and the arch standing in it, then the caption line
            under it. Not an arch outline and not a headline in two pieces —
            a skeleton that drew the brand would be claiming the page had
            already arrived. */}
        <View style={s.heroPhoto}>
          <Skeleton width="100%" height={HERO_H} round={0} />
        </View>
        <View style={s.heroCaption}>
          <Skeleton width={190} height={type.sm} />
        </View>

        <View style={s.hairline} />

        <View style={s.strip}>
          <View style={s.stripCell}>
            <Skeleton width={72} height={type.xs} />
            <Skeleton width={150} height={type.base} style={{ marginTop: space[2] }} />
          </View>
          <View style={s.stripCell}>
            <Skeleton width={72} height={type.xs} />
            <Skeleton width={88} height={type.base} style={{ marginTop: space[2] }} />
          </View>
        </View>
      </View>

      <View style={s.homeBody}>
        {/* The category circles. Four and a half, because the half is what
            says the rail scrolls. */}
        <View style={s.circles}>
          {[0, 1, 2, 3, 4].map((index) => (
            <View key={index} style={s.circleCell}>
              <Skeleton width={CIRCLE} height={CIRCLE} round={CIRCLE / 2} />
              <Skeleton width={index % 2 === 0 ? 56 : 42} height={type.xs} />
            </View>
          ))}
        </View>

        <View style={s.blockHead}>
          <Skeleton width={196} height={type.xl} />
          <Skeleton width={64} height={type.xs} />
        </View>

        {[0, 1, 2].map((index) => (
          <View key={index} style={s.featured}>
            <View style={s.dishBody}>
              <Skeleton width={88} height={type.xs} />
              <Skeleton width={index === 1 ? '62%' : '80%'} height={type.xl} />
              <Skeleton width="94%" height={type.sm} />
              <Skeleton width={72} height={type.base} style={{ marginTop: space[1] }} />
            </View>
            <Skeleton width={96} height={96} round={radius.md} />
          </View>
        ))}

        <View style={[s.blockHead, { marginTop: space[7] }]}>
          <Skeleton width={120} height={type.xl} />
          <Skeleton width={72} height={type.xs} />
        </View>

        {[0, 1, 2, 3].map((index) => (
          <View key={index} style={s.contentsRow}>
            <Skeleton width={22} height={type.sm} />
            <View style={s.dishBody}>
              <Skeleton width={index % 2 === 0 ? '52%' : '38%'} height={type.base} />
              <Skeleton width="88%" height={type.sm} />
            </View>
            <Skeleton width={24} height={type.sm} />
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Inside the dish sheet, where the height is the sheet's and not the
 * content's — so this fills a known box rather than sizing one.
 */
export function DishSkeleton() {
  return (
    <View style={s.sheet} accessibilityRole="progressbar" accessibilityLabel="Loading the dish">
      <Skeleton width="70%" height={type.xxl} />
      <Skeleton width={96} height={type.lg} />
      <Skeleton width="100%" height={type.sm} />
      <Skeleton width="84%" height={type.sm} />

      <View style={{ marginTop: space[4], gap: space[2] }}>
        <Skeleton width={140} height={type.base} />
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} width="100%" height={TOUCH_MIN} round={radius.sm} />
        ))}
      </View>
    </View>
  );
}

/** The section rail's chips: two 8pt paddings around a 13pt line, rounded. */
const CHIP_H = type.sm + space[2] * 2 + 2;

/** The hero photograph and the arch standing in it — 20 of margin, a 300pt
 *  arch and the 28 it stands on. Mirrors `components/arch.tsx`. */
const HERO_H = 348;

/** The category circle, from `components/category-rail.tsx`. */
const CIRCLE = 72;

const s = StyleSheet.create({
  sweep: { position: 'absolute', top: 0, bottom: 0, left: 0 },

  menuBar: {
    paddingHorizontal: space[5],
    paddingBottom: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: space[1],
  },
  rail: { flexDirection: 'row', gap: space[2], paddingTop: space[3] },

  sectionHead: { paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[2] },

  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    minHeight: TOUCH_MIN + space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  dishBody: { flex: 1, gap: space[2] },

  orderList: { padding: space[4], gap: space[2] },
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: TOUCH_MIN + space[3],
    padding: space[4],
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  orderBody: { flex: 1, gap: space[2] },
  orderHead: { flexDirection: 'row', alignItems: 'center', gap: space[3] },

  home: { flex: 1 },
  well: { backgroundColor: colors.paperDeep, paddingHorizontal: space[5], paddingBottom: space[5] },
  topRow: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroPhoto: { marginHorizontal: -space[5] },
  heroCaption: { alignItems: 'center', paddingVertical: space[3] },
  circles: { flexDirection: 'row', gap: space[4], marginTop: space[5], overflow: 'hidden' },
  circleCell: { width: CIRCLE, alignItems: 'center', gap: space[2] },
  hairline: { height: 1, backgroundColor: colors.lineFaint, marginHorizontal: -space[5] },
  strip: { flexDirection: 'row', paddingTop: space[4], gap: space[5] },
  stripCell: { flex: 1 },

  homeBody: { paddingHorizontal: space[5] },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space[6],
    paddingBottom: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.lineFaint,
  },
  featured: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingVertical: space[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  contentsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingVertical: space[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },

  sheet: { paddingHorizontal: space[5], paddingTop: space[4], gap: space[2] },
});
