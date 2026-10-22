import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { router } from 'expo-router';
import * as api from './api';
import { ApiFailure, NetworkFailure } from './api';
import type { ApiCart, ApiSession, ApiCustomer, ApiAddress } from './api';
import { tapAdd, tapRemove } from './haptics';

/**
 * The one piece of state the whole app shares. D-080.
 *
 * Two things live here and nothing else does: the current visit (which decides
 * whether there is an app at all) and the cart count (which is on every
 * screen's pill). Everything else — the menu, a dish, an order — is fetched by
 * the screen that shows it and thrown away when it leaves, because none of it
 * is shared and a cache of it would be a cache to invalidate.
 *
 * ─── Two slots, not one ────────────────────────────────────────────────────
 *
 * D-081. `session` is the CONTEXT — where somebody is ordering from, a visit,
 * dead in six hours. `customer` is the IDENTITY — who they are, alive for
 * weeks. They are restored independently, refreshed independently and cleared
 * independently: signing out must leave somebody able to carry on ordering
 * anonymously (#9), and a lapsed visit must not sign them out.
 *
 * Either can be null. All four combinations are legitimate, and the one that
 * forced this shape is `customer` without `session` — opening the app signed
 * in, having scanned nothing, to look at order history.
 *
 * ─── Why the cart lives here and the menu does not ─────────────────────────
 *
 * The pill is on the menu, the dish screen and nowhere else — but a tap on the
 * dish screen has to move the number the menu will show when it is popped
 * back to. Threading that through a navigator is how one of the two ends up
 * stale. The server returns the whole cart from every mutation precisely so
 * this can be a single assignment rather than a refetch.
 */

/**
 * What a failure WAS, once the session-gone case has been navigated away.
 *
 * ─── Why two kinds and not one string ──────────────────────────────────────
 *
 * Phase 4 draws offline differently from refused, on every list, and it can
 * only do that if the thing a screen holds carries which one it is. A string
 * forces the screen to re-read the sentence to guess, which is how "No
 * connection" ends up under a "Try a different search" heading.
 *
 *   · `offline` — the request never reached a server. `NetworkFailure`, which
 *     `lib/api.ts` throws when `fetch` itself rejects. Retrying is the whole
 *     of the advice.
 *   · `refused` — it reached one and the server said no, in a sentence
 *     written to be read. Retrying the same request gets the same answer.
 */
export interface Failure {
  kind: 'offline' | 'refused';
  /** The server's own words, or the network's. Never rewritten here. */
  message: string;
}

/**
 * A cart tap that did not stick. Phase 4.
 *
 * `lead` is the app's half and `message` is the server's: "Not added." is a
 * fact about the tap that only the client knows, and "That dish is off the
 * menu tonight" is a fact about the kitchen that only the server does.
 * Composing them here keeps #5's rule about refusals intact — the app says
 * what happened to the tap and never rewrites what the server said about why.
 */
export interface CartNotice extends Failure {
  lead: string;
}

interface SessionState {
  /** WHERE they are ordering from. Null before the default link opens. */
  session: ApiSession | null;
  /** WHO they are, or null. Signed out is a normal, fully working state. */
  customer: ApiCustomer | null;
  addresses: ApiAddress[];
  cart: ApiCart | null;
  /** True until the cold-start checks have answered. */
  isLoading: boolean;
  /**
   * True until the IDENTITY has answered — a separate flag because it is a
   * separate cold start, and it deliberately does not gate `isLoading`.
   *
   * It exists so that a screen with something to say ABOUT having no account
   * can wait the one round trip before saying it. Without it, `customer ===
   * null` conflates "signed out" with "not restored yet", and a signed-in
   * person is told they have no account for as long as `me()` takes. Nothing
   * may gate BROWSING on it (#9) — the menu renders either way.
   */
  isCustomerLoading: boolean;
  /** Open a link code — from a deep link, a scan, or typing. */
  open: (code: string) => Promise<void>;
  /** Replace the cart after a mutation returned a fresh one. */
  setCart: (cart: ApiCart) => void;
  /** Re-read the cart. Returns what stopped it, or null — see below for why
   *  it hands the failure back instead of swallowing it. */
  refreshCart: () => Promise<Failure | null>;
  /**
   * How many of each DISH are in the cart, summed across variants — with any
   * tap that has not been answered yet already counted in.
   *
   * Every row that draws a quantity reads this one map. It used to be a
   * `useMemo` over `cart.lines` repeated in the menu, in search and on the
   * home screen, which was three copies of one sum and three places for the
   * optimistic half to be missing from.
   */
  counts: ReadonlyMap<string, number>;
  /**
   * Add or remove one of a dish, moving the count before the server answers.
   * Swallowed while a tap for the SAME dish is still in flight.
   */
  adjust: (menuItemId: string, direction: 'add' | 'remove') => Promise<void>;
  /** The last tap that was rolled back, or null. Drawn by `CartToast`. */
  cartNotice: CartNotice | null;
  dismissCartNotice: () => void;
  /** After a sign-in, or a profile/address change. */
  setCustomer: (customer: ApiCustomer | null, addresses?: ApiAddress[]) => void;
  /** Re-read the account. Returns what stopped it, or null — a lapsed
   *  customer token is signed-out rather than failed, and comes back null. */
  refreshAccount: () => Promise<Failure | null>;
  signOut: () => Promise<void>;
  /** Drop the CONTEXT token and go back to the entry screen. Leaves the
   *  customer signed in — a lapsed visit is not a sign-out. */
  end: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ApiSession | null>(null);
  const [customer, setCustomerState] = useState<ApiCustomer | null>(null);
  const [addresses, setAddresses] = useState<ApiAddress[]>([]);
  const [cart, setCartState] = useState<ApiCart | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isCustomerLoading, setCustomerLoading] = useState(true);

  /**
   * ─── The optimistic half of the cart. Phase 4 ──────────────────────────
   *
   * `cart` is the server's answer and is the only thing that can be trusted;
   * `pending` is what the UI has already committed to on the strength of a
   * tap, as a delta per menu item. `counts` is the sum, and is what every row
   * in the app draws.
   *
   * It is a delta rather than a predicted total on purpose. A refresh, an
   * order placed on another tab, or a second line of the same dish added from
   * the sheet can all replace `cart` while a tap is in the air — and a delta
   * stays correct across any of that, where a predicted total would be an
   * old number fighting a new one.
   *
   * The entry is deleted when the server answers, success or refusal. On
   * success the real cart has already replaced it in the same commit, so the
   * number on screen does not move; on a refusal it is the rollback, and it
   * is visible precisely because the number does move. `CartToast` is what
   * stops that looking like an add that silently evaporated.
   */
  const [pending, setPending] = useState<ReadonlyMap<string, number>>(NO_PENDING);
  /**
   * Which dishes have a write in the air.
   *
   * A ref, not state: nothing renders differently because of it, and it is
   * read on the tap that is deciding whether to be swallowed — which has to
   * see the value from the tap half a frame ago, not the one from the last
   * commit. The rule it enforces is the stepper's own, moved up here because
   * the stepper is no longer the only thing that knows a tap happened: four
   * overlapping writes against one cart row is a race the UI should not start.
   */
  const inFlight = useRef(new Set<string>());
  const [cartNotice, setCartNotice] = useState<CartNotice | null>(null);

  const end = useCallback(async () => {
    await api.setToken(null);
    setSession(null);
    setCartState(null);
    /**
     * `dismissAll()` first — but only when there is something to dismiss.
     *
     * `replace()` swaps only the TOP route, so after a 401 the hardware back
     * button returned to a menu running on a cleared token, and a 401 landing
     * on the cart replaced a modal route with a card route in place.
     *
     * The guard matters: calling it on a stack with nothing to pop raises
     * "The action 'POP_TO_TOP' was not handled by any navigator" — a redbox in
     * a dev build, and on the web an error overlay that swallows every tap on
     * the screen underneath it. That is how this was found.
     */
    if (router.canDismiss()) router.dismissAll();
    router.replace('/');
  }, []);

  /**
   * The cold start, for the CONTEXT.
   *
   * A stored visit token can have lapsed (six hours), had its visit closed, or
   * been revoked — all three come back as 401, and all three mean the same
   * thing here: there is no context, so the boot screen opens the default
   * link. Anything else is a network or server problem, and the token is kept
   * rather than thrown away because a lift with no signal is not a reason to
   * lose somebody's cart.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!(await api.getToken())) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const current = await api.currentVisit();
        if (cancelled) return;
        setSession(current);
        setCartState(await api.getCart().catch(() => null));
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiFailure && error.isSessionGone) await api.setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  /**
   * The cold start for the IDENTITY, which is a SEPARATE effect on purpose.
   *
   * It does not gate `isLoading`: the menu must render whether or not somebody
   * is signed in, and making the first screen wait on an account check would
   * put a network round trip in front of a menu for the large majority of
   * people who have no account at all (#9).
   *
   * A 401 here is ordinary — a token that expired after thirty days, or a
   * sign-out on another device. It clears quietly and the app carries on
   * signed out.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!(await api.getCustomerToken())) return;
        const mine = await api.me();
        if (cancelled) return;
        setCustomerState(mine.customer);
        setAddresses(mine.addresses);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiFailure && error.isSessionGone) {
          await api.setCustomerToken(null);
        }
      } finally {
        // Answered either way — no token, a restored customer, or a lapsed
        // one. The screens waiting on this are waiting to say something about
        // NOT being signed in, and all three outcomes settle that question.
        if (!cancelled) setCustomerLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const open = useCallback(async (code: string) => {
    const opened = await api.openVisit(code);
    setSession(opened);
    // A brand-new visit has an empty cart by construction. Fetching one would
    // be a round trip to learn a thing we already know.
    setCartState(null);
    // Without this the stack becomes [home, home] after a scan. Guarded for
    // the same reason as above — a boot with an empty stack has nothing to
    // dismiss, and asking anyway is an error overlay.
    if (router.canDismiss()) router.dismissAll();
    // Home rather than the menu: the storefront is the app's first screen now,
    // and the menu is what it opens into. A scan that landed straight on the
    // list would skip the one page that says whether the kitchen is cooking.
    router.replace('/home');
  }, []);

  const setCustomer = useCallback((next: ApiCustomer | null, saved?: ApiAddress[]) => {
    setCustomerState(next);
    if (saved) setAddresses(saved);
    if (!next) setAddresses([]);
  }, []);

  /**
   * Re-read the account, and hand back what stopped it — same shape, and the
   * same reasoning, as `refreshCart`.
   *
   * A 401 here is NOT a failure to report: a customer token that expired is
   * an ordinary signed-out state, and this clears it and returns null so the
   * screen draws the sign-in invitation rather than an error.
   */
  const refreshAccount = useCallback(async (): Promise<Failure | null> => {
    if (!(await api.getCustomerToken())) return null;
    try {
      const mine = await api.me();
      setCustomerState(mine.customer);
      setAddresses(mine.addresses);
      return null;
    } catch (error) {
      const classified = classify(error);
      if (!classified) {
        await api.setCustomerToken(null);
        setCustomerState(null);
        setAddresses([]);
        return null;
      }
      return classified;
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut();
    setCustomerState(null);
    setAddresses([]);
    // Deliberately NO navigation. Signing out leaves somebody exactly where
    // they were, still able to order — #9 does not stop applying because they
    // used to have an account.
  }, []);

  /**
   * Re-read the cart, and HAND BACK what stopped it.
   *
   * It used to swallow everything but a 401, which was right for the three
   * screens that call it as a backstop on focus — a menu must not show a red
   * panel because a background cart read timed out. It was wrong for the cart
   * screen, which has nothing else to render: a failed read left `cart` null
   * and the spinner ran forever, with no state drawn for the most likely
   * cause on this product's connection.
   *
   * So the failure is returned rather than thrown. The backstops carry on
   * ignoring it — `void refreshCart()` is unchanged at every one of them —
   * and the one screen that is the cart reads the answer.
   */
  const refreshCart = useCallback(async (): Promise<Failure | null> => {
    try {
      setCartState(await api.getCart());
      return null;
    } catch (error) {
      const classified = classify(error);
      if (!classified) { await end(); return null; }
      return classified;
    }
  }, [end]);

  /**
   * The counts every dish row draws: the server's cart plus what has been
   * tapped since.
   *
   * Floored at zero. A minus tap for a dish the server has already removed
   * would otherwise read as −1 for the length of a round trip, and a negative
   * quantity on a menu card is a bug somebody screenshots.
   */
  const counts = useMemo(() => {
    const next = new Map<string, number>();
    for (const line of cart?.lines ?? []) {
      next.set(line.menuItemId, (next.get(line.menuItemId) ?? 0) + line.quantity);
    }
    for (const [menuItemId, delta] of pending) {
      next.set(menuItemId, Math.max(0, (next.get(menuItemId) ?? 0) + delta));
    }
    return next;
  }, [cart, pending]);

  /**
   * One of a dish, in or out — with the number moving first. Phase 4.
   *
   * ─── Why the haptic did NOT move to the tap ────────────────────────────
   *
   * It would have been the obvious change: the UI now commits on the tap, so
   * buzz on the tap. The buzz keeps its old meaning instead — the cart
   * actually changed — for the reason it was given one: a refused tap must
   * not feel like one that worked, and feeling is the part a person cannot
   * check. The instant feedback the tap needs is the count moving, which it
   * now does; the buzz is the confirmation underneath it, and confirming
   * something that has not happened yet is the one thing it must not do.
   *
   * ─── A rollback says what happened ─────────────────────────────────────
   *
   * The count going back by itself is indistinguishable from an add that
   * worked and then vanished, which is worse than no optimism at all — it
   * teaches somebody that the cart loses things. So the rollback and the
   * sentence are set in the same commit, and the sentence names the tap
   * ("Not added") before it quotes the kitchen.
   */
  const adjust = useCallback(async (menuItemId: string, direction: 'add' | 'remove') => {
    if (inFlight.current.has(menuItemId)) return;
    inFlight.current.add(menuItemId);
    setPending((current) => withDelta(current, menuItemId, direction === 'add' ? 1 : -1));

    try {
      const next = await api.quickAdjust({ menuItemId, direction });
      // Both in one commit: React batches them, so the guess is replaced by
      // the server's number without a frame in between where neither is
      // counted and the row reads one lower than it did before the tap.
      setPending((current) => without(current, menuItemId));
      setCartState(next);
      setCartNotice(null);
      if (direction === 'add') tapAdd(); else tapRemove();
    } catch (failure) {
      setPending((current) => without(current, menuItemId));
      const classified = classify(failure);
      // A dead session is a navigation, not a message. Nothing to say about
      // a tap on a screen that is about to be replaced.
      if (!classified) { void end(); return; }
      setCartNotice({
        ...classified,
        lead: direction === 'add' ? 'Not added.' : 'Not removed.',
      });
    } finally {
      inFlight.current.delete(menuItemId);
    }
  }, [end]);

  const dismissCartNotice = useCallback(() => setCartNotice(null), []);

  const value = useMemo<SessionState>(() => ({
    session,
    customer,
    addresses,
    cart,
    isLoading,
    isCustomerLoading,
    open,
    setCart: setCartState,
    refreshCart,
    counts,
    adjust,
    cartNotice,
    dismissCartNotice,
    setCustomer,
    refreshAccount,
    signOut,
    end,
  }), [session, customer, addresses, cart, isLoading, isCustomerLoading, open, refreshCart,
       counts, adjust, cartNotice, dismissCartNotice,
       setCustomer, refreshAccount, signOut, end]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}

/** Shared so that an empty `pending` is one object rather than a new Map per
 *  provider render, which would re-run `counts` for nothing. */
const NO_PENDING: ReadonlyMap<string, number> = new Map();

function withDelta(
  current: ReadonlyMap<string, number>,
  menuItemId: string,
  delta: number,
): ReadonlyMap<string, number> {
  const next = new Map(current);
  next.set(menuItemId, (next.get(menuItemId) ?? 0) + delta);
  return next;
}

/** Deleted, not set to zero: a zero entry is still a key `counts` iterates
 *  and still a cart item the map claims to know about. */
function without(
  current: ReadonlyMap<string, number>,
  menuItemId: string,
): ReadonlyMap<string, number> {
  if (!current.has(menuItemId)) return current;
  const next = new Map(current);
  next.delete(menuItemId);
  return next.size === 0 ? NO_PENDING : next;
}

/**
 * What kind of failure this was, or null for one that is a navigation.
 *
 * A module function rather than a hook, because `adjust` needs it inside the
 * provider where the hooks below cannot reach. The null case is the 401: the
 * caller ends the session, and there is nothing to draw because the screen
 * that would draw it is leaving.
 */
function classify(error: unknown): Failure | null {
  if (error instanceof ApiFailure && error.isSessionGone) return null;
  if (error instanceof NetworkFailure) return { kind: 'offline', message: error.message };
  return {
    kind: 'refused',
    message: error instanceof Error ? error.message : 'Something went wrong. Try again.',
  };
}

/**
 * The 401 handler every screen shares, and the thing that says what else went
 * wrong. Phase 4 widened it from a string to a `Failure`.
 *
 * A session that has gone is not an error to show — it is a navigation. Every
 * screen that calls the API wraps its failures in this so that "your session
 * ended" is handled once rather than six times, and only the refusals a person
 * can act on reach a message.
 *
 * What phase 4 added is the KIND. A list that cannot tell offline from refused
 * has to draw one state for both, and the two need different words and
 * different buttons — "check your signal" is useless advice about a kitchen
 * that has closed.
 */
export function useApiFailure(): (error: unknown) => Failure | null {
  const { end } = useSession();
  return useCallback((error: unknown) => {
    const failure = classify(error);
    if (!failure) void end();
    return failure;
  }, [end]);
}

/** The same thing, for the screens that only ever wanted the sentence. */
export function useApiError(): (error: unknown) => string | null {
  const failureOf = useApiFailure();
  return useCallback((error: unknown) => failureOf(error)?.message ?? null, [failureOf]);
}
