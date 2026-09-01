import { NextResponse, type NextRequest } from 'next/server';
import { STAFF_SESSION_COOKIE } from '@/modules/identity/cookie';
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/request-id';

/**
 * Two jobs: stamp every request with an id, and turn staff surfaces away when
 * there is no cookie.
 *
 * ─── The request id ────────────────────────────────────────────────────────
 *
 * Minted here because this is the first code that sees a request, and put on
 * BOTH the forwarded request headers (so route handlers and server components
 * read it with `headers()`) and the response (so a guest reporting a problem
 * can quote it). Nothing heavier than `crypto.randomUUID` runs here — this is
 * the edge runtime, and pino does not exist in it.
 *
 * ─── The staff gate ────────────────────────────────────────────────────────
 *
 * ─── What this deliberately does NOT do ────────────────────────────────────
 *
 * It does not resolve the session. Next.js middleware runs on the EDGE runtime,
 * which cannot open a TCP connection to Postgres — so any "real" auth here
 * would either be a lie (trusting an unverified cookie) or force the whole
 * middleware into the Node runtime for a check that has to be repeated server
 * side anyway.
 *
 * So this is a cheap turnstile: no cookie, no page. The ACTUAL authorization
 * happens in `requireStaffContext()` (src/lib/auth-context.ts), server-side,
 * against the database, on every request that touches data — because a
 * middleware check alone is bypassable by anything that does not route through
 * it, and Server Actions are exactly that.
 *
 * Treat a redirect from here as a UX affordance, never as a security boundary.
 */
const STAFF_PREFIXES = ['/admin', '/kds', '/runner', '/housekeeping'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const requestId = requestIdFrom(request.headers);

  const forwarded = new Headers(request.headers);
  forwarded.set(REQUEST_ID_HEADER, requestId);
  const pass = () => NextResponse.next({ request: { headers: forwarded } });

  const isStaffSurface = STAFF_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  const response =
    !isStaffSurface || pathname.startsWith('/admin/login')
      ? pass()
      : gateStaff(request, pathname, pass);

  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

function gateStaff(
  request: NextRequest,
  pathname: string,
  pass: () => NextResponse,
): NextResponse {
  const cookie = request.cookies.get(STAFF_SESSION_COOKIE);
  if (cookie?.value) return pass();

  const login = request.nextUrl.clone();
  login.pathname = '/admin/login';
  // Send them back where they were going, but only to an internal path —
  // an open redirect here would be a phishing gift.
  login.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // Every request, so the id is universal — except the ones that are served
  // from disk and never reach application code. Matching those would add an
  // edge invocation per static asset for a trace nobody reads.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/|icons/|.*\\.(?:png|jpg|jpeg|svg|webp|woff2|ico|txt|xml)$).*)'],
};
