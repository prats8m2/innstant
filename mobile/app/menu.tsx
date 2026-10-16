import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable, ScrollView, SectionList, StyleSheet, Text, View,
} from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as api from '@/lib/api';
import type { ApiDish, ApiMenu } from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { Loading, Notice, Screen } from '@/components/ui';
import { Stepper } from '@/components/stepper';
import { DishPhoto } from '@/components/dish-photo';
import { colors, radius, space, text as type, tabular, TOUCH_MIN } from '@/lib/theme';

/**
 * The menu. D-080, and the screen this app is for.
 *
 * A `SectionList` rather than a `ScrollView` of mapped sections: a menu is
 * tens of dishes and a restaurant with a long one would mount every row on
 * first render. The section rail above it scrolls the list rather than the
 * list scrolling the rail, which is the direction people expect.
 */
interface MenuSection {
  id: string;
  title: string;
  blurb: string | null;
  data: ApiDish[];
}

export default function Menu() {
  /** Set by a contents row on the home screen — the section to open at. */
  const { section: anchor } = useLocalSearchParams<{ section?: string }>();
  const { session, cart, setCart, refreshCart } = useSession();
  const onError = useApiError();
  const [menu, setMenu] = useState<ApiMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  /** The section shape the list renders — `blurb` included, or the header
   *  cannot read it. */
  const list = useRef<SectionList<ApiDish, MenuSection>>(null);
  /**
   * The rail, and the one chip that has to be brought into view.
   *
   * The designer's note on the contents rows is specific: a row deep-links the
   * menu "scrolled to that section with the rail already tracking" — not a
   * frame later. The rail cannot be scrolled to a chip that has not been laid
   * out, and `onLayout` fires AFTER the native layout pass — which is after
   * every effect on the commit that first rendered the chips. So the jump is
   * made by the anchored chip itself, from its own `onLayout`, rather than by
   * an effect reading measurements that do not exist yet.
   */
  const rail = useRef<ScrollView>(null);
  /** One rail jump per arrival, for the same reason as `jumped` below. */
  const railJumped = useRef(false);
  /** One jump per arrival. Without it, every re-render of a focused screen
   *  would yank somebody back to the anchor they have since scrolled past. */
  const jumped = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await api.getMenu();
        if (!cancelled) setMenu(loaded);
      } catch (failure) {
        if (!cancelled) setError(onError(failure));
      }
    })();
    return () => { cancelled = true; };
  }, [onError]);

  /**
   * The cart, re-read whenever this screen comes back into focus.
   *
   * Popping back from the dish screen or dismissing the cart sheet both land
   * here, and both can have changed the counts on every card. The shared cart
   * is updated by those screens directly — this is the backstop for the case
   * they cannot cover: an order placed, which empties the cart server-side.
   */
  useFocusEffect(useCallback(() => { void refreshCart(); }, [refreshCart]));

  /**
   * Arrive at the section the home screen asked for.
   *
   * It runs once the menu is in hand, because neither the list nor the rail
   * can be scrolled to a section that has not been laid out. `scrollToLocation`
   * on a list of variable-height rows lands approximately and settles, which
   * is the right behaviour for a jump to a section head.
   */
  useEffect(() => {
    if (!menu || !anchor || jumped.current) return;

    const index = menu.sections
      .filter((section) => section.items.length > 0)
      .findIndex((section) => section.id === anchor);
    if (index < 0) return;

    jumped.current = true;
    list.current?.scrollToLocation({ sectionIndex: index, itemIndex: 0, viewPosition: 0 });
  }, [menu, anchor]);

  /** How many of each dish are in the cart, summed ACROSS variants. */
  const inCart = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of cart?.lines ?? []) {
      counts.set(line.menuItemId, (counts.get(line.menuItemId) ?? 0) + line.quantity);
    }
    return counts;
  }, [cart]);

  const adjust = useCallback(async (menuItemId: string, direction: 'add' | 'remove') => {
    try {
      setCart(await api.quickAdjust({ menuItemId, direction }));
      setError(null);
    } catch (failure) {
      // "That dish is off the menu tonight" is the kitchen's answer and worth
      // showing; a dead session is a navigation and shows nothing.
      setError(onError(failure));
    }
  }, [setCart, onError]);

  if (error && !menu) return <Screen style={s.center}><Notice>{error}</Notice></Screen>;
  if (!menu || !session) return <Loading label="Loading the menu" />;

  const sections: MenuSection[] = menu.sections
    .filter((section) => section.items.length > 0)
    .map((section) => ({
      id: section.id,
      title: section.title,
      blurb: section.blurb,
      data: section.items,
    }));

  /** Where this order is going, said once under the title. */
  const where = session.visit.tableLabel
    ?? (session.visit.fulfilment === 'DELIVERY' ? 'Delivery' : 'Takeaway');

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: session.property.name,
          /*
            No `headerLeft` override any more, so the NATIVE back button is
            here — and it goes to the home screen, which is what pushed this
            one. A custom left slot replaces that button, which is how the menu
            ended up with no way back at all once it stopped being the first
            screen.
          */
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/scan')}
              hitSlop={12}
              accessibilityLabel="Scan the code on your table"
              // The padding is load-bearing: without it the label sits flush
              // against the screen edge and is clipped on a 390px viewport.
              style={{ paddingHorizontal: space[2] }}
            >
              {/* The WORD, not a glyph. This was U+2317 (⌗), which is not in
                  Roboto and has no Android fallback — an unlabelled tofu box,
                  and the only entry to the scanner in the app. D-073's lesson,
                  one surface over: do not pick a codepoint and hope.

                  It moved from the left slot to this one when home took over
                  the landing: the account is a 48pt corner on that screen now,
                  one tap back, and the scanner has nowhere else to live. */}
              <Text style={s.headerLink}>Scan</Text>
            </Pressable>
          ),
        }}
      />

      <View style={s.bar}>
        <Text style={s.where}>
          {menu.outlet.name} · {where}
        </Text>
        <Text style={[s.hours, !menu.outlet.isOpen && { color: colors.critical }]}>
          {menu.outlet.openLine}
        </Text>

        <ScrollView
          ref={rail}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.rail}
        >
          {sections.map((section, index) => (
            <Pressable
              key={section.id}
              // The anchored chip brings itself into view the moment it knows
              // where it is, so a deep link from the home screen's contents
              // list arrives with the rail already tracking rather than with
              // it parked on section one. `space[5]` back from the chip's own
              // edge, so it sits inside the gutter rather than flush against
              // the screen edge.
              onLayout={(event) => {
                if (section.id !== anchor || railJumped.current) return;
                railJumped.current = true;
                const { x } = event.nativeEvent.layout;
                rail.current?.scrollTo({ x: Math.max(0, x - space[5]), animated: false });
              }}
              onPress={() => list.current?.scrollToLocation({
                sectionIndex: index,
                itemIndex: 0,
                viewPosition: 0,
              })}
              style={({ pressed }) => [s.chip, pressed && { backgroundColor: colors.raised }]}
            >
              <Text style={s.chipText}>{section.title}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <SectionList
        ref={list}
        sections={sections}
        keyExtractor={(dish, index) => `${dish.id}-${index}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        // `scrollToLocation` on a list with variable row heights throws
        // without this when the target has not been measured yet. The rail is
        // the only caller and it jumps to a section head, so an approximation
        // that lands slightly off and settles is right.
        onScrollToIndexFailed={() => {}}
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>{section.title}</Text>
            {section.blurb ? <Text style={s.sectionBlurb}>{section.blurb}</Text> : null}
          </View>
        )}
        renderItem={({ item: dish }) => (
          <DishRow
            dish={dish}
            quantity={inCart.get(dish.id) ?? 0}
            onAdjust={(direction) => adjust(dish.id, direction)}
          />
        )}
      />

      {error ? <View style={s.floatingError}><Notice>{error}</Notice></View> : null}

      {cart && cart.itemCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/cart')}
          style={({ pressed }) => [
            s.pill,
            { bottom: insets.bottom + space[4] },
            pressed && { backgroundColor: colors.accentHover },
          ]}
        >
          <Text style={[s.pillCount, tabular]}>{cart.itemCount}</Text>
          <Text style={s.pillLabel}>Review order</Text>
          <Text style={[s.pillTotal, tabular]}>{cart.totals.total.text}</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}

/**
 * One dish.
 *
 * The whole row opens the dish; the stepper does not. On the web that split
 * exists because a button cannot be nested in an anchor — here it is a product
 * decision with the same shape: somebody who wants it the way the chef makes
 * it taps +, and somebody who wants it mild taps the row.
 */
function DishRow({
  dish,
  quantity,
  onAdjust,
}: {
  dish: ApiDish;
  quantity: number;
  onAdjust: (direction: 'add' | 'remove') => Promise<void>;
}) {
  return (
    <View style={[s.row, !dish.isAvailable && s.rowOff]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${dish.name}, ${dish.price.text}`}
        onPress={() => router.push(`/dish/${dish.id}`)}
        style={s.rowBody}
      >
        <Text style={s.dishName}>{dish.name}</Text>
        {dish.description ? (
          <Text style={s.dishBlurb} numberOfLines={2}>{dish.description}</Text>
        ) : null}
        <View style={s.dishMeta}>
          <Text style={[s.price, tabular]}>{dish.price.text}</Text>
          {dish.isAvailable ? (
            dish.prepTimeMinutes ? <Text style={s.tag}>{dish.prepTimeMinutes} min</Text> : null
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
          <DishPhoto uri={dish.imageUrl} blurhash={dish.blurhash} name={dish.name} size={96} />
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

const s = StyleSheet.create({
  /* Fixed width so every row's text wraps in the same place. A column
     sized to its image makes a list of dishes look like a list of
     different things. */
  media: { width: 96, alignItems: 'center' },
  stepperOverPhoto: { marginTop: -20 },

  center: { justifyContent: 'center', padding: space[5] },
  headerLink: { fontSize: type.base, color: colors.accent, fontWeight: '600' },

  bar: {
    paddingHorizontal: space[5],
    paddingBottom: space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    gap: space[1],
  },
  where: { fontSize: type.sm, color: colors.inkDim },
  hours: { fontSize: type.sm, color: colors.positive },
  rail: { gap: space[2], paddingTop: space[3] },
  chip: {
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  chipText: { fontSize: type.sm, color: colors.ink },

  sectionHead: { paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[2] },
  sectionTitle: { fontSize: type.lg, fontWeight: '600', color: colors.ink },
  sectionBlurb: { fontSize: type.sm, lineHeight: 20, color: colors.inkDim, marginTop: space[1] },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    minHeight: TOUCH_MIN + space[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  rowOff: { opacity: 0.55 },
  rowBody: { flex: 1, gap: 2 },
  dishName: { fontSize: type.base, fontWeight: '600', color: colors.ink },
  dishBlurb: { fontSize: type.sm, lineHeight: 19, color: colors.inkDim },
  dishMeta: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[1] },
  price: { fontSize: type.base, color: colors.ink },
  tag: { fontSize: type.xs, color: colors.inkFaint },
  soldOut: { fontSize: type.xs, color: colors.critical },

  floatingError: { position: 'absolute', left: space[5], right: space[5], bottom: 110 },

  pill: {
    position: 'absolute',
    left: space[5],
    right: space[5],
    minHeight: TOUCH_MIN + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  pillCount: {
    minWidth: 26,
    textAlign: 'center',
    fontSize: type.sm,
    fontWeight: '700',
    color: colors.accent,
    backgroundColor: colors.accentInk,
    borderRadius: radius.xs,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  pillLabel: { flex: 1, fontSize: type.base, fontWeight: '700', color: colors.accentInk },
  pillTotal: { fontSize: type.base, fontWeight: '700', color: colors.accentInk },
});
