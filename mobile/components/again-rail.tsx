import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ApiDish } from '@contract';
import { DishPhoto } from '@/components/dish-photo';
import { DietMark } from '@/components/diet-mark';
import { Stepper } from '@/components/stepper';
import { colors, face, radius, space, tabular, text as type, TOUCH_MIN } from '@/lib/theme';

/**
 * "Order again" — the dishes somebody has actually eaten. Phase 2.
 *
 * ─── Every dish on it is a fact, and none of it is a recommendation ───────
 *
 * The ids come from `GET /orders/again`, which reads `order_items` for the
 * orders that were DELIVERED — this visit's, or the signed-in account's
 * across visits, the same branch the reorder block makes (D-081). The dish
 * itself comes from the menu the screen is already holding, so the price, the
 * photograph and whether it can be added blind are the menu's answers and
 * not a second copy of them.
 *
 * What is deliberately absent: an order count, a "you love this" badge, a
 * rank. Counting three chais into "your favourite" is the kind of invented
 * confidence the plan argues against, and the honest version of it —
 * "most ordered this week", across everybody — is phase 3 and is a different
 * claim.
 *
 * ─── Why it is a rail and the reorder block is a row ──────────────────────
 *
 * They answer different questions. "Same as last time" repeats a whole
 * ORDER, in one tap, and is a row because there is one of it. This is a
 * shelf of individual dishes to build a new order out of, so it scrolls.
 * Both are drawn only when the server offered something.
 */
export function AgainRail({
  dishes,
  quantities,
  onAdjust,
  onOpen,
}: {
  /** In the order the server gave them — most recently eaten first. */
  dishes: ApiDish[];
  /** How many of each are in the cart, summed across variants. */
  quantities: ReadonlyMap<string, number>;
  onAdjust: (menuItemId: string, direction: 'add' | 'remove') => Promise<void>;
  onOpen: (menuItemId: string) => void;
}) {
  if (!dishes.length) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={s.rail}
      contentContainerStyle={s.contents}
    >
      {dishes.map((dish) => (
        <View key={dish.id} style={s.card}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${dish.name}, ${dish.price.text}`}
            onPress={() => onOpen(dish.id)}
            style={({ pressed }) => [s.body, pressed && s.pressed]}
          >
            {dish.imageUrl ? (
              <DishPhoto
                uri={dish.imageUrl}
                blurhash={dish.blurhash}
                name={dish.name}
                width={CARD}
                height={PHOTO_H}
              />
            ) : (
              <View style={s.noPhoto} />
            )}

            <View style={s.line}>
              <DietMark flags={dish.dietaryFlags} size={12} />
              <Text style={s.name} numberOfLines={2}>{dish.name}</Text>
            </View>
            <Text style={[s.price, tabular]}>{dish.price.text}</Text>
          </Pressable>

          {/* INSIDE the photograph's lower corner rather than straddling its
              edge, which is where the menu row puts it. The card is 136 wide
              and the name sits directly under the picture — a control hanging
              over that edge lands on the dish's own name. */}
          {dish.canQuickAdd ? (
            <View style={s.control}>
              <Stepper
                quantity={quantities.get(dish.id) ?? 0}
                onAdjust={(direction) => onAdjust(dish.id, direction)}
                label={dish.name}
              />
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

/** Wide enough for two lines of a long dish name at 13pt, narrow enough that
 *  the third card is visibly cut on a 390pt screen. */
const CARD = 136;
const PHOTO_H = 104;

const s = StyleSheet.create({
  rail: { marginHorizontal: -space[5] },
  contents: { paddingHorizontal: space[5], gap: space[3], paddingTop: space[3] },

  card: { width: CARD },
  body: { gap: space[2] },
  pressed: { opacity: 0.7 },

  noPhoto: {
    width: CARD,
    height: PHOTO_H,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },

  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  // `flex: 1` is RN's `min-width: 0` — without it a long name pushes the mark
  // out of the card rather than wrapping beside it.
  name: { ...face('body'), flex: 1, fontSize: type.sm, lineHeight: type.sm * 1.3, color: colors.ink },
  price: { ...face('mono'), fontSize: type.sm, color: colors.inkSecondary },

  // Inset from both edges of the photograph, so its saffron border is never
  // flush with the photograph's own.
  control: { position: 'absolute', right: space[1], top: PHOTO_H - TOUCH_MIN - space[1] },
});
