import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Moon, User } from 'lucide-react-native';
import * as api from '@/lib/api';
import type { ApiMenu, ApiOrderSummary, ApiReorder } from '@/lib/api';
import { useApiError, useSession } from '@/lib/session';
import { Notice, Screen } from '@/components/ui';
import { HomeSkeleton } from '@/components/skeleton';
import { Arch } from '@/components/arch';
import { StatusStrip } from '@/components/status-strip';
import { FeaturedRow } from '@/components/featured-row';
import { ContentsRow } from '@/components/contents-row';
import { LiveOrderCard } from '@/components/live-order-card';
import { ReorderRow } from '@/components/reorder-row';
import { HomeBottomBar } from '@/components/home-bottom-bar';
import { DishSheet, type DishSheetHandle } from '@/components/dish-sheet';
import { tapAdd } from '@/lib/haptics';
import { HOME_COPY } from '@/lib/copy';
import { distinctDishCount, greetingFor, initialOf, padCount, toRoman } from '@/lib/format';
import {
  colors, face, radius, space, text as type, TOUCH_MIN,
} from '@/lib/theme';

/**
 * The storefront. D-080, and now the app's first screen.
 *
 * ─── What it is for ────────────────────────────────────────────────────────
 *
 * The menu screen is a list; this is the page in front of it. It says whether
 * the kitchen is cooking, offers three dishes worth starting with, and prints
 * the menu's table of contents — set like a printed card, with type and rules
 * carrying the page and no photography anywhere on it. That last part is a
 * decision rather than an omission: there is no image slot here for a later
 * session to fill, and the hero is drawn from borders for the same reason.
 *
 * ─── Three states, composed rather than switched ───────────────────────────
 *
 * The design draws three — signed out and open, returning with a live order,
 * and kitchen closed — but they are not three screens. They are three
 * independent facts, and all eight combinations happen:
 *
 *   · `outlet.isOpen` decides the arch's weight, the status strip's first
 *     column, whether there is a featured strip at all, and whether the bottom
 *     bar is filled or outlined. When nothing can be cooked tonight there is
 *     nothing to recommend for tonight, so the strip goes and the contents
 *     list moves up to take its place. What it does NOT decide is where the
 *     bar goes: a cart filled while the kitchen is shut still has a cart
 *     button, because adding stays open and only placing waits (#9).
 *   · A LIVE ORDER replaces the arch with its card. The design ties this to
 *     being signed in, but a visit's own order is live for an anonymous
 *     customer too, and showing them the arch while their food is on the stove
 *     would be the app knowing something and not saying it.
 *   · `customer` turns the account corner into an initial and adds the
 *     greeting. It is a CORNER and never a gate (#9): no state on this screen
 *     puts a sign-in in front of the menu. It also decides whose history the
 *     order card and the reorder block read — the account's across visits, or
 *     this visit's own (D-081).
 *   · A REORDER is offered when the server says the whole of somebody's last
 *     delivered order can go back in a cart today. It is independent of the
 *     other three: an anonymous visit with a delivered order gets it, and a
 *     signed-in customer whose last order had a dish since taken off the menu
 *     does not. The decision is not made here — see `ApiReorder`.
 *
 * ─── Every figure on it is derived ─────────────────────────────────────────
 *
 * "10 dishes" is the number of DISTINCT dishes in the payload, not the number
 * of rows the sections add up to — the live menu is ten dishes across
 * seventeen section appearances, and counting appearances would be the app
 * reading its own layout back to somebody. (The design prints 17 because its
 * own fixture has each dish in exactly one section; against the real menu that
 * same rule gives 10, and 10 is the number of things there are to eat.) Money
 * is never touched: every ₹ figure is an `ApiMoney.text` rendered verbatim
 * (#5), and the one clock time on the screen is the server's `opensAt`.
 */

/**
 * 30 seconds, where the tracking screen uses 5.
 *
 * This is a card somebody glances at on the way past, not the screen they are
 * watching their food on. A tap on it opens the one that polls properly.
 */
const POLL_MS = 30_000;

/** Scroll clearance under the sticky bar: its 56pt button, 32 above it, 20
 *  below, and 28 of slack so the last footer line is not flush to the fade. */
const BAR_CLEARANCE = 136;

export default function Home() {
  const { session, customer, isCustomerLoading, cart, setCart, refreshCart } = useSession();
  const onError = useApiError();
  const insets = useSafeAreaInsets();

  const [menu, setMenu] = useState<ApiMenu | null>(null);
  const [orders, setOrders] = useState<ApiOrderSummary[] | null>(null);
  const [reorder, setReorder] = useState<ApiReorder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** The same sheet the menu raises. A featured dish with a required choice
   *  opens it here rather than pushing the screen, so the two entries into
   *  the same decision look the same. */
  const sheet = useRef<DishSheetHandle>(null);

  /** Whose orders this screen is showing — the account's across visits, or
   *  this visit's own (D-081). The poll and the pull both read through it so
   *  the branch is made in one place. */
  const fetchOrders = useCallback(() => (
    customer ? api.listAccountOrders() : api.listOrders()
  ), [customer]);

  /**
   * The menu and the cart, re-read whenever this screen comes back.
   *
   * On focus rather than on an interval: a kitchen that closes, a dish that
   * runs out and a cart emptied by a placed order all show up the moment
   * somebody navigates back, and none of them is worth a timer.
   */
  useFocusEffect(useCallback(() => {
    let cancelled = false;

    (async () => {
      try {
        const loaded = await api.getMenu();
        if (!cancelled) { setMenu(loaded); setError(null); }
      } catch (failure) {
        if (!cancelled) setError(onError(failure));
      }
    })();

    void refreshCart();

    return () => { cancelled = true; };
  }, [onError, refreshCart]));

  /**
   * Live orders, polled while there is one and only while this screen is on
   * top of the stack and the app is in the foreground.
   *
   * The four locals are the tracking screen's pattern, and they are the fix
   * for two bugs it had: `paused` is consulted by `arm()` rather than inferred
   * from whether a timer id exists, and `inFlight` makes `read()` idempotent
   * against a foreground event arriving mid-request. Without either,
   * backgrounding during a read resumes a poll that never stops, and
   * foregrounding during one starts a second chain that halves the interval
   * every cycle.
   *
   * It polls the LIST rather than the order: `/orders` is the only endpoint
   * that carries the card's shape — the status label, the headline, the ETA
   * and the step index, all composed by the same functions the tracking screen
   * uses — and it is one request either way.
   */
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let paused = false;
    let inFlight = false;
    /** Stops on its own once nothing is cooking. An app that kept asking would
     *  drain a battery to learn nothing. */
    let live = true;

    const arm = () => {
      if (cancelled || paused || !live) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void read(); }, POLL_MS);
    };

    const read = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const loaded = await fetchOrders();
        if (cancelled) return;
        setOrders(loaded);
        live = loaded.some((order) => order.isLive);
      } catch (failure) {
        if (cancelled) return;
        /*
          A failed read here must never blank the screen. The menu is the
          point of this page and a missing order card is a missing ornament —
          so a 401 still navigates (that is what `onError` does) and anything
          else is swallowed unless there is nothing to show at all.
        */
        if (failure instanceof api.ApiFailure && failure.isSessionGone) onError(failure);
      } finally {
        inFlight = false;
        arm();
      }
    };

    void read();

    const sub = AppState.addEventListener('change', (state) => {
      if (cancelled) return;
      if (state === 'active') {
        paused = false;
        if (timer) clearTimeout(timer);
        void read();
      } else {
        paused = true;
        if (timer) clearTimeout(timer);
        timer = undefined;
      }
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [fetchOrders, onError]));

  /**
   * "Same as last time", re-asked whenever this screen comes back.
   *
   * On focus rather than on the poll above: the answer changes when an order
   * is DELIVERED and when a dish goes off the menu, neither of which is worth
   * a timer, and both of which are true again by the time somebody navigates
   * back. `customer` is a dependency because it decides WHOSE last order this
   * is — the account's across visits, or this visit's own (D-081).
   *
   * A failure here is swallowed for the same reason the order card's is: the
   * menu is the point of this page, and a missing block is a missing
   * ornament. A 401 still navigates, which is what `onError` does.
   */
  useFocusEffect(useCallback(() => {
    let cancelled = false;

    (async () => {
      try {
        const suggestion = await api.getReorder();
        if (!cancelled) setReorder(suggestion.reorder);
      } catch (failure) {
        if (cancelled) return;
        if (failure instanceof api.ApiFailure && failure.isSessionGone) onError(failure);
        else setReorder(null);
      }
    })();

    return () => { cancelled = true; };
  }, [customer, onError]));

  /** How many of each dish are in the cart, summed ACROSS variants — the same
   *  shape the menu screen's cards read. */
  const inCart = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of cart?.lines ?? []) {
      counts.set(line.menuItemId, (counts.get(line.menuItemId) ?? 0) + line.quantity);
    }
    return counts;
  }, [cart]);

  /**
   * Everything on the page, re-read at once.
   *
   * `allSettled` rather than `all`, and only the MENU's failure is shown.
   * The three reads have the same standing here as they do in the focus
   * effects above: the menu is what this page is, and the order card and the
   * reorder block are ornaments. A failed reorder read must not throw away a
   * menu that arrived, and must not put a red notice over a screen whose
   * content is fine.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    const [loadedMenu, loadedOrders, suggestion] = await Promise.allSettled([
      api.getMenu(),
      fetchOrders(),
      api.getReorder(),
    ]);
    void refreshCart();

    if (loadedMenu.status === 'fulfilled') {
      setMenu(loadedMenu.value);
      setError(null);
    } else {
      setError(onError(loadedMenu.reason));
    }
    if (loadedOrders.status === 'fulfilled') setOrders(loadedOrders.value);
    if (suggestion.status === 'fulfilled') setReorder(suggestion.value.reorder);

    setRefreshing(false);
  }, [fetchOrders, onError, refreshCart]);

  const add = useCallback(async (menuItemId: string) => {
    try {
      setCart(await api.quickAdjust({ menuItemId, direction: 'add' }));
      // After the round trip, not on the tap: it means the dish is in the
      // cart, not that the button was pressed.
      tapAdd();
      setError(null);
    } catch (failure) {
      // "That dish is off the menu tonight" is the kitchen's sentence and is
      // worth showing. A dead session navigates and shows nothing.
      setError(onError(failure));
    }
  }, [setCart, onError]);

  /**
   * The repeat, then the cart.
   *
   * The server returns the whole cart, so the shared copy is replaced by one
   * assignment rather than a refetch — and the cart screen it opens onto is
   * already holding the new lines. A refusal (a dish gone off between the
   * offer and the tap) is the kitchen's own sentence and is worth showing;
   * the block then goes, because the thing it was offering no longer exists.
   */
  const repeat = async (orderId: string) => {
    try {
      const result = await api.reorder(orderId);
      setCart(result.cart);
      // A whole order went into the cart. That is the same event as an add
      // and gets the same tap, not a louder one.
      tapAdd();
      setError(null);
      router.push('/cart');
    } catch (failure) {
      setError(onError(failure));
      setReorder(null);
    }
  };

  if (error && !menu) return <Screen style={s.center}><Notice>{error}</Notice></Screen>;
  // The storefront's own shape — well, status strip, three featured rows and
  // the contents list — rather than a spinner on an empty ground.
  if (!menu || !session) return <Screen><HomeSkeleton /></Screen>;

  const outlet = menu.outlet;
  const open = outlet.isOpen;

  /** Sections with nothing in them are not a line of the contents list. */
  const sections = menu.sections.filter((section) => section.items.length > 0);
  const dishCount = distinctDishCount(sections);

  /** The list arrives newest first, so the first live row is the current one. */
  const liveOrder = orders?.find((order) => order.isLive) ?? null;
  const showFeatured = open && menu.featured.length > 0;
  const initial = customer ? initialOf(customer.name) : '';

  return (
    <Screen>
      {/* It draws its own 64pt top row, so there is no header to style. */}
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: BAR_CLEARANCE + insets.bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            // The spinner lands on the hero well, which is the darkest
            // surface in the app — hence the explicit colours. Left to the
            // platform it is a black ring on near-black.
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.card}
          />
        )}
      >
        {/* The hero well — the only surface in the app darker than the ground. */}
        <View
          style={[
            s.well,
            { paddingTop: insets.top },
            // The live card carries its own 16pt of padding, so the well
            // closes tighter under it than under the arch.
            liveOrder ? s.wellWithCard : s.wellWithArch,
          ]}
        >
          <View style={s.topRow}>
            <Text style={s.wordmark}>{session.property.name}</Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={customer ? `Account, signed in as ${customer.name}` : 'Account'}
              onPress={() => router.push('/account')}
              // Optically trimmed back to the 24pt gutter: a 48pt hit area
              // around a 22pt icon otherwise sits a quarter-inch inside it.
              style={[s.corner, { marginRight: initial ? -space[2] : -space[3] }]}
            >
              {initial ? (
                <View style={s.avatar}><Text style={s.avatarText}>{initial}</Text></View>
              ) : (
                <User size={22} color={colors.inkSecondary} strokeWidth={1.75} strokeLinecap="round" />
              )}
            </Pressable>
          </View>

          {liveOrder ? (
            <LiveOrderCard
              order={liveOrder}
              timezone={session.property.timezone}
              onPress={() => router.push(`/order/${liveOrder.id}`)}
            />
          ) : (
            <>
              <Arch
                eyebrow={HOME_COPY.heroEyebrow}
                headline={open ? HOME_COPY.heroHeadlineOpen : HOME_COPY.heroHeadlineClosed}
                dimmed={!open}
              />
              {/* Full bleed: it breaks the gutter so the rule runs edge to
                  edge under the arch's open feet. Dropped under the live card,
                  which is a closed box and needs no line to stand on. */}
              <View style={s.hairline} />
            </>
          )}

          <StatusStrip outlet={outlet} />
        </View>

        <View style={s.body}>
          {error ? <View style={s.error}><Notice>{error}</Notice></View> : null}

          {customer ? (
            <Text style={s.greeting}>
              {greetingFor(new Date(), session.property.timezone)}, {customer.name.split(' ')[0]}.
            </Text>
          ) : null}

          {!open ? (
            <View style={s.closed}>
              <Moon
                size={20}
                color={colors.accent}
                strokeWidth={1.75}
                strokeLinecap="round"
                // Optically aligned to the first line of text rather than the
                // top of the box.
                style={s.closedIcon}
              />
              <View style={s.closedCopy}>
                <Text style={s.cardTitle}>{HOME_COPY.closedTitle}</Text>
                {/* #9, in one sentence: only PLACEMENT waits, and it waits on
                    the cart screen. Nothing here stops being tappable. */}
                <Text style={s.cardBody}>{HOME_COPY.closedBody}</Text>
              </View>
            </View>
          ) : null}

          {/* Between the greeting and the featured header, where the design
              puts it. Drawn only when the server offered one — "hidden if any
              line is now unavailable" is decided where the menu is, so there
              is no unavailable-dish branch on this screen. */}
          {reorder ? (
            <ReorderRow reorder={reorder} onReorder={() => repeat(reorder.orderId)} />
          ) : null}

          {showFeatured ? (
            <View style={s.block}>
              <View style={s.blockHead}>
                <Text style={s.blockTitle}>{HOME_COPY.featuredTitle}</Text>
                <Text style={s.blockEyebrow}>{HOME_COPY.featuredEyebrow}</Text>
              </View>

              {menu.featured.map((entry) => (
                <FeaturedRow
                  key={entry.dish.id}
                  section={entry.section}
                  dish={entry.dish}
                  quantity={inCart.get(entry.dish.id) ?? 0}
                  onAdd={() => add(entry.dish.id)}
                  onChoose={() => sheet.current?.open(entry.dish.id)}
                />
              ))}
            </View>
          ) : null}

          <View style={[s.block, showFeatured && s.blockFar]}>
            <View style={s.blockHead}>
              <Text style={s.blockTitle}>{HOME_COPY.contentsTitle}</Text>
              <Text style={s.blockEyebrow}>
                {dishCount} {dishCount === 1 ? 'dish' : 'dishes'}
              </Text>
            </View>

            {sections.map((section, index) => (
              <ContentsRow
                key={section.id}
                numeral={toRoman(index + 1)}
                // `label`, not `title`: the contents list is a column of short
                // forms — "Rooftop", "Chef Bhairav" — and the full titles
                // ("From the rooftop", "Chef Bhairav's table") are what
                // `railLabel()` exists upstream to shorten.
                title={section.label}
                blurb={section.blurb}
                count={padCount(section.items.length)}
                // The rail on the menu is already scrolled to this label when
                // it arrives, rather than a frame later.
                onPress={() => router.push({ pathname: '/menu', params: { section: section.id } })}
              />
            ))}
          </View>

          {/* Only while signed out — and only once that is KNOWN.
              `customer === null` is also what "the identity has not come back
              yet" looks like, and the card is addressed to somebody with no
              account: showing it for the length of a round trip tells a
              signed-in person they have none, then takes it back. #9 is not
              at stake either way (nothing here is a gate, and the menu is
              already on screen) — this is about not saying a false thing for
              400ms. A statement, not a control; it is not tappable. */}
          {customer || isCustomerLoading ? null : (
            <View style={s.note}>
              <Text style={s.cardTitle}>{HOME_COPY.noAccountTitle}</Text>
              <Text style={s.cardBody}>{HOME_COPY.noAccountBody}</Text>
            </View>
          )}

          <View style={s.footer}>
            <Text style={s.footerLocality}>{HOME_COPY.footerLocality}</Text>
            <Text style={s.footerLine}>{HOME_COPY.footerFulfilment}</Text>
          </View>
        </View>
      </ScrollView>

      <HomeBottomBar
        cart={cart}
        isOpen={open}
        dishCount={dishCount}
        opensAt={outlet.opensAt}
        onBrowse={() => router.push('/menu')}
        onCart={() => router.push('/cart')}
      />

      {/* LAST, so it draws over the sticky bar rather than under it. */}
      <DishSheet ref={sheet} />
    </Screen>
  );
}

const s = StyleSheet.create({
  center: { justifyContent: 'center', padding: space[5] },

  well: { backgroundColor: colors.paperDeep, paddingHorizontal: space[5] },
  wellWithArch: { paddingBottom: space[6] },
  wellWithCard: { paddingBottom: space[5] },

  topRow: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: {
    ...face('display'),
    fontSize: type.base,
    // .24em at 15pt — the widest tracking on the screen, and the thing that
    // makes four words read as a wordmark rather than as a sentence.
    letterSpacing: 3.6,
    textTransform: 'uppercase',
    color: colors.ink,
  },
  corner: {
    width: TOUCH_MIN,
    height: TOUCH_MIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.lineFaint,
  },
  avatarText: { ...face('display'), fontSize: type.base, color: colors.ink },

  hairline: {
    height: 1,
    backgroundColor: colors.lineFaint,
    marginHorizontal: -space[5],
  },

  body: { paddingHorizontal: space[5] },
  error: { marginTop: space[5] },

  greeting: {
    ...face('display'),
    fontSize: type.xxl,
    lineHeight: type.xxl * 1.15,
    color: colors.ink,
    marginTop: space[6],
  },

  closed: {
    // 24 rather than the 32 the other blocks take: the notice belongs to the
    // status strip above it, which has just said the kitchen is shut.
    marginTop: space[5],
    flexDirection: 'row',
    gap: space[3],
    padding: space[4],
    backgroundColor: colors.card,
    borderRadius: radius.sm,
  },
  closedIcon: { marginTop: 2 },
  closedCopy: { flex: 1, gap: space[1] },

  block: { marginTop: space[6] },
  // 48 under a featured strip, 32 under anything else: the gap says which
  // block the contents list belongs under.
  blockFar: { marginTop: space[7] },
  blockHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingBottom: space[3],
    // The HEAVY rule. `line` — the lighter one — separates repeating rows
    // below it. Reversing the two flattens the hierarchy.
    borderBottomWidth: 1,
    borderBottomColor: colors.lineFaint,
  },
  blockTitle: { ...face('display'), fontSize: type.xl, color: colors.ink },
  blockEyebrow: {
    ...face('mono'),
    fontSize: type.xs,
    // .1em at 11pt.
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.inkDim,
  },

  note: {
    marginTop: space[6],
    padding: space[4],
    gap: space[1],
    backgroundColor: colors.card,
    borderRadius: radius.sm,
  },
  cardTitle: { ...face('bodyMedium'), fontSize: type.base, color: colors.ink },
  cardBody: {
    ...face('body'),
    fontSize: type.sm,
    lineHeight: type.sm * 1.5,
    color: colors.inkSecondary,
  },

  footer: { marginTop: space[6], gap: space[1] },
  footerLocality: {
    ...face('mono'),
    fontSize: type.xs,
    // .12em at 11pt.
    letterSpacing: 1.32,
    textTransform: 'uppercase',
    color: colors.inkDim,
  },
  footerLine: { ...face('body'), fontSize: type.sm, color: colors.inkDim },
});
