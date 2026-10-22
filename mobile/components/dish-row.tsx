import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TrendingUp } from 'lucide-react-native';
import type { ApiDish } from '@/lib/api';
import { DietMark } from '@/components/diet-mark';
import { DishPhoto } from '@/components/dish-photo';
import { Stepper } from '@/components/stepper';
import { dietMarkFor, mostOrderedLabelFor, spiceWordFor } from '@/lib/format';
import { colors, face, radius, space, tabular, text as type, TOUCH_MIN } from '@/lib/theme';

/**
 * One dish, as a row. Phase 2 drew it; phase 3 moved it out of `menu.tsx`.
 *
 * ─── Why it lives here now ────────────────────────────────────────────────
 *
 * The search tab shows results as dish rows, and the only honest way to do
 * that is the rows the menu already uses. The alternative was a second row
 * component, which is how a product ends up with a stepper that behaves one
 * way in a list and another in a result — and the stepper is the control that
 * spends money.
 *
 * Nothing about the row changed in the move except the badge below. Its
 * reasoning, kept verbatim from the menu:
 *
 * The whole row opens the dish; the stepper does not. On the web that split
 * exists because a button cannot be nested in an anchor — here it is a
 * product decision with the same shape: somebody who wants it the way the
 * chef makes it taps +, and somebody who wants it mild taps the row.
 *
 * Tapping the row raises the SHEET rather than pushing a screen. The list
 * stays behind it, which is the whole argument: choosing a spice level is a
 * step in reading a menu, not a departure from it.
 *
 * ─── The mark goes before the name, where it is read ──────────────────────
 *
 * Every Indian menu puts the veg / non-veg square at the start of the line,
 * and somebody scanning for it is scanning one column rather than reading
 * rows. A dish that declares neither draws nothing at all — see `DietMark`.
 */
export function DishRow({
  dish,
  quantity,
  onAdjust,
  onOpen,
  section,
}: {
  dish: ApiDish;
  quantity: number;
  onAdjust: (direction: 'add' | 'remove') => Promise<void>;
  onOpen: () => void;
  /**
   * Where the dish sits on the menu, shown as an eyebrow over the name.
   *
   * Only search passes it. On the menu the section heading is already three
   * rows up, so repeating it on every card would be noise; in a result list
   * there is no heading at all, and a dish name alone does not say whether
   * it is a starter or a sweet.
   */
  section?: string;
}) {
  const spice = spiceWordFor(dish.spiceLevel);
  const popular = mostOrderedLabelFor(dish.mostOrderedRank);
  /** Asked here rather than inside `DietMark`, because the row above the name
   *  must not be drawn at all when there is nothing to put in it — an empty
   *  View still spends the column's gap. */
  const mark = dietMarkFor(dish.dietaryFlags);

  return (
    <View style={[s.row, !dish.isAvailable && s.rowOff]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          // The badge is said, not drawn, for a screen reader — it is the
          // one thing in the row that a sighted person reads as a
          // recommendation, and leaving it out would make the two versions
          // of the row carry different information.
          `${dish.name}, ${dish.price.text}${popular ? `, ${popular.toLowerCase()}` : ''}`
        }
        onPress={onOpen}
        style={s.rowBody}
      >
        {mark || popular ? (
          <View style={s.marks}>
            <DietMark flags={dish.dietaryFlags} />
            {popular ? <MostOrdered label={popular} /> : null}
          </View>
        ) : null}
        {section ? <Text style={s.sectionEyebrow}>{section}</Text> : null}
        <Text style={s.dishName}>{dish.name}</Text>
        {dish.description ? (
          <Text style={s.dishBlurb} numberOfLines={2}>{dish.description}</Text>
        ) : null}
        <View style={s.dishMeta}>
          <Text style={[s.price, tabular]}>{dish.price.text}</Text>
          {dish.isAvailable ? (
            <>
              {spice ? <Text style={s.tag}>{spice}</Text> : null}
              {dish.prepTimeMinutes ? <Text style={s.tag}>{dish.prepTimeMinutes} min</Text> : null}
            </>
          ) : (
            /* One flag, two causes: the kitchen has 86'd it, or it is outside
               its own hours. "Not available now" is true of both. */
            <Text style={s.soldOut}>Not available now</Text>
          )}
        </View>
      </Pressable>

      {/* Photo and control share a column, the control sitting over the
          photo's lower edge. Without a photograph the column is the control
          alone, exactly as this row shipped. */}
      <View style={dish.imageUrl ? s.media : undefined}>
        {dish.imageUrl ? (
          <DishPhoto uri={dish.imageUrl} blurhash={dish.blurhash} name={dish.name} size={PHOTO} />
        ) : null}
        {/* Only where there is nothing to ask. A dish whose required choice
            has no default sends somebody inside instead. */}
        {dish.isAvailable && dish.canQuickAdd ? (
          <View style={dish.imageUrl ? s.stepperOverPhoto : undefined}>
            <Stepper quantity={quantity} onAdjust={onAdjust} label={dish.name} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * "Most ordered". Phase 3, and the only badge in the app.
 *
 * ─── It is counted, not chosen ────────────────────────────────────────────
 *
 * The server derives it from `order_items` over a window. That is why it is
 * allowed to exist at all: the redesign plan rules out ratings and stars on a
 * single restaurant's own app as decoration that nobody can check, and says
 * the one piece of social proof this product can EARN is how many of a thing
 * the kitchen actually sent out. The app draws what it is told and never
 * decides a dish is popular — see `mostOrderedLabelFor`, which also says why
 * the only two sentences it will print are "Most ordered" and "#2 most
 * ordered".
 *
 * ─── Saffron on a tint, not saffron filled ───────────────────────────────
 *
 * The filled saffron surface in this app means "tap me": the cart pill, the
 * selected section chip, the Add button. A badge is a label and cannot be
 * tapped, so it takes the accent as INK over `accentTint` — the same pairing
 * the stepper's outline uses. A filled one would be a button that does
 * nothing, on a row whose whole left half is already a target.
 *
 * `TrendingUp` and deliberately not `Flame`: a flame on an Indian menu row
 * reads as heat, directly beside a spice word that means it literally.
 */
function MostOrdered({ label }: { label: string }) {
  return (
    <View style={s.badge}>
      <TrendingUp size={BADGE_ICON} color={colors.accent} strokeWidth={2.25} />
      <Text style={s.badgeText}>{label}</Text>
    </View>
  );
}

/** Matches the 11pt label's cap height rather than its line box, so the
 *  arrow sits on the text's shoulder instead of floating above it. */
const BADGE_ICON = 12;

/**
 * 112, up from the 96 this row shipped with.
 *
 * The photographs are the content now rather than a decoration beside it, and
 * 112 is the largest square that leaves a two-line dish name unwrapped at
 * 15pt on a 390pt screen with both gutters. Anything wider starts breaking
 * names across three lines, which costs more vertical space than the picture
 * gains.
 */
const PHOTO = 112;

const s = StyleSheet.create({
  /* Fixed width so every row's text wraps in the same place. A column
     sized to its image makes a list of dishes look like a list of
     different things. */
  media: { width: PHOTO, alignItems: 'center' },
  stepperOverPhoto: { marginTop: -22 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: space[5],
    paddingVertical: space[4],
    minHeight: TOUCH_MIN + space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  rowOff: { opacity: 0.55 },
  rowBody: { flex: 1, gap: space[1] },
  marks: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  /* The same eyebrow the home screen's featured row uses, so a dish looks
     like the same dish wherever it is listed. */
  sectionEyebrow: {
    ...face('mono'),
    fontSize: type.xs,
    letterSpacing: 1.32,
    textTransform: 'uppercase',
    color: colors.accent,
    marginBottom: 2,
  },
  dishName: { ...face('bodyMedium'), fontSize: type.base, color: colors.ink },
  dishBlurb: { ...face('body'), fontSize: type.sm, lineHeight: 19, color: colors.inkDim },
  dishMeta: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[1] },
  price: { ...face('mono'), fontSize: type.base, color: colors.ink },
  tag: { ...face('mono'), fontSize: type.xs, color: colors.inkFaint },
  soldOut: { ...face('body'), fontSize: type.xs, color: colors.critical },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingVertical: 2,
    paddingHorizontal: space[2],
    borderRadius: radius.xs,
    backgroundColor: colors.accentTint,
  },
  badgeText: {
    ...face('bodyMedium'),
    fontSize: type.xs,
    letterSpacing: 0.3,
    color: colors.accent,
  },
});
