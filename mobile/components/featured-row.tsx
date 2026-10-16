import { DishPhoto } from '@/components/dish-photo';
import { DietMark } from '@/components/diet-mark';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Plus } from 'lucide-react-native';
import type { ApiDish } from '@contract';
import { flagChipFor, spiceWordFor } from '@/lib/format';
import { useReducedMotion } from '@/lib/motion';
import {
  colors, duration, face, radius, space, tabular, text as type, TOUCH_MIN,
} from '@/lib/theme';

/**
 * One of the three dishes the home screen opens with. D-080.
 *
 * ─── Why the right-hand control branches on `canQuickAdd` and nothing else ─
 *
 * The designer's note: "+ adds in one tap (canQuickAdd) and shows the
 * quantity; tapping again adds another. Choose opens dish detail because a
 * required modifier exists." The branch is a field the SERVER decided in the
 * menu read — the same rule the web menu follows and the menu screen already
 * obeys. The app never looks at the modifier groups and works it out again:
 * two implementations of "can this be added blind" is one of them being wrong
 * about a dish whose only default option just went unavailable.
 *
 * ─── No image, on purpose ──────────────────────────────────────────────────
 *
 * "The menu is set like a printed card: type, rules and a table of contents
 * carry the page, with no photography." There is no thumbnail slot here and
 * the deferred image work does not add one — it belongs to the dish detail
 * and the menu list.
 */
export function FeaturedRow({
  section,
  dish,
  quantity,
  onAdd,
  onChoose,
}: {
  /** The section this was taken from — "Rajasthani classics". It travels
   *  with the dish from the server, because a dish on three collections has
   *  no single section of its own to look up. */
  section: string;
  dish: ApiDish;
  /** How many are in the cart, summed across variants. */
  quantity: number;
  onAdd: () => Promise<void>;
  onChoose: () => void;
}) {
  // Lifted out of the JSX so the null check narrows inside the bar loop too.
  const spice = dish.spiceLevel;
  const spiceWord = spiceWordFor(spice);
  // `flatMap` rather than `map().filter()`: a flag this app has no chip for
  // drops out without leaving a hole for TypeScript to argue about.
  const chips = dish.dietaryFlags.flatMap((flag) => flagChipFor(flag) ?? []);

  return (
    <View style={s.row}>
      <View style={s.left}>
        <Text style={s.eyebrow}>{section}</Text>
        {/* Phase 2. Over the name, where every Indian menu puts it and where
            the menu rows and the dish screen now put it too. */}
        <DietMark flags={dish.dietaryFlags} />
        <Text style={s.name}>{dish.name}</Text>
        {dish.description ? <Text style={s.description}>{dish.description}</Text> : null}

        <View style={s.meta}>
          <Text style={[s.price, tabular]}>{dish.price.text}</Text>

          {spice !== null && spiceWord ? (
            // One label for the pair. Five unlabelled bars tell a screen
            // reader nothing, and the word alone loses the scale.
            <View
              style={s.spice}
              accessible
              accessibilityLabel={`Spice ${spice} of 5, ${spiceWord}`}
            >
              <View style={s.bars}>
                {[1, 2, 3, 4, 5].map((step) => (
                  <View
                    key={step}
                    style={[s.bar, step <= spice && s.barOn]}
                  />
                ))}
              </View>
              <Text style={s.spiceWord}>{spiceWord}</Text>
            </View>
          ) : null}

          {chips.map((chip) => (
            <View
              key={chip.label}
              style={[s.chip, { borderColor: toneOf(chip.tone) }]}
            >
              <Text style={[s.chipText, { color: toneOf(chip.tone) }]}>{chip.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/*
        Photo with the control laid over its lower edge — the arrangement
        Swiggy and Zomato both use, and they use it because it buys a row of
        vertical space back: the picture and the button occupy the same
        column instead of queueing.

        When there is no photograph the column collapses to just the control,
        which is the layout this screen shipped with. A property that has
        uploaded nothing therefore loses nothing.
      */}
      <View style={dish.imageUrl ? s.media : s.control}>
        {dish.imageUrl ? (
          <DishPhoto uri={dish.imageUrl} blurhash={dish.blurhash} name={dish.name} />
        ) : null}
        <View style={dish.imageUrl ? s.controlOverPhoto : undefined}>
          {dish.canQuickAdd
            ? <QuickAdd dish={dish} quantity={quantity} onAdd={onAdd} />
            : <Choose dish={dish} onPress={onChoose} />}
        </View>
      </View>
    </View>
  );
}

function toneOf(tone: 'positive' | 'secondary'): string {
  return tone === 'positive' ? colors.positive : colors.inkSecondary;
}

/**
 * The + that becomes a count.
 *
 * Two states, one box: an outline with a plus at zero, and a filled saffron
 * square carrying the numeral above it. The fill is the one press-adjacent
 * transition on this screen that is worth 180ms — it is a state change rather
 * than a press, it happens once per dish, and snapping it makes the first add
 * feel like a mis-tap.
 *
 * Taps are SWALLOWED while a request is in flight rather than queued, which is
 * the stepper's rule for the same reason: four overlapping writes against one
 * cart row is a race the UI should not start.
 */
function QuickAdd({
  dish,
  quantity,
  onAdd,
}: {
  dish: ApiDish;
  quantity: number;
  onAdd: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const reduced = useReducedMotion();
  const filled = quantity > 0;

  // Initialised to the CURRENT state, so a row that mounts with three already
  // in the cart appears filled rather than filling itself on arrival.
  const fill = useRef(new Animated.Value(filled ? 1 : 0)).current;

  useEffect(() => {
    const to = filled ? 1 : 0;
    if (reduced) { fill.setValue(to); return; }
    Animated.timing(fill, {
      toValue: to,
      duration: duration.fast,
      useNativeDriver: true,
    }).start();
  }, [filled, reduced, fill]);

  const tap = async () => {
    if (busy) return;
    setBusy(true);
    try { await onAdd(); } finally { setBusy(false); }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={quantity > 0 ? `Add another ${dish.name}` : `Add ${dish.name}`}
      accessibilityValue={quantity > 0 ? { text: `${quantity} in your order` } : undefined}
      disabled={busy}
      onPress={() => void tap()}
      style={({ pressed }) => [s.quickAdd, pressed && !busy && s.quickAddPressed]}
    >
      {({ pressed }) => {
        /*
          The design's hover moves BOTH halves — "background: var(--accent-hover);
          color: var(--accent-ink)" — and only moving the ground is what put
          saffron glyph on lighter saffron ground, which is invisible at roughly
          1.3:1. So the ink follows the ground: once the box is saffron, what is
          drawn on it is the GROUND colour, never another saffron.

          The fill pane has to take the press too. It sits at opacity 1 over the
          Pressable's own background once a dish is in the cart, so without this
          a second tap on a filled button changes nothing at all.
        */
        const hot = pressed && !busy;
        const onSaffron = hot || filled;

        return (
          <>
            {/* A saffron pane faded in over the outline, rather than an
                interpolated background colour: colour interpolation runs on the
                JS thread and passes through a muddy midpoint on the way from
                transparent to saffron. Opacity is native-driven and stays the
                same hue throughout. */}
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                s.quickAddFill,
                hot && s.quickAddFillPressed,
                { opacity: fill },
              ]}
            />
            {busy ? (
              <ActivityIndicator size="small" color={filled ? colors.accentInk : colors.accent} />
            ) : filled ? (
              // The numeral, in the GROUND colour. Text on saffron is never white.
              <Text style={[s.quantity, tabular]} accessibilityLiveRegion="polite">{quantity}</Text>
            ) : (
              <Plus
                size={20}
                color={onSaffron ? colors.accentInk : colors.accent}
                strokeWidth={2}
                strokeLinecap="round"
              />
            )}
          </>
        );
      }}
    </Pressable>
  );
}

/** A required choice with no default the kitchen will make for somebody.
 *  The row sends them inside rather than guessing. */
function Choose({ dish, onPress }: { dish: ApiDish; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Choose options for ${dish.name}`}
      onPress={onPress}
      style={({ pressed }) => [s.choose, pressed && s.choosePressed]}
    >
      <Text style={s.chooseLabel}>Choose</Text>
      <ChevronRight size={16} color={colors.accent} strokeWidth={2} strokeLinecap="round" />
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[4],
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  // `minWidth: 0`'s RN equivalent — without `flex: 1` the long description
  // pushes the control off the right edge instead of wrapping.
  left: { flex: 1, gap: 6 },

  /* The photo column. Fixed width so every row's text wraps at the same
     place — a column that sized itself to its image would make a list of
     dishes look like a list of different things. */
  media: { width: 112, alignItems: 'center' },
  /* Pulled up over the photo's bottom edge, centred on it. */
  controlOverPhoto: { marginTop: -22 },

  eyebrow: {
    ...face('mono'),
    fontSize: type.xs,
    // .12em at 11pt.
    letterSpacing: 1.32,
    textTransform: 'uppercase',
    color: colors.accent,
  },
  name: {
    ...face('display'),
    fontSize: type.xl,
    lineHeight: type.xl * 1.2,
    color: colors.ink,
  },
  description: {
    ...face('body'),
    fontSize: type.base,
    lineHeight: type.base * 1.5,
    color: colors.inkSecondary,
  },

  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[3],
    marginTop: space[1],
  },
  price: { ...face('mono'), fontSize: type.base, color: colors.ink },

  spice: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bars: { flexDirection: 'row', gap: 2 },
  // `lineFaint` is a border and ornament colour. An empty meter bar is exactly
  // that — it is never read as text.
  bar: { width: 3, height: 10, borderRadius: 1, backgroundColor: colors.lineFaint },
  barOn: { backgroundColor: colors.accent },
  spiceWord: {
    ...face('mono'),
    fontSize: type.xs,
    // .08em at 11pt.
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: colors.inkDim,
  },

  chip: {
    borderWidth: 1,
    borderRadius: radius.xs,
    paddingVertical: 1,
    paddingHorizontal: 5,
  },
  chipText: {
    ...face('mono'),
    fontSize: type.xs,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
  },

  control: { paddingTop: 22 },

  quickAdd: {
    width: TOUCH_MIN,
    height: TOUCH_MIN,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    // The animated fill paints inside this, so the box itself stays clear.
    overflow: 'hidden',
  },
  quickAddFill: { backgroundColor: colors.accent, borderRadius: radius.sm },
  // LIGHTER on press. The single most-often-inverted rule in this palette.
  // Both of these, because the fill pane covers the Pressable's own ground
  // whenever the dish is already in the cart.
  quickAddPressed: { backgroundColor: colors.accentHover },
  quickAddFillPressed: { backgroundColor: colors.accentHover },
  quantity: { ...face('mono'), fontSize: type.base, color: colors.accentInk },

  choose: {
    height: TOUCH_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingLeft: space[3],
    paddingRight: space[2],
    borderWidth: 1,
    borderColor: colors.lineFaint,
    borderRadius: radius.sm,
  },
  choosePressed: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  chooseLabel: { ...face('bodyMedium'), fontSize: type.sm, color: colors.accent },
});
