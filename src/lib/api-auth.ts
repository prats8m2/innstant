import { GUEST_SESSION_COOKIE, resolveVisitSession } from '@/modules/access';
import type { VisitGuestSession } from '@/modules/access';
import { resolveCustomerSession, CUSTOMER_TOKEN_HEADER } from '@/modules/customer';
import type { CustomerSession } from '@/modules/customer';
import { UnauthenticatedError } from './errors';

/**
 * How a non-browser client presents a guest session. D-080.
 *
 * ─── The same session row, a different envelope ────────────────────────────
 *
 * The web carries `hgs_guest` as an httpOnly cookie holding
 * `<tenantId>.<token>`. A React Native app has no cookie jar worth relying on —
 * `fetch` on iOS and Android shares one with the system WebView, which is
 * neither inspectable nor clearable from JS, and an httpOnly cookie is
 * unreadable by the app that has to store it between launches.
 *
 * So the app sends the IDENTICAL string as a bearer token:
 *
 *     Authorization: Bearer <tenantId>.<token>
 *
 * That is the whole of the difference. There is no second session model, no
 * JWT, no refresh token, and no second table — `resolveVisitSession()` parses
 * the same value, looks up the same SHA-256 hash, and applies the same
 * revocation and expiry rules (#10). A session revoked when a visit closes dies
 * for the app at the same instant it dies for a browser, which is exactly the
 * property a stateless token would have thrown away.
 *
 * ─── Why the cookie is still accepted ──────────────────────────────────────
 *
 * So that `/api/v1` is usable from the web app too — a browser calling it from
 * the same origin already has the cookie, and requiring it to dig the value out
 * and re-send it as a header would mean reading an httpOnly cookie, which is
 * the one thing httpOnly prevents. Header first, cookie second: an explicit
 * credential beats an ambient one when both are present.
 */
export const BEARER_PREFIX = 'Bearer ';

/**
 * One cookie's value out of a `Cookie` header.
 *
 * Deliberately not `cookies()` from `next/headers`, which was the first
 * version of this and was wrong in a way worth recording: it reads Next's
 * AMBIENT request scope rather than the request this function was handed. A
 * function taking a `Request` and then ignoring half of it is a lie about where
 * its answer comes from — and it threw outright anywhere there is no request
 * scope, which is how the test that resolves a cookie found it.
 *
 * Split on the FIRST `=` only. A session value is `<uuid>.<base64url>` and
 * base64url has no padding, so today there is no `=` inside one — but a parser
 * that splits on every `=` is a bug waiting for the day something else is
 * stored here, and getting it right is one argument to `indexOf`.
 */
function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    if (pair.slice(0, at).trim() !== name) continue;
    const value = pair.slice(at + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

/** The raw credential, from the header or the cookie. Null when neither. */
export function guestCredentialFrom(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header?.startsWith(BEARER_PREFIX)) {
    const value = header.slice(BEARER_PREFIX.length).trim();
    if (value) return value;
  }

  return cookieValue(request.headers.get('cookie'), GUEST_SESSION_COOKIE);
}

/**
 * The visit session behind this request, or null.
 *
 * Narrowed to a VISIT deliberately. `/api/v1` is the restaurant app's API
 * (D-080) and every endpoint on it is about ordering without a room; a stay
 * session reaching one of them would be a browser's room cookie wandering into
 * the wrong surface, and it resolves to nothing rather than to a half-working
 * screen.
 */
export async function visitSessionFrom(request: Request): Promise<VisitGuestSession | null> {
  return resolveVisitSession(guestCredentialFrom(request) ?? undefined);
}

/** The same, throwing — for the handlers where there is nothing to render
 *  without one. Mapped to 401 by `httpStatusFor`, in one place as always. */
export async function requireVisitSession(request: Request): Promise<VisitGuestSession> {
  const session = await visitSessionFrom(request);
  if (!session) {
    /**
     * NOT "sign in to continue" — the default, which is written for the staff
     * console. There is no sign-in anywhere on a guest surface (#9), and an
     * app that showed that sentence would send somebody looking for a screen
     * this product does not have.
     *
     * What actually happened is one of three things, all with the same answer:
     * the six-hour window lapsed, the visit closed, or the session was
     * revoked. The app's job is to send them back through the link, and the
     * sentence says so.
     */
    throw new UnauthenticatedError(
      'no visit session on this request',
      'This order session has ended. Open the link again to start a new one.',
    );
  }
  return session;
}


/* ── The second credential (D-081) ───────────────────────────────────────── */

/**
 * The signed-in customer behind this request, or null.
 *
 * ─── Why a separate header and not the same one ────────────────────────────
 *
 * Because they are different questions with different lifetimes. The bearer in
 * `Authorization` says WHERE somebody is ordering from and dies with that
 * context — six hours for a table tent. This says WHO THEY ARE and lasts
 * weeks. A request legitimately carries neither, either, or both.
 *
 * `Authorization` stayed with the context so that the APK already on
 * somebody's phone keeps working unchanged. An installed client cannot be
 * redeployed; that is the whole reason `/v1` is versioned, and the promise is
 * worth nothing if it is not kept the first time it costs something.
 */
export async function customerSessionFrom(request: Request): Promise<CustomerSession | null> {
  const token = request.headers.get(CUSTOMER_TOKEN_HEADER);
  return resolveCustomerSession(token?.trim() || undefined);
}

/** The same, throwing — for the endpoints that are ABOUT the account. */
export async function requireCustomerSession(request: Request): Promise<CustomerSession> {
  const session = await customerSessionFrom(request);
  if (!session) {
    throw new UnauthenticatedError(
      'no customer session on this request',
      'Sign in to see this.',
    );
  }
  return session;
}

/**
 * A customer session NEVER widens what a context session may do.
 *
 * This function exists to be read rather than called: there is deliberately no
 * helper anywhere that takes both credentials and returns a combined
 * permission, because the moment one exists somebody will reach for it. A
 * signed-in customer at a table has exactly the access that table has, and a
 * signed-in customer in a hotel room has exactly the access that room sticker
 * grants — which is what D-012 decides, from the stay, and not from anything
 * in this file.
 *
 * Proving a phone number proves a phone number. It does not prove you are the
 * person in 214.
 */
export const CUSTOMER_GRANTS_NO_CONTEXT_ACCESS = true;
