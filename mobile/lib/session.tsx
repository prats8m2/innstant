import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import * as api from './api';
import { ApiFailure } from './api';
import type { ApiCart, ApiSession, ApiCustomer, ApiAddress } from './api';

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

interface SessionState {
  /** WHERE they are ordering from. Null before the default link opens. */
  session: ApiSession | null;
  /** WHO they are, or null. Signed out is a normal, fully working state. */
  customer: ApiCustomer | null;
  addresses: ApiAddress[];
  cart: ApiCart | null;
  /** True until the cold-start checks have answered. */
  isLoading: boolean;
  /** Open a link code — from a deep link, a scan, or typing. */
  open: (code: string) => Promise<void>;
  /** Replace the cart after a mutation returned a fresh one. */
  setCart: (cart: ApiCart) => void;
  refreshCart: () => Promise<void>;
  /** After a sign-in, or a profile/address change. */
  setCustomer: (customer: ApiCustomer | null, addresses?: ApiAddress[]) => void;
  refreshAccount: () => Promise<void>;
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
      if (!(await api.getCustomerToken())) return;
      try {
        const mine = await api.me();
        if (cancelled) return;
        setCustomerState(mine.customer);
        setAddresses(mine.addresses);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiFailure && error.isSessionGone) {
          await api.setCustomerToken(null);
        }
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
    // Without this the stack becomes [menu, menu] after a scan. Guarded for
    // the same reason as above — a boot with an empty stack has nothing to
    // dismiss, and asking anyway is an error overlay.
    if (router.canDismiss()) router.dismissAll();
    router.replace('/menu');
  }, []);

  const setCustomer = useCallback((next: ApiCustomer | null, saved?: ApiAddress[]) => {
    setCustomerState(next);
    if (saved) setAddresses(saved);
    if (!next) setAddresses([]);
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!(await api.getCustomerToken())) return;
    try {
      const mine = await api.me();
      setCustomerState(mine.customer);
      setAddresses(mine.addresses);
    } catch (error) {
      if (error instanceof ApiFailure && error.isSessionGone) {
        await api.setCustomerToken(null);
        setCustomerState(null);
        setAddresses([]);
      }
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

  const refreshCart = useCallback(async () => {
    try {
      setCartState(await api.getCart());
    } catch (error) {
      if (error instanceof ApiFailure && error.isSessionGone) await end();
    }
  }, [end]);

  const value = useMemo<SessionState>(() => ({
    session,
    customer,
    addresses,
    cart,
    isLoading,
    open,
    setCart: setCartState,
    refreshCart,
    setCustomer,
    refreshAccount,
    signOut,
    end,
  }), [session, customer, addresses, cart, isLoading, open, refreshCart,
       setCustomer, refreshAccount, signOut, end]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}

/**
 * The 401 handler every screen shares.
 *
 * A session that has gone is not an error to show — it is a navigation. Every
 * screen that calls the API wraps its failures in this so that "your session
 * ended" is handled once rather than six times, and only the refusals a person
 * can act on reach a message.
 */
export function useApiError(): (error: unknown) => string | null {
  const { end } = useSession();
  return useCallback((error: unknown) => {
    if (error instanceof ApiFailure && error.isSessionGone) {
      void end();
      return null;
    }
    return error instanceof Error ? error.message : 'Something went wrong. Try again.';
  }, [end]);
}
