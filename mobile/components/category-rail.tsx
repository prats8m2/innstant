import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ApiMenuSection } from '@contract';
import { DishPhoto } from '@/components/dish-photo';
import { colors, face, space, text as type } from '@/lib/theme';

/**
 * The sections, as photographs. Phase 2 of the redesign.
 *
 * ─── Where the picture comes from ─────────────────────────────────────────
 *
 * A dish in the section. There is no section image in the schema and this
 * redesign adds no migration, so the alternative was a column nobody has
 * filled in or a stock photograph of "Drinks" — and the honest answer is
 * already in the payload: a section's own dishes ARE what is in it.
 *
 * Not simply the first one, because the sections overlap: laal maas is on the
 * rooftop collection, the chef's table and the chef's specials, so the first
 * three circles were the same photograph three times. Each section takes the
 * first of its dishes nobody to its left has used, and falls back to its own
 * first when every one of them is spoken for — a repeat beats a blank, and a
 * section of two dishes that both appear earlier has nothing else to show.
 *
 * A section whose dishes have no photographs falls back to its initial, set
 * in the display face on a card ground. Not an icon: there is no icon set
 * that covers "Chef Bhairav's table", and guessing one per section is the
 * mistake D-073 cost two rounds of work.
 *
 * ─── Circles, on an app with 3px corners ──────────────────────────────────
 *
 * The sharp radius is the brand (D-050) and this deliberately does not use
 * it. A circle is not a softened rectangle — it is a different shape, it is
 * what this component is called in every app that has one, and the account
 * corner on the same screen is already a disc. Everything that is a SURFACE
 * here still takes `radius`.
 *
 * ─── It is navigation, so it says how much is behind it ───────────────────
 *
 * The count under each label is the same figure the contents list prints
 * further down the screen, and both come off `section.items.length`. The rail
 * is the quick jump for somebody who knows what they want; the contents list
 * is the printed card, with the blurbs. They lead to the same place on
 * purpose.
 */
export function CategoryRail({
  sections,
  onPick,
}: {
  /** Already filtered to the ones with something in them. */
  sections: ApiMenuSection[];
  onPick: (sectionId: string) => void;
}) {
  if (!sections.length) return null;

  /** Which photographs this rail has already spent, left to right. Rebuilt on
   *  every render, which is correct: it is a property of this one pass over
   *  this one list, not state. */
  const used = new Set<string>();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // The rail runs off both edges of the screen while its first and last
      // chips sit inside the gutter — a rail that stops at the margin reads
      // as a row that happens to be too wide.
      style={s.rail}
      contentContainerStyle={s.contents}
      accessibilityLabel="Menu sections"
    >
      {sections.map((section) => {
        const photo = section.items.find((dish) => dish.imageUrl && !used.has(dish.id))
          ?? section.items.find((dish) => dish.imageUrl);
        if (photo) used.add(photo.id);
        return (
          <Pressable
            key={section.id}
            accessibilityRole="button"
            accessibilityLabel={`${section.label}, ${section.items.length} dishes`}
            onPress={() => onPick(section.id)}
            style={({ pressed }) => [s.cell, pressed && s.pressed]}
          >
            {photo?.imageUrl ? (
              <View style={s.circle}>
                <DishPhoto
                  uri={photo.imageUrl}
                  blurhash={photo.blurhash}
                  name={section.label}
                  width="100%"
                  height="100%"
                  bleed
                />
              </View>
            ) : (
              <View style={[s.circle, s.initialCircle]}>
                <Text style={s.initial}>{section.label.slice(0, 1)}</Text>
              </View>
            )}

            {/* Two lines' worth of box whether or not the second one is
                used, so the circles above sit on one baseline rather than
                stepping down wherever a label wraps. The COUNT lives on the
                contents list further down the screen; a figure under every
                circle turned a row of photographs into a table. */}
            <Text style={s.label} numberOfLines={2}>{section.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** 72 across, which fits four and a bit on a 390pt screen — the half-cell is
 *  what says the rail continues. */
const CIRCLE = 72;

/** One line of the label. Two of them are reserved under every circle. */
const LABEL_LINE = Math.round(type.xs * 1.35);

const s = StyleSheet.create({
  rail: { marginHorizontal: -space[5] },
  contents: { paddingHorizontal: space[5], gap: space[4] },

  cell: { width: CIRCLE + space[2], alignItems: 'center', gap: space[2] },
  pressed: { opacity: 0.7 },

  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.lineFaint,
    backgroundColor: colors.card,
  },
  initialCircle: { alignItems: 'center', justifyContent: 'center' },
  initial: { ...face('display'), fontSize: type.xl, color: colors.accent },

  label: {
    ...face('body'),
    fontSize: type.xs,
    lineHeight: LABEL_LINE,
    height: LABEL_LINE * 2,
    color: colors.inkSecondary,
    textAlign: 'center',
  },
});
