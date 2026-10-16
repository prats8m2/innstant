import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import type {
  ApiCart, ApiError, ApiMenu, ApiDishDetail, ApiOrder, ApiOrderSummary,
  ApiPlacedOrder, ApiSession, ApiPlaceOrderBody, ApiAddToCartBody, ApiQuickAddBody,
  ApiCustomer, ApiAddress, ApiAddressBody, ApiMe, ApiSignedIn,
  ApiRequestOtpResult, ApiUpdateProfileBody,
  ApiReorderSuggestion, ApiReorderResult, ApiOrderedBefore,
} from '@contract';

/**
 * The one place this app knows about HTTP. D-080.
 *
 * Every screen calls a named function here and gets typed data or a thrown
 * `ApiFailure`. Nothing else in the app composes a URL, reads the token, or
 * decides what a status code means — which is what keeps "the session ended"
 * handled identically on six screens instead of five and a half.
 */

/**
 * Where the server is.
 *
 * `EXPO_PUBLIC_API_URL` in development — a simulator reaches the host machine
 * at `localhost`, an Android emulator at `10.0.2.2`, and a real phone on the
 * same wifi only at the laptop's LAN address. There is no value that is right
 * for all three, so it is configuration rather than a constant, and
 * `pnpm dev:lan` in the web app already prints the one a phone needs.
 */
const BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL
  ?? Constants.expoConfig?.extra?.apiUrl
  ?? 'https://innstant.in'
) as string;

/**
 * The token lives in the OS keychain, not in AsyncStorage.
 *
 * It is a bearer credential: whoever holds it can order food and read this
 * customer's name, number and delivery address. AsyncStorage is a plaintext
 * file readable by anything that can read the app's sandbox — on a rooted or
 * jailbroken device, that is anything at all. `expo-secure-store` is the
 * Keychain on iOS and EncryptedSharedPreferences on Android.
 */
/**
 * Which restaurant this build opens on. D-080.
 *
 * Baked in at build time beside the API it talks to, and for the same reason:
 * there is no runtime switch, so a build for a different property is a
 * different build. An app whose first screen asked "which restaurant?" would
 * be asking a question its own branding has already answered.
 *
 * Scanning a table tent or a room sticker overrides it — see the scan screen.
 * The fallback is the demo link rather than empty, so a build that forgot to
 * set it still opens onto something rather than onto an error.
 */
export const DEFAULT_LINK_CODE = (
  process.env.EXPO_PUBLIC_DEFAULT_LINK
  ?? Constants.expoConfig?.extra?.defaultLink
  ?? 'the-kesari-order'
) as string;

const TOKEN_KEY = 'kesari.visit.token';

/**
 * The SECOND credential, stored separately. D-081.
 *
 * Two keys rather than one blob, because the two have genuinely different
 * lifetimes and are cleared independently: a visit lapses after six hours and
 * signing out must not take the context with it, while signing out must clear
 * the customer and leave somebody able to carry on ordering anonymously (#9).
 */
const CUSTOMER_KEY = 'kesari.customer.token';

/**
 * One implementation for both, because the failure handling is the whole
 * point of it and two copies would be two chances to get that wrong.
 */
function keychain(key: string) {
  let cached: string | null | undefined;

  return {
    async get(): Promise<string | null> {
      if (cached !== undefined) return cached;
      // SecureStore THROWS on a device with no keychain access rather than
      // returning null, and a cold start that threw here would be a white
      // screen. It also no-ops entirely on the web target, which is why this
      // path has never actually run on a device.
      try {
        cached = await SecureStore.getItemAsync(key);
      } catch {
        cached = null;
      }
      return cached;
    },
    async set(value: string | null): Promise<void> {
      cached = value;
      try {
        if (value) await SecureStore.setItemAsync(key, value);
        else await SecureStore.deleteItemAsync(key);
      } catch {
        // A device that cannot persist still works for this session — the
        // in-memory copy holds it. Losing it on the next launch is a worse
        // outcome than refusing to work now.
      }
    },
  };
}

const visitStore = keychain(TOKEN_KEY);
const customerStore = keychain(CUSTOMER_KEY);

export const getToken = visitStore.get;
export const setToken = visitStore.set;
export const getCustomerToken = customerStore.get;
export const setCustomerToken = customerStore.set;

/**
 * A refusal the server explained, carried with its status.
 *
 * `code` is what the app branches on; `message` is what a person reads, and it
 * is written by the server precisely so that every client says the same
 * sentence. The app never invents its own wording for a refusal it did not
 * decide.
 */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }

  /** The session is gone — lapsed, closed or revoked. Every screen answers
   *  this the same way: drop the token and go back to the entry screen. */
  get isSessionGone(): boolean {
    return this.status === 401;
  }
}

/** A network that did not answer. Distinct from a server that refused. */
export class NetworkFailure extends Error {
  constructor() {
    // Said as a thing to do, not as an apology. Restaurant wifi is the normal
    // case here, not the exception.
    super('No connection. Check your signal and try again.');
    this.name = 'NetworkFailure';
  }
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean; customer?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, customer = true } = init;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const token = await getToken();
    // Sent as a bearer, which is the same string the web holds in a cookie —
    // see src/lib/api-auth.ts for why the transport differs and the session
    // does not.
    if (token) headers.authorization = `Bearer ${token}`;
  }
  if (customer) {
    /**
     * Sent whenever we have it, on EVERY request — not only the account ones.
     *
     * Placing an order is the reason: the server stamps `orders.guest_id` from
     * this header and nothing else, so an order placed without it never enters
     * the customer's history. Attaching it only to `/auth/*` and `/profile`
     * would make history silently incomplete in a way nothing would catch.
     *
     * It is harmless everywhere else — a customer token grants no access to
     * any context (D-081), so a route that ignores it is unaffected.
     */
    const token = await getCustomerToken();
    if (token) headers['x-customer-token'] = token;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkFailure();
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    // A 502 from a proxy is HTML, not JSON. Treat an unparseable body at a
    // failing status as the failure it is rather than as a parse bug.
    if (!response.ok) {
      throw new ApiFailure(response.status, 'INTERNAL', 'Something went wrong on our side.');
    }
    throw new NetworkFailure();
  }

  if (!response.ok) {
    const error = payload as ApiError;
    throw new ApiFailure(
      response.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? 'Something went wrong on our side.',
    );
  }

  return payload as T;
}

/* ── The calls ───────────────────────────────────────────────────────────── */

/**
 * Open a visit from a link code, and keep the token it returns.
 *
 * `auth: false` — this is the one call made without a credential, because it
 * is the call that produces one. Sending a stale token here would be harmless
 * and pointless: the server opens a NEW visit regardless, exactly as opening
 * the link in a browser does.
 */
export async function openVisit(code: string): Promise<ApiSession> {
  const session = await request<ApiSession>('/visits', {
    method: 'POST',
    body: { code },
    auth: false,
  });
  if (session.token) await setToken(session.token);
  return session;
}

/** Is the stored token still good? The app's cold-start call. */
export function currentVisit(): Promise<ApiSession> {
  return request<ApiSession>('/visits/current');
}

export function getMenu(): Promise<ApiMenu> {
  return request<ApiMenu>('/menu');
}

export function getDish(itemId: string): Promise<ApiDishDetail> {
  return request<ApiDishDetail>(`/menu/${itemId}`);
}

export function getCart(): Promise<ApiCart> {
  return request<ApiCart>('/cart');
}

/** The + and − on a menu card. Applies the kitchen's own defaults. */
export function quickAdjust(body: ApiQuickAddBody): Promise<ApiCart> {
  return request<ApiCart>('/cart/quick-add', { method: 'POST', body });
}

/** From the dish screen, where somebody actually chose. */
export function addToCart(body: ApiAddToCartBody): Promise<ApiCart> {
  return request<ApiCart>('/cart/items', { method: 'POST', body });
}

export function setLineQuantity(cartItemId: string, quantity: number): Promise<ApiCart> {
  return request<ApiCart>(`/cart/items/${cartItemId}`, { method: 'PATCH', body: { quantity } });
}

export function removeLine(cartItemId: string): Promise<ApiCart> {
  return request<ApiCart>(`/cart/items/${cartItemId}`, { method: 'DELETE' });
}

export function placeOrder(body: ApiPlaceOrderBody): Promise<ApiPlacedOrder> {
  return request<ApiPlacedOrder>('/orders', { method: 'POST', body });
}

export function listOrders(): Promise<ApiOrderSummary[]> {
  return request<ApiOrderSummary[]>('/orders');
}

export function getOrder(orderId: string): Promise<ApiOrder> {
  return request<ApiOrder>(`/orders/${orderId}`);
}

/**
 * "Same as last time" — the last delivered order, when the WHOLE of it can go
 * back in a cart today.
 *
 * `{ reorder: null }` is the ordinary answer and the home screen draws nothing
 * for it: a first visit, a rejected last order, or a dish off the menu tonight
 * all look the same from here, and none of them is something a customer can
 * act on from a storefront. The server decides it, because the server is where
 * the menu is.
 *
 * Both credentials ride along by default, which is what makes this the
 * ACCOUNT's last order when somebody is signed in and this visit's when they
 * are not — the same branch `/orders` makes.
 */
export function getReorder(): Promise<ApiReorderSuggestion> {
  return request<ApiReorderSuggestion>('/orders/reorder');
}

/**
 * Which dishes this history has eaten — ids only. Phase 2.
 *
 * The "Order again" rail is drawn by intersecting these with the menu the
 * screen is already holding, so a dish that is off tonight simply is not
 * there. See `ApiOrderedBefore` for why the server sends no dish data.
 *
 * Both credentials ride along by default, which makes this the ACCOUNT's
 * history when somebody is signed in and this visit's when they are not —
 * the same branch `/orders` and the reorder block make.
 */
export function orderedBefore(): Promise<ApiOrderedBefore> {
  return request<ApiOrderedBefore>('/orders/again');
}

/** Puts that order's lines back in the cart and hands the cart back, so the
 *  shared copy is replaced by one assignment rather than a refetch. */
export function reorder(orderId: string): Promise<ApiReorderResult> {
  return request<ApiReorderResult>('/orders/reorder', { method: 'POST', body: { orderId } });
}

/** Re-exported so screens import their types from one place. */
export type {
  ApiCart, ApiCartLine, ApiMenu, ApiMenuSection, ApiDish, ApiDishDetail,
  ApiModifierGroup, ApiOrder, ApiOrderSummary, ApiSession, ApiVisit,
  ApiFulfilment, ApiMoney, ApiTrackStep,
  ApiReorder, ApiReorderSuggestion, ApiReorderResult, ApiOrderedBefore,
} from '@contract';


/* ── The account (D-081) ─────────────────────────────────────────────────── */

/** Ask for a code. Always succeeds for a dialable number — it deliberately
 *  does not report whether one was actually sent. */
export function requestOtp(phone: string): Promise<ApiRequestOtpResult> {
  return request<ApiRequestOtpResult>('/auth/otp/request', {
    method: 'POST',
    body: { phone },
  });
}

/** Check the code and sign in. Stores the token before returning, so the very
 *  next call already carries it. */
export async function verifyOtp(
  input: { phone: string; code: string; name?: string },
): Promise<ApiSignedIn> {
  const signedIn = await request<ApiSignedIn>('/auth/otp/verify', {
    method: 'POST',
    body: input,
  });
  await setCustomerToken(signedIn.token);
  return signedIn;
}

/** The cold-start check for the customer half. Needs NO context token. */
export function me(): Promise<ApiMe> {
  return request<ApiMe>('/auth/me', { auth: false });
}

export async function signOut(): Promise<void> {
  // Best effort: the local token is cleared whatever the server says, because
  // a sign-out that appears not to work is worse than one the server has not
  // caught up with. The row expires on its own regardless.
  try {
    await request<{ ok: true }>('/auth/logout', { method: 'POST', auth: false });
  } catch {
    // Already revoked, or offline.
  }
  await setCustomerToken(null);
}

export function updateProfile(body: ApiUpdateProfileBody): Promise<ApiCustomer> {
  return request<ApiCustomer>('/profile', { method: 'PATCH', body, auth: false });
}

export function listAddresses(): Promise<ApiAddress[]> {
  return request<ApiAddress[]>('/addresses', { auth: false });
}

export function createAddress(body: ApiAddressBody): Promise<ApiAddress> {
  return request<ApiAddress>('/addresses', { method: 'POST', body, auth: false });
}

export function updateAddress(id: string, body: ApiAddressBody): Promise<ApiAddress> {
  return request<ApiAddress>(`/addresses/${id}`, { method: 'PATCH', body, auth: false });
}

export function removeAddress(id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/addresses/${id}`, { method: 'DELETE', auth: false });
}

/** This customer's orders, across every visit. Identity only. */
export function listAccountOrders(): Promise<ApiOrderSummary[]> {
  return request<ApiOrderSummary[]>('/orders?scope=account', { auth: false });
}

export type {
  ApiCustomer, ApiAddress, ApiMe, ApiSignedIn,
} from '@contract';
