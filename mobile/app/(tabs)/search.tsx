import type { ApiMenuSearch } from '@contract';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, Search as SearchIcon, SearchX, X } from 'lucide-react-native';
import * as api from '@/lib/api';
import { useApiFailure, useSession, type Failure } from '@/lib/session';
import { Screen } from '@/components/ui';
import { ListState } from '@/components/state';
import { CartPill } from '@/components/cart-pill';
import { DishRow } from '@/components/dish-row';
import { DishSheet, type DishSheetHandle } from '@/components/dish-sheet';
import { FilterChips, FilterSummary } from '@/components/filter-chips';
import { ResultsSkeleton } from '@/components/skeleton';
import { SEARCH_COPY } from '@/lib/copy';
import { NO_FILTERS, filterParams, hasFilters, type DishFilters } from '@/lib/filters';
import { clearRecents, forgetSearch, readRecents, rememberSearch } from '@/lib/recents';
import {
  colors, face, radius, space, TAB_BAR_H, text as type, TOUCH_MIN,
} from '@/lib/theme';

/**
 * Search. Phase 3 of the redesign, and the fourth tab.
 *
 * ─── Why it is a tab now, when phase 1 argued it should not be ────────────
 *
 * The tab layout's own note said search belonged here and was deliberately
 * absent, because searching a menu properly needs an endpoint — ten dishes
 * filter fine in the client, sixty do not, and a tab that only worked on the
 * demo menu would be a promise we would then have to keep. The endpoint is
 * the thing phase 3 built, so the reason has gone and the tab is here.
 *
 * ─── The server does the matching, on every keystroke that settles ────────
 *
 * Nothing on this screen filters an array. `api.searchMenu` sends the term
 * AND the chips, and what comes back is drawn — which is what makes it still
 * correct on a menu this app has never seen. The menu screen does filter in
 * the client, and the reason that is not an inconsistency is in
 * `lib/filters.ts`: it already holds every dish, and the chips mean the same
 * thing in both places by construction.
 *
 * ─── Four states, and the fourth is the one people get wrong ──────────────
 *
 *   · IDLE — nothing typed, no chip lit. Recent searches if there are any,
 *     and an invitation if there are not.
 *   · WORKING — a request in flight. Dish-row skeletons, in the shape of the
 *     rows that are coming.
 *   · RESULTS — the rows, with the same stepper the menu has.
 *   · NOTHING MATCHED — a distinct state, not an empty list. It quotes the
 *     term back and, when chips are lit, says that they may be the reason.
 *     A blank screen under a search box is indistinguishable from one that
 *     is still loading, which is how somebody concludes the app is broken.
 */

/**
 * 250ms after the last keystroke.
 *
 * Not a motion token and deliberately not from `duration`: nothing animates
 * here, and the thing being tuned is a network request. Below about 200 a
 * fast typist fires a request per letter; above about 350 the list visibly
 * lags the field. 250 is inside both, and a settled term is still a request
 * rather than a submit — somebody who types "kach" and stops has asked a
 * question without pressing anything.
 *
 * Chips do NOT wait for it. A tap is a finished thought, and debouncing a
 * single discrete tap only delays it.
 */
const DEBOUNCE_MS = 250;

export default function Search() {
  const { cart, counts, adjust, refreshCart } = useSession();
  const failureOf = useApiFailure();
  const insets = useSafeAreaInsets();
  const field = useRef<TextInput>(null);
  const sheet = useRef<DishSheetHandle>(null);

  const [term, setTerm] = useState('');
  const [filters, setFilters] = useState<DishFilters>(NO_FILTERS);
  /** Null means "nothing asked yet or a request is in flight" — the screen
   *  distinguishes the two with `asked`, below. */
  /*
   * The whole response, not just the rows. The server echoes back what it
   * actually applied and how many dishes the outlet shows in total, and the
   * empty state is much better for having the second: "nothing matched among
   * 10 dishes" is a different sentence from "nothing matched", and only one
   * of them reassures somebody that the kitchen has food.
   */
  const [found, setFound] = useState<ApiMenuSearch | null>(null);
  const results = found?.results ?? null;
  /** What stopped the answer arriving, with its kind. Offline and refused get
   *  different words and a different icon — see `ListState`. */
  const [failure, setFailure] = useState<Failure | null>(null);
  /** Bumped by the failed state's button. The request effect is keyed on it,
   *  so "Try again" re-runs the same search rather than being a second path
   *  that could ask a different question. */
  const [attempt, setAttempt] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);

  const query = term.trim();
  /** Is there a question on the screen at all? A lit chip is one on its own:
   *  "what is veg and under ₹600" needs no words. */
  const asked = query.length > 0 || hasFilters(filters);

  useEffect(() => { void readRecents().then(setRecents); }, []);

  // The cart can have been emptied by an order placed on another tab, and
  // every row here draws a count from it.
  useFocusEffect(useCallback(() => { void refreshCart(); }, [refreshCart]));

  /**
   * Ask the server, once the typing has settled.
   *
   * The cleanup does both jobs: it cancels a timer that has not fired, and
   * it marks an in-flight request stale so a slow answer to "kach" cannot
   * land on top of a fast answer to "kachori". Without the second half, the
   * list shows whichever request the network happened to finish last.
   */
  useEffect(() => {
    if (!asked) {
      setFound(null);
      setFailure(null);
      return;
    }

    let cancelled = false;
    setFound(null);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const answer = await api.searchMenu(query, filterParams(filters));
          if (cancelled) return;
          setFound(answer);
          setFailure(null);
        } catch (thrown) {
          if (cancelled) return;
          // An empty list and a failed request are different things and must
          // not look the same — `results` stays null so the "nothing matched"
          // state cannot claim the menu has nothing in it when the truth is
          // that the kitchen could not be reached.
          setFailure(failureOf(thrown));
        }
      })();
    }, DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [asked, query, filters, failureOf, attempt]);

  /* The counts and the write are the session's — the same optimistic cart the
     menu's rows read, so a dish added here and a dish added there behave
     identically and there is one place a refusal is handled. */

  /**
   * What counts as a search worth remembering.
   *
   * Not every settled keystroke: debouncing "kachori" still passes through
   * "kach" if somebody pauses, and a recents list full of prefixes is a list
   * nobody taps. It is remembered when somebody COMMITS — the keyboard's
   * search key, or opening a dish out of the results, which is the clearest
   * possible signal that the search found what it was for.
   */
  const remember = useCallback((value: string) => {
    void rememberSearch(value).then(setRecents);
  }, []);

  const runRecent = useCallback((value: string) => {
    setTerm(value);
    remember(value);
    field.current?.focus();
  }, [remember]);

  const bottom = insets.bottom + TAB_BAR_H + space[3];

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Search' }} />

      <View style={[s.head, { paddingTop: insets.top + space[3] }]}>
        <View style={s.field}>
          <SearchIcon size={18} color={colors.inkFaint} strokeWidth={2} />
          <TextInput
            ref={field}
            value={term}
            onChangeText={setTerm}
            placeholder={SEARCH_COPY.placeholder}
            placeholderTextColor={colors.inkFaint}
            // Dish names are proper nouns in two scripts and nobody wants
            // "Laal Maas" autocorrected to "Lanl Mass".
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            // `selectionColor` is the caret as well as the selection, and
            // the platform default is blue on both.
            selectionColor={colors.accent}
            onSubmitEditing={() => { if (query) remember(query); Keyboard.dismiss(); }}
            style={s.input}
            accessibilityLabel={SEARCH_COPY.placeholder}
          />
          {term.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear the search"
              onPress={() => { setTerm(''); field.current?.focus(); }}
              hitSlop={space[2]}
              style={({ pressed }) => [s.clear, pressed && { backgroundColor: colors.raised }]}
            >
              <X size={16} color={colors.ink} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>

        <FilterChips filters={filters} onChange={setFilters} />
      </View>

      {!asked ? (
        <Idle recents={recents} onPick={runRecent} onForget={setRecents} />
      ) : failure ? (
        /* The search itself failed. Drawn as its own state rather than as a
           notice above an empty list, which is the shape that made a dead
           network look like a menu with nothing in it. */
        <ListState
          tone={failure.kind}
          title={failure.kind === 'offline' ? 'The search did not reach us' : 'The search did not run'}
          body={failure.kind === 'offline'
            ? 'Check your signal. The menu tab still has everything that loaded earlier.'
            : undefined}
          message={failure.kind === 'refused' ? failure.message : undefined}
          actionLabel="Try again"
          onAction={() => setAttempt((n) => n + 1)}
        />
      ) : results === null ? (
        <ResultsSkeleton />
      ) : results.length === 0 ? (
        <Nothing term={query} filtered={hasFilters(filters)} outOf={found?.totalDishes ?? 0} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(result) => result.dish.id}
          contentContainerStyle={{ paddingBottom: bottom + TOUCH_MIN }}
          // A tap on a row while the keyboard is up must open the dish, not
          // just dismiss the keyboard and lose the tap.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={<FilterSummary filters={filters} count={results.length} />}
          renderItem={({ item }) => (
            <DishRow
              dish={item.dish}
              /* Where it sits on the menu. A result row out of context is a
                 dish name with no idea whether it is a starter or a sweet,
                 and the server already resolves this to the one section a
                 dish should be filed under. */
              section={item.section}
              quantity={counts.get(item.dish.id) ?? 0}
              onAdjust={(direction) => adjust(item.dish.id, direction)}
              onOpen={() => {
                if (query) remember(query);
                sheet.current?.open(item.dish.id);
              }}
            />
          )}
        />
      )}

      {cart && cart.itemCount > 0 ? <CartPill cart={cart} bottom={bottom} /> : null}

      {/* LAST, so it draws over the cart pill rather than under it. */}
      <DishSheet ref={sheet} />
    </Screen>
  );
}

/**
 * Before anything has been asked.
 *
 * Recents when there are any, because the most likely next search is one
 * already made — and the invitation underneath either way, because a list of
 * six words with no explanation does not say what the box is for.
 */
function Idle({
  recents,
  onPick,
  onForget,
}: {
  recents: string[];
  onPick: (term: string) => void;
  onForget: (next: string[]) => void;
}) {
  return (
    <View style={s.idle}>
      {recents.length > 0 ? (
        <View style={s.recents}>
          <View style={s.recentHead}>
            <Text style={s.recentTitle}>{SEARCH_COPY.recentTitle}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={SEARCH_COPY.recentClear}
              hitSlop={space[3]}
              onPress={() => void clearRecents().then(onForget)}
            >
              <Text style={s.recentClear}>{SEARCH_COPY.recentClear}</Text>
            </Pressable>
          </View>

          {recents.map((entry) => (
            <View key={entry} style={s.recentRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Search again for ${entry}`}
                onPress={() => onPick(entry)}
                style={({ pressed }) => [s.recentTap, pressed && { backgroundColor: colors.card }]}
              >
                <Clock size={15} color={colors.inkFaint} strokeWidth={2} />
                <Text style={s.recentText} numberOfLines={1}>{entry}</Text>
              </Pressable>
              {/* Its own target, 48 square, because the row beside it runs
                  the search — a single row with two meanings is the one
                  people tap wrong. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Forget ${entry}`}
                onPress={() => void forgetSearch(entry).then(onForget)}
                style={({ pressed }) => [s.recentDrop, pressed && { backgroundColor: colors.card }]}
              >
                <X size={15} color={colors.inkFaint} strokeWidth={2} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={s.say}>
        <Text style={s.sayTitle}>{SEARCH_COPY.idleTitle}</Text>
        <Text style={s.sayBody}>{SEARCH_COPY.idleBody}</Text>
      </View>
    </View>
  );
}

/**
 * Searched, and the menu has nothing like it.
 *
 * Phase 4 moved the drawing into `ListState` and left the words exactly where
 * they were. This was the one screen in the app that already distinguished an
 * empty answer from a failed request; what it did not have was a shape the
 * other five could borrow, and now the same picture, the same spacing and the
 * same voice appear on every list.
 */
function Nothing({ term, filtered, outOf }: { term: string; filtered: boolean; outOf: number }) {
  return (
    <ListState
      tone="empty"
      icon={SearchX}
      title={term ? `${SEARCH_COPY.emptyLead} “${term}”.` : `${SEARCH_COPY.emptyLead} those filters.`}
      body={`${filtered ? SEARCH_COPY.emptyFiltered : SEARCH_COPY.emptyPlain}`
        + (outOf > 0 ? ` ${SEARCH_COPY.emptyOutOf(outOf)}` : '')}
    />
  );
}

const s = StyleSheet.create({
  head: {
    paddingBottom: space[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginHorizontal: space[5],
    paddingLeft: space[3],
    paddingRight: space[1],
    minHeight: TOUCH_MIN,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  input: {
    flex: 1,
    ...face('body'),
    fontSize: type.base,
    color: colors.ink,
    // Android gives a TextInput its own vertical padding and a baseline that
    // sits low in a 48pt row. Zeroing it lets the row centre the field.
    paddingVertical: 0,
  },
  clear: {
    width: TOUCH_MIN - space[3],
    height: TOUCH_MIN - space[3],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },

  idle: { flex: 1 },
  recents: { paddingTop: space[4] },
  recentHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[5],
    paddingBottom: space[2],
  },
  recentTitle: {
    ...face('bodyMedium'),
    fontSize: type.xs,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.inkFaint,
  },
  recentClear: { ...face('bodyMedium'), fontSize: type.sm, color: colors.accent },
  recentRow: { flexDirection: 'row', alignItems: 'center' },
  recentTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: TOUCH_MIN,
    paddingLeft: space[5],
    paddingRight: space[2],
  },
  recentText: { flex: 1, ...face('body'), fontSize: type.base, color: colors.ink },
  recentDrop: {
    width: TOUCH_MIN,
    height: TOUCH_MIN,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space[3],
  },

  say: { paddingHorizontal: space[5], paddingTop: space[6], gap: space[2] },
  sayTitle: { ...face('display'), fontSize: type.xl, color: colors.ink },
  sayBody: { ...face('body'), fontSize: type.base, lineHeight: 22, color: colors.inkDim },
});
