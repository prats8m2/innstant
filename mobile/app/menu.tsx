import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable, ScrollView, SectionList, StyleSheet, Text, View,
} from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as api from '@/lib/api';
import type { ApiDish, ApiMenu } from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { Loading, Notice, Screen } from '@/components/ui';
import { Stepper } from '@/components/stepper';
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
  const { session, cart, setCart, refreshCart } = useSession();
  const onError = useApiError();
  const [menu, setMenu] = useState<ApiMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  /** The section shape the list renders — `blurb` included, or the header
   *  cannot read it. */
  const list = useRef<SectionList<ApiDish, MenuSection>>(null);

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
            Scan is HERE because the boot screen stopped being a screen anybody
            sees (D-080): the app opens its own restaurant and lands on this
            menu. Somebody who sits down at a table and wants their order to go
            to that table needs a way to say so, and this is the only screen
            they are reliably on.
          */
          headerLeft: () => (
            <Pressable
              onPress={() => router.push('/scan')}
              hitSlop={12}
              accessibilityLabel="Scan the code on your table"
              style={{ paddingHorizontal: space[2] }}
            >
              {/* The WORD, not a glyph. This was U+2317 (⌗), which is not in
                  Roboto and has no Android fallback — an unlabelled tofu box
                  next to the word "Orders", and the only entry to the scanner
                  in the app. D-073's lesson, one surface over: do not pick a
                  codepoint and hope. */}
              <Text style={s.headerLink}>Scan</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/orders')}
              hitSlop={12}
              // The padding is load-bearing: without it the label sits flush
              // against the screen edge and is clipped on a 390px viewport.
              style={{ paddingHorizontal: space[2] }}
            >
              <Text style={s.headerLink}>Orders</Text>
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
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.rail}
        >
          {sections.map((section, index) => (
            <Pressable
              key={section.id}
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

      {/* Only where there is nothing to ask. A dish whose required choice has
          no default sends somebody inside instead. */}
      {dish.isAvailable && dish.canQuickAdd ? (
        <Stepper quantity={quantity} onAdjust={onAdjust} label={dish.name} />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
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
