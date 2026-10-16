import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation, interpolate, runOnJS, useAnimatedScrollHandler, useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DishChoiceBody, DishChoiceFooter, useDishChoice } from '@/components/dish-choice';
import { DishPhoto } from '@/components/dish-photo';
import { DishSkeleton } from '@/components/skeleton';
import { Notice, Screen } from '@/components/ui';
import { useReducedMotion } from '@/lib/motion';
import { colors, heroScrim, paperTransparent, space } from '@/lib/theme';

/**
 * One dish, and the choices it carries, as a whole screen. D-080.
 *
 * ─── Why this still exists now that there is a sheet ───────────────────────
 *
 * Phase 1 moved modifier selection into a bottom sheet over the menu, which
 * is how somebody choosing a dish gets there from inside the app. A sheet
 * cannot be deep-linked to: there is no menu behind a cold launch on
 * `/dish/:id`, and a sheet floating over an empty ground is a bug that looks
 * like a design. So the route stays, and a link into it renders a page.
 *
 * Phase 2 gave it the one thing a sheet cannot have: the photograph, at the
 * size the photograph deserves. The hero on the home screen opens this rather
 * than the sheet for exactly that reason — it is a jump from a picture to the
 * dish it is of.
 *
 * Everything that decides anything — the preselected defaults, what a
 * single-choice group does to its siblings, which required group is still
 * unanswered, the running total, and the add itself — is in
 * `useDishChoice()`. This file is a scroll view, a header, a footer and the
 * insets.
 */

/**
 * 280pt of photograph: tall enough to be a photograph rather than a banner,
 * short enough that the first option group is on screen on a 667pt phone
 * before anybody scrolls.
 */
const HEADER = 280;

export default function Dish() {
  const { itemId } = useLocalSearchParams<{ itemId: string }>();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const choice = useDishChoice(itemId, () => router.back());

  /**
   * The scroll position, on the UI thread.
   *
   * A collapsing header driven from JS judders precisely when the list under
   * it is doing work, which is the moment somebody is looking at it. This is
   * the same argument the skeletons make for using Reanimated and not RN's
   * `Animated`.
   */
  const y = useSharedValue(0);
  /**
   * Whether the photograph is gone, as a boolean the JS side knows.
   *
   * It is what puts the dish's name in the navigation header once the
   * picture carrying it has left — the bar is the real one rather than a
   * drawn copy of it, which is the difference between a collapsing header
   * and a screen with two headers.
   *
   * `crossed` is the shared value that keeps this to one `runOnJS` per
   * crossing. Without it the UI thread calls back on every frame of every
   * scroll, and the screen re-renders sixty times a second to set a boolean
   * to the value it already has.
   */
  const [collapsed, setCollapsed] = useState(false);
  const crossed = useSharedValue(false);
  const onScroll = useAnimatedScrollHandler((event) => {
    y.value = event.contentOffset.y;
    const past = event.contentOffset.y > HEADER * 0.7;
    if (past !== crossed.value) {
      crossed.value = past;
      runOnJS(setCollapsed)(past);
    }
  });

  /**
   * The collapse, as three interpolations of one value.
   *
   *   · `translateY` at half the scroll speed, so the photograph recedes
   *     rather than sliding away — the standard parallax, and the thing that
   *     makes the header read as behind the content.
   *   · `scale` on OVERSCROLL only, which is what a pull down at the top of
   *     a photograph is expected to do.
   *   · `opacity`, right at the end. The content covers the photograph as it
   *     rises — it is an opaque slab, deliberately — so this is only about
   *     the strip left above it, which must not still be a photograph when
   *     the header has become a bar with a name in it.
   */
  const photo = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [HEADER * 0.6, HEADER * 0.95], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(y.value, [0, HEADER], [0, -HEADER / 2], Extrapolation.CLAMP) },
      { scale: interpolate(y.value, [-HEADER, 0], [1.6, 1], Extrapolation.CLAMP) },
    ],
  }));

  if (choice.error && !choice.detail) {
    return <Screen style={s.center}><Notice>{choice.error}</Notice></Screen>;
  }

  const dish = choice.detail?.dish ?? null;
  const image = dish?.imageUrl ?? null;

  /**
   * Honouring reduced motion is rendering the photograph IN the scroll.
   *
   * There is no end state to collapse to here — the collapse is a position,
   * not a transition — so the honest version of "remove the movement" is a
   * header that simply scrolls away with the content at the speed everything
   * else moves at. Same photograph, same size, same place; nothing recedes,
   * nothing fades, and nothing is lost but the parallax.
   */
  const stillHeader = reduced && image ? (
    <View style={s.still}>
      <DishPhoto
        uri={image}
        blurhash={dish?.blurhash}
        name={dish?.name ?? ''}
        width="100%"
        height={HEADER}
        bleed
      />
      <LinearGradient
        colors={[paperTransparent, colors.paper]}
        style={s.foot}
        pointerEvents="none"
      />
    </View>
  ) : null;

  return (
    <Screen>
      {/*
        Transparent, so the photograph runs up under the back arrow rather
        than starting below a bar — and empty, because the dish's name is
        six inches high in the content underneath it.

        It takes the name the moment the photograph has gone, which is what
        makes this one header rather than a navigation bar with a second bar
        drawn under it. With motion reduced there is no scroll handler to
        tell it, so it simply carries the name from the start.
      */}
      <Stack.Screen
        options={{
          title: image && !(collapsed || reduced) ? '' : (dish?.name ?? ''),
          headerTransparent: Boolean(image) && !reduced,
          headerTintColor: colors.ink,
        }}
      />

      {image && !reduced ? (
        <Animated.View style={[s.header, photo]} pointerEvents="none">
          <DishPhoto
            uri={image}
            blurhash={dish?.blurhash}
            name={dish?.name ?? ''}
            width="100%"
            height={HEADER}
            bleed
          />
          {/* Top: the back arrow sits on this, and a white arrow on a pale
              photograph is invisible. Bottom: the content has to begin out
              of the picture rather than on it. */}
          <LinearGradient
            colors={[heroScrim.top, paperTransparent]}
            style={[s.cap, { height: insets.top + space[7] }]}
          />
          <LinearGradient colors={[paperTransparent, colors.paper]} style={s.foot} />
        </Animated.View>
      ) : null}

      {choice.detail ? (
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* The photograph is absolute behind this, so the scroll opens with
              a hole the height of it. The slab below is OPAQUE and that is
              the whole mechanism: scrolling slides the ground up over the
              picture, rather than dragging content across one still visible
              underneath. */}
          {image && !reduced ? <View style={s.hole} /> : null}

          <View style={s.slab}>
            {stillHeader}
            <DishChoiceBody choice={choice} showPhoto={!image} />
          </View>
        </Animated.ScrollView>
      ) : (
        <DishSkeleton />
      )}

      <View style={[s.footer, { paddingBottom: insets.bottom + space[4] }]}>
        <DishChoiceFooter choice={choice} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', padding: space[5] },
  scroll: { paddingBottom: space[6] },
  hole: { height: HEADER },
  slab: {
    backgroundColor: colors.paper,
    paddingHorizontal: space[5],
    paddingTop: space[4],
    paddingBottom: space[6],
    gap: space[4],
    // Tall enough that the slab still covers the photograph on a short dish
    // with one option group — without it the picture reappears under the
    // last line of a scroll that has nothing left to give.
    minHeight: HEADER,
  },

  header: { position: 'absolute', left: 0, right: 0, top: 0, height: HEADER },
  cap: { position: 'absolute', left: 0, right: 0, top: 0 },
  // 96 of fade into the ground: enough for the picture to end and the dish's
  // name to begin on the ground rather than on a photograph.
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 96 },

  // In the flow, for the reduced-motion path. It breaks the content's gutter
  // so the photograph is still full-bleed.
  // Up into the slab's own top padding, so the photograph starts at the top
  // of the scroll rather than below a gap.
  still: { marginHorizontal: -space[5], marginTop: -space[4] },

  footer: {
    paddingHorizontal: space[5],
    paddingTop: space[3],
    gap: space[2],
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.paper,
  },
});
