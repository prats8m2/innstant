import { NextResponse, type NextRequest } from 'next/server';
import { STAFF_SESSION_COOKIE } from '@/modules/identity/cookie';

/**
 * Staff surface gate for /admin, /kds and /runner.
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
const STAFF_PREFIXES = ['/admin', '/kds', '/runner'];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const isStaffSurface = STAFF_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!isStaffSurface) return NextResponse.next();

  if (pathname.startsWith('/admin/login')) return NextResponse.next();

  const cookie = request.cookies.get(STAFF_SESSION_COOKIE);
  if (!cookie?.value) {
    const login = request.nextUrl.clone();
    login.pathname = '/admin/login';
    // Send them back where they were going, but only to an internal path —
    // an open redirect here would be a phishing gift.
    login.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/kds/:path*', '/runner/:path*'],
};
