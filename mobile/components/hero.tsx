import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight } from 'lucide-react-native';
import { Arch } from '@/components/arch';
import { DishPhoto } from '@/components/dish-photo';
import { HOME_COPY } from '@/lib/copy';
import {
  colors, face, heroScrim, space, text as type, TOUCH_MIN,
} from '@/lib/theme';

/**
 * The home screen's hero: a photograph, with the arch standing in it.
 * Phase 2 of the redesign.
 *
 * ─── Why the arch stays ────────────────────────────────────────────────────
 *
 * Phase 1 shipped the arch alone and said so in as many words — "the menu is
 * set like a printed card, with no photography" — which was the right answer
 * to having no photographs. It is the wrong answer to having them, and the
 * plan is explicit about which half gives way: Swiggy's structure, the
 * Kesari's skin. So the photograph arrives BEHIND the arch rather than
 * instead of it. The arch is the brand; the photograph is the food.
 *
 * ─── The photograph is a real dish, and it says which ──────────────────────
 *
 * It is `featured[0]` — the first dish the server picked, by the same
 * `featuredDishes()` rule the strip below uses. Not a hero asset nobody
 * uploaded, and not a stock curry: a stock photograph on a heritage hotel's
 * own app reads as a lie, and there is no `properties.hero_image` to read.
 *
 * Which is also why it is captioned and tappable. An uncredited full-bleed
 * photograph of food on an ordering screen is an implied offer, and this one
 * is genuinely orderable — so it says what it is, what it costs, and opens
 * it. A decorative hero would be the app showing somebody a dish and then
 * making them find it.
 *
 * ─── No photograph, no change ──────────────────────────────────────────────
 *
 * A property that has uploaded nothing gets exactly the screen phase 1
 * shipped: the arch on the deep well, no scrim, no caption. The image-led
 * layout is additive on top of a layout that already worked without it.
 */
export function HomeHero({
  photo,
  eyebrow,
  headline,
  dimmed,
  onPressPhoto,
}: {
  /** The dish the photograph is of, or null when there is none to show. */
  photo: { uri: string; blurhash: string | null; name: string; price: string } | null;
  eyebrow: string;
  headline: string;
  /** The kitchen is shut. The arch drops a step and the photograph takes a
   *  wash of the ground — it is not hidden, it is simply not lit. */
  dimmed?: boolean;
  onPressPhoto: () => void;
}) {
  return (
    <View style={s.hero}>
      {photo ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <DishPhoto
            uri={photo.uri}
            blurhash={photo.blurhash}
            name={photo.name}
            width="100%"
            height="100%"
            bleed
          />
          {/*
            Three stops rather than two. A single top-down fade either leaves
            the headline sitting on the brightest part of the picture or
            darkens the picture to the point of being a texture; this keeps
            the middle band readable and closes both ends into the ground, so
            the hero has no visible edge at the wordmark or at the hairline.
          */}
          <LinearGradient
            colors={[heroScrim.top, heroScrim.mid, heroScrim.bottom]}
            locations={[0, 0.42, 1]}
            style={StyleSheet.absoluteFill}
          />
          {dimmed ? <View style={[StyleSheet.absoluteFill, s.shut]} /> : null}
        </View>
      ) : null}

      <Arch eyebrow={eyebrow} headline={headline} dimmed={dimmed} />

      {photo ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${HOME_COPY.heroCaption} ${photo.name}, ${photo.price}`}
          onPress={onPressPhoto}
          style={({ pressed }) => [s.caption, pressed && s.captionPressed]}
        >
          <Text style={s.captionEyebrow}>{HOME_COPY.heroCaption}</Text>
          <Text style={s.captionName} numberOfLines={1}>{photo.name}</Text>
          <ChevronRight size={16} color={colors.accent} strokeWidth={2} strokeLinecap="round" />
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // Breaks the well's 24pt gutter: a hero photograph with a margin is a
  // picture of food, and one that runs to the edges is the room it is in.
  hero: { marginHorizontal: -space[5] },
  shut: { backgroundColor: heroScrim.shut },

  caption: {
    minHeight: TOUCH_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    paddingHorizontal: space[5],
  },
  captionPressed: { opacity: 0.7 },
  captionEyebrow: {
    ...face('mono'),
    fontSize: type.xs,
    // .12em at 11pt, the same tracking the footer locality takes.
    letterSpacing: 1.32,
    textTransform: 'uppercase',
    color: colors.inkDim,
  },
  // `flexShrink` rather than `flex: 1`: the name gives way to the eyebrow and
  // the chevron on a narrow screen instead of pushing them off the edge, but
  // it does not claim the whole row when it is short.
  captionName: { ...face('display'), fontSize: type.base, color: colors.ink, flexShrink: 1 },
});
