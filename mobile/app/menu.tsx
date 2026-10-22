import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, View,
  type ViewToken,
} from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CookingPot, SlidersHorizontal } from 'lucide-react-native';
import * as api from '@/lib/api';
import type { ApiDish, ApiMenu } from '@/lib/api';
import { useApiFailure, useSession, type Failure } from '@/lib/session';
import { Screen } from '@/components/ui';
import { ListState } from '@/components/state';
import { CartPill } from '@/components/cart-pill';
import { DishRow } from '@/components/dish-row';
import { DishSheet, type DishSheetHandle } from '@/components/dish-sheet';
import { FilterChips, FilterSummary } from '@/components/filter-chips';
import { MenuSkeleton } from '@/components/skeleton';
import { NO_FILTERS, hasFilters, matchesFilters, type DishFilters } from '@/lib/filters';
import {
  colors, face, radius, space, text as type, TOUCH_MIN,
} from '@/lib/theme';

/**
 * The menu. D-080, and the screen this app is for.
 *
 * A `SectionList` rather than a `ScrollView` of mapped sections: a menu is
 * tens of dishes and a restaurant with a long one would mount every row on
 * first render. The section rail above it scrolls the list rather than the
 * list scrolling the rail, which is the direction people expect.
 *
 * ─── What phase 2 changed ─────────────────────────────────────────────────
 *
 * The rail now TRACKS: scrolling the list moves the highlight and brings the
 * chip into view, so the rail says where you are as well as taking you
 * somewhere. The rows carry a photograph and the veg / non-veg mark, which
 * is a legal convention here and not an ornament (see `DietMark`).
 *
 * ─── What phase 3 changed ─────────────────────────────────────────────────
 *
 * A second rail, of filter chips, under the section one — and the row moved
 * out to `components/dish-row.tsx`, because search draws the same rows and a
 * second copy of the stepper is a second opinion about the cart.
 *
 * The filtering here is done in the CLIENT, where the search tab asks the
 * server. That is not an inconsistency: this screen is already holding every
 * dish, and a round trip to re-select from a list in memory would be slower
 * and could disagree with what is on screen. `lib/filters.ts` is the single
 * rule both screens apply, which is what keeps a chip meaning one thing.
 */
interface MenuSection {
  id: string;
  title: string;
  blurb: string | null;
  data: ApiDish[];
}

export default function Menu() {
  /** Set by a contents row or a category circle on the home screen — the
   *  section to open at. */
  const { section: anchor } = useLocalSearchParams<{ section?: string }>();
  const { session, cart, counts, adjust, refreshCart } = useSession();
  const failureOf = useApiFailure();
  const [menu, setMenu] = useState<ApiMenu | null>(null);
  /** What stopped the menu arriving, with its kind — offline and refused are
   *  drawn differently and say different things. Null while it is fine. */
  const [failure, setFailure] = useState<Failure | null>(null);
  /** Bumped by the error state's own button. The effect below is keyed on it,
   *  so "Try again" is a re-run of the first load rather than a second code
   *  path that could fetch differently. */
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  /** Veg, heat, price. Deliberately NOT in the URL: a filtered menu is a
   *  reading position rather than a place, and a link to one would restore
   *  somebody to a card with most of the dishes missing. */
  const [filters, setFilters] = useState<DishFilters>(NO_FILTERS);
  const insets = useSafeAreaInsets();
  /** The dish sheet, opened by a row. See `components/dish-sheet.tsx` for why
   *  it is a child of this screen rather than a modal above the navigator. */
  const sheet = useRef<DishSheetHandle>(null);
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
  /**
   * The section a jump is on its way to, until it gets there.
   *
   * It does two jobs, and both are bugs it was written for. It is what
   * `onScrollToIndexFailed` retries — a `scrollToLocation` into a section
   * whose rows have not been measured simply does not happen, which is how a
   * deep link from the home screen landed on section one. And it is what
   * stops the scroll reports below from overwriting the highlight on the way:
   * a jump passes over every section between here and there, and each one of
   * them reports itself as it goes.
   */
  const pending = useRef<{ id: string; index: number; tries: number } | null>(null);
  /**
   * Where every chip is, measured.
   *
   * A ref and not state: it is written during layout and read by a scroll
   * handler, and nothing renders differently because of it. Keeping it in
   * state would re-render the whole list on every chip that measures itself.
   */
  const chipX = useRef(new Map<string, number>());
  /** Which section the list is showing, or null before the first scroll. */
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await api.getMenu();
        if (cancelled) return;
        setMenu(loaded);
        setFailure(null);
      } catch (thrown) {
        if (!cancelled) setFailure(failureOf(thrown));
      }
    })();
    return () => { cancelled = true; };
  }, [failureOf, attempt]);

  /**
   * Pull to refresh.
   *
   * What it is actually for on this screen: a dish that sold out while
   * somebody was reading, and a kitchen that closed. Both are server state
   * that nothing pushes, and both are things people instinctively pull for —
   * the alternative today is leaving the screen and coming back, because the
   * focus effect is the only thing that re-reads.
   *
   * The cart comes with it. They are one read as far as anybody pulling is
   * concerned, and a menu refreshed against stale quantities would show a
   * dish as not in the cart that is.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [loaded] = await Promise.all([api.getMenu(), refreshCart()]);
      setMenu(loaded);
      setFailure(null);
    } catch (thrown) {
      setFailure(failureOf(thrown));
    } finally {
      setRefreshing(false);
    }
  }, [failureOf, refreshCart]);

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
  const jumpTo = useCallback((id: string, index: number) => {
    pending.current = { id, index, tries: 0 };
    setActive(id);
    list.current?.scrollToLocation({ sectionIndex: index, itemIndex: 0, viewPosition: 0 });
  }, []);

  useEffect(() => {
    if (!menu || !anchor || jumped.current) return;

    const index = menu.sections
      .filter((section) => section.items.length > 0)
      .findIndex((section) => section.id === anchor);
    if (index < 0) return;

    jumped.current = true;
    jumpTo(anchor, index);
  }, [menu, anchor, jumpTo]);

  /**
   * Keep the highlighted chip on screen.
   *
   * `space[5]` back from the chip's own left edge, so it lands inside the
   * gutter rather than flush against the screen. Silent when the chip has not
   * been measured yet — which is the first commit, and is exactly the case
   * the anchored chip's own `onLayout` below handles instead.
   */
  useEffect(() => {
    if (!active) return;
    const x = chipX.current.get(active);
    if (x === undefined) return;
    rail.current?.scrollTo({ x: Math.max(0, x - space[5]), animated: true });
  }, [active]);

  /**
   * What the list is showing, read off the rows themselves.
   *
   * `onViewableItemsChanged` has to be a stable reference — React Native
   * throws outright if it changes between renders — so it is a ref holding a
   * closure over `setActive` and nothing else. The topmost viewable row wins:
   * a section header and its first dish are both visible at a section
   * boundary, and the one nearer the top is the one somebody is reading.
   *
   * Scroll offsets are deliberately not computed here. A row's height depends
   * on whether a dish has a description and whether that description wraps,
   * so any arithmetic over an assumed row height is wrong on the fourth
   * section of a real menu.
   */
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const top = viewableItems.find((token) => token.isViewable && token.section);
    const id = (top?.section as MenuSection | undefined)?.id;
    if (!id) return;

    // A jump in flight owns the highlight until it arrives. See `pending`.
    if (pending.current) {
      if (pending.current.id !== id) return;
      pending.current = null;
    }
    setActive(id);
  });
  /**
   * 60%, not the usual 50.
   *
   * The topmost viewable row wins, and these rows are 112pt of photograph
   * tall — at 20% the last dish of the previous section kept the highlight
   * while two whole sections of the next one were on screen. 60% is "most of
   * this row is in front of you", which is the thing being asked.
   */
  const viewability = useRef({ itemVisiblePercentThreshold: 60 });

  /*
    The counts and the write both come from the session now.

    They used to be a `useMemo` over `cart.lines` and a local `adjust` here,
    and the same pair again in search and on the home screen — three sums of
    one cart and three opinions about what a tap does. The optimistic half
    cannot be duplicated three times and stay consistent, so it is not: see
    `lib/session.tsx`, where a tap moves the count before the server answers
    and a refusal rolls it back with a sentence attached.
  */

  if (failure && !menu) {
    return (
      <Screen>
        <Stack.Screen options={{ title: session?.property.name ?? 'Menu' }} />
        <ListState
          tone={failure.kind}
          title={failure.kind === 'offline' ? 'The menu did not load' : 'The menu is not available'}
          body={failure.kind === 'offline'
            ? 'You are not reaching the kitchen. Check your signal, then try again.'
            : 'The kitchen gave a reason for this.'}
          message={failure.kind === 'refused' ? failure.message : undefined}
          actionLabel="Try again"
          onAction={() => setAttempt((n) => n + 1)}
        />
      </Screen>
    );
  }
  // In the shape of the menu rather than a spinner: the outlet bar, the
  // section rail and five dish rows, so nothing moves when they arrive.
  if (!menu || !session) return <Screen><MenuSkeleton /></Screen>;

  /**
   * The sections, with the chips applied.
   *
   * A section whose every dish was filtered out is dropped rather than left
   * as an empty heading — and it leaves the RAIL too, so the rail and the
   * list always agree about what is on this screen. The indices the rail
   * jumps with are this array's, so they stay correct by construction.
   */
  const sections: MenuSection[] = menu.sections
    .map((section) => ({
      id: section.id,
      title: section.title,
      blurb: section.blurb,
      data: section.items.filter((dish) => matchesFilters(dish, filters)),
    }))
    .filter((section) => section.data.length > 0);

  /** Dishes, not rows: one dish on three collections is one thing to eat,
   *  and the summary line under the chips says how many there are. */
  const shown = new Set(sections.flatMap((section) => section.data.map((dish) => dish.id))).size;

  /** Before the first scroll report, the list is showing its first section. */
  const current = active ?? sections[0]?.id ?? null;

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

      {/* Fixed above the list rather than scrolled with it: this is the only
          thing on the screen that says where you are in a menu long enough to
          lose your place in. */}
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
          {sections.map((section, index) => {
            const on = section.id === current;
            return (
              <Pressable
                key={section.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                // Every chip records where it is; the anchored one also brings
                // itself into view the moment it knows, so a deep link from
                // the home screen arrives with the rail already tracking
                // rather than parked on section one.
                onLayout={(event) => {
                  const { x } = event.nativeEvent.layout;
                  chipX.current.set(section.id, x);
                  if (section.id !== anchor || railJumped.current) return;
                  railJumped.current = true;
                  rail.current?.scrollTo({ x: Math.max(0, x - space[5]), animated: false });
                }}
                onPress={() => jumpTo(section.id, index)}
                style={({ pressed }) => [
                  s.chip,
                  on && s.chipOn,
                  // Saffron goes LIGHTER on press in this theme, and an
                  // unselected chip lifts to `raised` — the two press states
                  // are different surfaces, not one opacity.
                  pressed && (on ? s.chipOnPressed : s.chipPressed),
                ]}
              >
                {/* On saffron, the ink is the GROUND. Never white, and never
                    another saffron. */}
                <Text style={[s.chipText, on && s.chipTextOn]}>{section.title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Its own row under the section rail, and the one that carries the
          divider — two hairlines across a header this tall reads as two
          headers. */}
      <View style={s.filterBar}>
        <FilterChips filters={filters} onChange={setFilters} />
      </View>

      <SectionList
        ref={list}
        sections={sections}
        keyExtractor={(dish, index) => `${dish.id}-${index}`}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        onViewableItemsChanged={onViewable.current}
        viewabilityConfig={viewability.current}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            // iOS reads `tintColor`, Android `colors` and the ring's ground.
            // Left to the platform defaults it is a black spinner on an
            // indigo screen.
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.card}
          />
        )}
        /*
          `scrollToLocation` into a section whose rows have not been measured
          cannot land, and RN hands it back here rather than throwing. An
          empty handler is what shipped, and it is why a deep link from the
          home screen arrived at section one: the jump was swallowed in
          silence on the one render it mattered.

          So it retries on the next frames, up to five of them. Five is the
          ceiling rather than a loop because the other way for this to fire
          is a target that genuinely is not there, and a retry that never
          stops is a list that scrolls by itself forever.
        */
        onScrollToIndexFailed={() => {
          const target = pending.current;
          if (!target || target.tries >= 5) return;
          target.tries += 1;
          setTimeout(() => {
            if (pending.current !== target) return;
            list.current?.scrollToLocation({
              sectionIndex: target.index,
              itemIndex: 0,
              viewPosition: 0,
            });
          }, 80);
        }}
        ListHeaderComponent={<FilterSummary filters={filters} count={shown} />}
        /*
          Two ways to be empty, and they are not the same thing.

          Chips lit: the filters did it, and the button undoes them. No chips:
          the outlet is genuinely showing nothing today — which used to be
          unreachable, because the comment here assumed the screen above
          handled it, and the screen above only handles a FAILED read. A menu
          that loads with no dishes in it fell through to a blank list.
        */
        ListEmptyComponent={hasFilters(filters) ? (
          <ListState
            tone="empty"
            icon={SlidersHorizontal}
            fill={false}
            title="Nothing matches those filters"
            body="Clear one and the dishes come back."
            actionLabel="Clear the filters"
            onAction={() => setFilters(NO_FILTERS)}
          />
        ) : (
          <ListState
            tone="empty"
            icon={CookingPot}
            fill={false}
            title="Nothing on the menu today"
            body="The kitchen has not put anything out. Pull down to look again."
          />
        )}
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>{section.title}</Text>
            {section.blurb ? <Text style={s.sectionBlurb}>{section.blurb}</Text> : null}
          </View>
        )}
        renderItem={({ item: dish }) => (
          <DishRow
            dish={dish}
            quantity={counts.get(dish.id) ?? 0}
            onAdjust={(direction) => adjust(dish.id, direction)}
            onOpen={() => sheet.current?.open(dish.id)}
          />
        )}
      />

      {cart && cart.itemCount > 0 ? (
        <CartPill cart={cart} bottom={insets.bottom + space[4]} />
      ) : null}

      {/* LAST, so it draws over the cart pill rather than under it. */}
      <DishSheet ref={sheet} />
    </Screen>
  );
}

const s = StyleSheet.create({
  headerLink: { ...face('bodyMedium'), fontSize: type.base, color: colors.accent },

  bar: {
    paddingHorizontal: space[5],
    paddingBottom: space[3],
    gap: space[1],
  },
  filterBar: { borderBottomWidth: 1, borderBottomColor: colors.line },
  where: { ...face('body'), fontSize: type.sm, color: colors.inkDim },
  hours: { ...face('body'), fontSize: type.sm, color: colors.positive },
  rail: { gap: space[2], paddingTop: space[3] },
  chip: {
    minHeight: TOUCH_MIN - space[2],
    justifyContent: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipPressed: { backgroundColor: colors.raised },
  chipOnPressed: { backgroundColor: colors.accentHover },
  chipText: { ...face('body'), fontSize: type.sm, color: colors.ink },
  chipTextOn: { ...face('bodyMedium'), color: colors.accentInk },

  sectionHead: { paddingHorizontal: space[5], paddingTop: space[5], paddingBottom: space[2] },
  sectionTitle: { ...face('display'), fontSize: type.xl, color: colors.ink },
  sectionBlurb: {
    ...face('body'),
    fontSize: type.sm,
    lineHeight: type.sm * 1.45,
    color: colors.inkDim,
    marginTop: space[1],
  },

});
