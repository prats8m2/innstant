import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import type {
  ApiCart, ApiError, ApiMenu, ApiDishDetail, ApiOrder, ApiOrderSummary,
  ApiPlacedOrder, ApiSession, ApiPlaceOrderBody, ApiAddToCartBody, ApiQuickAddBody,
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

let cached: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  // SecureStore throws on a device with no keychain access rather than
  // returning null, and a cold start that throws here would be a white screen.
  try {
    cached = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    cached = null;
  }
  return cached;
}

export async function setToken(token: string | null): Promise<void> {
  cached = token;
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // A device that cannot persist it still works for this session — `cached`
    // holds it. Losing it on next launch is worse than failing to order now.
  }
}

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
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = init;

  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const token = await getToken();
    // Sent as a bearer, which is the same string the web holds in a cookie —
    // see src/lib/api-auth.ts for why the transport differs and the session
    // does not.
    if (token) headers.authorization = `Bearer ${token}`;
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

/** Re-exported so screens import their types from one place. */
export type {
  ApiCart, ApiCartLine, ApiMenu, ApiMenuSection, ApiDish, ApiDishDetail,
  ApiModifierGroup, ApiOrder, ApiOrderSummary, ApiSession, ApiVisit,
  ApiFulfilment, ApiMoney, ApiTrackStep,
} from '@contract';
