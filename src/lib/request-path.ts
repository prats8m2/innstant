import { headers } from 'next/headers';

/**
 * The request's own pathname, put on the forwarded headers by the middleware.
 *
 * Next does not hand a Server Component its own URL, and the middleware is the
 * only code that sees it. A page that has to bounce somebody to the login form
 * needs it to say where they were going.
 */
export const PATHNAME_HEADER = 'x-pathname';

export async function requestPathname(): Promise<string | null> {
  const store = await headers();
  const pathname = store.get(PATHNAME_HEADER);
  // Only ever an internal path. An open redirect on a login form is a gift —
  // the same check `safeNext()` makes on the other side.
  if (!pathname || !pathname.startsWith('/') || pathname.startsWith('//')) return null;
  return pathname;
}
