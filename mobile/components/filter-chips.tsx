import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, X } from 'lucide-react-native';
import {
  FILTER_CHIPS, activeFilterCount, isChipOn, toggleChip,
  type DishFilters,
} from '@/lib/filters';
import { colors, face, radius, space, tabular, text as type, TOUCH_MIN } from '@/lib/theme';

/**
 * Veg, heat, price — the rail. Phase 3 of the redesign.
 *
 * ─── Outlined, where the section rail is filled ───────────────────────────
 *
 * The menu already has a horizontal rail of saffron chips directly above
 * this one, and two rails that look identical would be two controls that
 * appear to do the same thing. So the two selected states are different
 * surfaces on purpose:
 *
 *   · the SECTION chip fills with saffron — it says where you are, and
 *     tapping it takes you somewhere
 *   · a FILTER chip takes saffron as ink over `accentTint` with a saffron
 *     border and a tick — it says what you asked for, and tapping it undoes
 *     the asking
 *
 * The tick is not decoration either: an unselected chip and a selected one
 * must differ by more than colour for somebody who cannot tell saffron from
 * the card it sits on.
 *
 * ─── The count, and one tap to clear ──────────────────────────────────────
 *
 * The clear control is FIRST in the rail rather than last, and it is the
 * reason the rail is not simply a row of chips. Filters that are scrolled
 * off the right of a 390pt screen are filters somebody has forgotten they
 * set — "3" in the corner of a result list that looks short is the only
 * thing that explains the shortness, and it has to be where the rail starts
 * rather than where it ends.
 *
 * ─── 40 tall, 48 to the thumb ─────────────────────────────────────────────
 *
 * The chip matches the section rail's height, which is `TOUCH_MIN - space[2]`
 * — stacking two 48pt rails above a menu costs a dish row of vertical space.
 * The `hitSlop` puts the four points back on each edge, so the TARGET is 48
 * even though the paint is 40. That is the rule's own distinction: it is
 * about what a thumb can hit, not about how much ink is used saying so.
 */
export function FilterChips({
  filters,
  onChange,
}: {
  filters: DishFilters;
  onChange: (next: DishFilters) => void;
}) {
  const active = activeFilterCount(filters);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.rail}
      // Without this the rail swallows a horizontal drag that began on a
      // chip, and a chip is the easiest thing in the rail to start a scroll
      // on.
      keyboardShouldPersistTaps="handled"
    >
      {active > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear ${active} ${active === 1 ? 'filter' : 'filters'}`}
          hitSlop={{ top: space[1], bottom: space[1] }}
          onPress={() => onChange({ diet: [], spiceMax: null, priceMaxMinor: null })}
          style={({ pressed }) => [s.chip, s.clear, pressed && s.clearPressed]}
        >
          <X size={ICON} color={colors.ink} strokeWidth={2} />
          <Text style={s.clearText}>Clear</Text>
          <Text style={[s.count, tabular]}>{active}</Text>
        </Pressable>
      ) : null}

      {FILTER_CHIPS.map((chip) => {
        const on = isChipOn(filters, chip);
        return (
          <Pressable
            key={chip.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={chip.label}
            hitSlop={{ top: space[1], bottom: space[1] }}
            onPress={() => onChange(toggleChip(filters, chip))}
            style={({ pressed }) => [
              s.chip,
              on && s.chipOn,
              // Saffron goes LIGHTER in this theme and an unselected chip
              // lifts to `raised`: two different surfaces, not one opacity.
              pressed && (on ? s.chipOnPressed : s.chipPressed),
            ]}
          >
            {on ? <Check size={ICON} color={colors.accent} strokeWidth={2.5} /> : null}
            <Text style={[s.chipText, on && s.chipTextOn]}>{chip.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** The 13pt chip label's cap height, so the tick sits on its shoulder. */
const ICON = 13;

/**
 * A line reading "3 filters · 4 dishes", for above a filtered list.
 *
 * Separate from the rail because the two belong in different places on the
 * two screens that use them, and because it is the SENTENCE rather than the
 * control: the rail can be scrolled away from the clear button, and this
 * cannot be scrolled away from at all.
 */
export function FilterSummary({ filters, count }: { filters: DishFilters; count: number }) {
  const active = activeFilterCount(filters);
  if (active === 0) return null;

  return (
    <View style={s.summary}>
      <Text style={s.summaryText}>
        <Text style={tabular}>{active}</Text>
        {active === 1 ? ' filter · ' : ' filters · '}
        <Text style={tabular}>{count}</Text>
        {count === 1 ? ' dish' : ' dishes'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  rail: { gap: space[2], paddingHorizontal: space[5], paddingVertical: space[2] },

  chip: {
    minHeight: TOUCH_MIN - space[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.accentTint, borderColor: colors.accent },
  chipPressed: { backgroundColor: colors.raised },
  chipOnPressed: { backgroundColor: colors.raised, borderColor: colors.accentHover },
  chipText: { ...face('body'), fontSize: type.sm, color: colors.ink },
  chipTextOn: { ...face('bodyMedium'), color: colors.accent },

  clear: { borderColor: colors.lineFaint, backgroundColor: colors.raised },
  clearPressed: { backgroundColor: colors.card },
  clearText: { ...face('bodyMedium'), fontSize: type.sm, color: colors.ink },
  count: {
    minWidth: 18,
    textAlign: 'center',
    ...face('monoMedium'),
    fontSize: type.xs,
    color: colors.accentInk,
    backgroundColor: colors.accent,
    borderRadius: radius.xs,
    paddingVertical: 1,
    overflow: 'hidden',
  },

  summary: { paddingHorizontal: space[5], paddingBottom: space[2] },
  summaryText: { ...face('body'), fontSize: type.sm, color: colors.inkDim },
});
