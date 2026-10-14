import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import * as api from './api';
import { ApiFailure } from './api';
import type { ApiCart, ApiSession } from './api';

/**
 * The one piece of state the whole app shares. D-080.
 *
 * Two things live here and nothing else does: the current visit (which decides
 * whether there is an app at all) and the cart count (which is on every
 * screen's pill). Everything else — the menu, a dish, an order — is fetched by
 * the screen that shows it and thrown away when it leaves, because none of it
 * is shared and a cache of it would be a cache to invalidate.
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
  session: ApiSession | null;
  cart: ApiCart | null;
  /** True until the cold-start check has answered. */
  isLoading: boolean;
  /** Open a link code — from a deep link, a scan, or typing. */
  open: (code: string) => Promise<void>;
  /** Replace the cart after a mutation returned a fresh one. */
  setCart: (cart: ApiCart) => void;
  refreshCart: () => Promise<void>;
  /** Drop the token and go back to the entry screen. */
  end: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ApiSession | null>(null);
  const [cart, setCartState] = useState<ApiCart | null>(null);
  const [isLoading, setLoading] = useState(true);

  const end = useCallback(async () => {
    await api.setToken(null);
    setSession(null);
    setCartState(null);
    /**
     * `dismissAll()` first. `replace()` swaps only the TOP route, so after a
     * 401 the hardware back button returned to a menu running on a cleared
     * token — and when the 401 landed on the cart, a modal route was being
     * replaced by a card route in place.
     */
    router.dismissAll();
    router.replace('/');
  }, []);

  /**
   * The cold start.
   *
   * A stored token can have lapsed (six hours), had its visit closed, or been
   * revoked — all three come back as a 401, and all three mean the same thing
   * to this app: there is no session, show the entry screen. Anything else is
   * a network or server problem, and the app keeps the token rather than
   * throwing away a perfectly good session because a lift had no signal.
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

  const open = useCallback(async (code: string) => {
    const opened = await api.openVisit(code);
    setSession(opened);
    // A brand-new visit has an empty cart by construction. Fetching one would
    // be a round trip to learn a thing we already know.
    setCartState(null);
    // Without dismissAll the stack becomes [menu, menu] after a scan.
    router.dismissAll();
    router.replace('/menu');
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
    cart,
    isLoading,
    open,
    setCart: setCartState,
    refreshCart,
    end,
  }), [session, cart, isLoading, open, refreshCart, end]);

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
