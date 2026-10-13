import { NextResponse, type NextRequest } from 'next/server';
import { scanVisitLink, resolveVisitSession, GUEST_SESSION_COOKIE, QrNotUsableError } from '@/modules/access';
import { resolveVisitLink as routeVisitLink } from '@/db';

/**
 * The property link. `/p/{publicCode}` — D-079.
 *
 * The sibling of `/r/{publicCode}`, and a Route Handler for the same single
 * reason: it must SET A COOKIE, and a Server Component cannot. Without this,
 * every reload of the menu would open another visit and another session, which
 * would make the admin's "which tent actually gets used" count meaningless and
 * would lose a cart on every refresh.
 *
 * ─── Where it goes, and why it is not a home screen ────────────────────────
 *
 * `/r/{code}` lands on a room home — a masthead, a greeting, four tiles — and
 * that is right for somebody who has a whole stay to manage. A property link
 * has ONE thing to do. Burying a menu behind a landing page turns ordering
 * food into a second tap for no reason, so this lands on the menu.
 *
 * CLAUDE.md #9 — no login, no signup, no verification, no onboarding. The one
 * question this flow ever asks (a name and a number) comes at checkout, where
 * it is needed to ring somebody when the food is ready.
 */
export const dynamic = 'force-dynamic';

function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

/**
 * The dead end, in the words this one needs.
 *
 * Same shape and same restraint as the room version: unknown code, revoked
 * link and version mismatch all land here with the same status and the same
 * sentence, so somebody probing codes learns nothing from which it was.
 *
 * The WORDS differ because the reader does. A room sticker's dead end can say
 * "scan the code on the nightstand again"; somebody who tapped a link in an
 * Instagram bio has no nightstand, and telling them to find one is worse than
 * saying nothing. This one says the restaurant may have replaced the link,
 * because that is the likeliest truth and it is actionable.
 *
 * Styles inline for the reason the room version gives at length: a Route
 * Handler returns bytes and cannot reach a stylesheet whose filename is hashed
 * at build time.
 */
function linkNotActive(): NextResponse {
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0A1220">
<meta name="robots" content="noindex">
<title>This link isn’t active</title>
<style>
  :root { color-scheme: dark }
  body {
    margin: 0; min-height: 100dvh; display: grid; place-items: center;
    padding: 32px; background: #0A1220; color: #FFFFFF;
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    line-height: 1.6;
  }
  main { max-width: 26rem }
  h1 { font-size: 1.6rem; line-height: 1.2; margin: 0 0 12px; font-weight: 600 }
  p { margin: 0 0 20px; color: rgba(255,255,255,.72) }
  a {
    display: inline-flex; align-items: center; min-height: 48px;
    padding: 0 22px; border-radius: 8px; background: #C99A4B;
    color: #101E33; font-weight: 700; text-decoration: none;
  }
</style>
</head><body><main>
<h1>This link isn’t active</h1>
<p>The restaurant may have replaced it since this was printed or posted. If
there is a code on your table, scan that one. Otherwise ask at the counter —
they can send you a working link.</p>
<a href="/demo">See how this works</a>
</main></body></html>`;

  return new NextResponse(html, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;
  // Relative, for the reason `/r/{code}` spells out: under `output:
  // 'standalone'` the server's own host is 0.0.0.0, and behind Railway's proxy
  // an absolute URL built from `request.url` sends people to an internal name.
  const menu = `/p/${encodeURIComponent(code)}/menu`;

  // Is this link real, before anything else? Same ordering as the room path,
  // and for the same reason: checking the cookie first would make a dead link
  // answer 200 for anybody already holding a session, which is how a broken
  // link becomes indistinguishable from a working one.
  const routing = await routeVisitLink(code);
  if (!routing || routing.revokedAt) return linkNotActive();

  /**
   * Already carrying a live VISIT session — reuse it.
   *
   * Narrowed to a visit deliberately. Somebody who scanned their room sticker
   * this morning and then opened the restaurant's link at lunchtime is holding
   * a STAY session, and reusing it would drop them into the menu with a cart
   * that charges their room — which is a different product decision, not this
   * one, and not one a link should make silently. They get their own visit.
   */
  const existing = await resolveVisitSession(request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (existing) return redirectTo(menu);

  try {
    const scan = await scanVisitLink(code, {
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    const response = redirectTo(scan.next);
    response.cookies.set(GUEST_SESSION_COOKIE, scan.cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: scan.session.expiresAt,
    });
    return response;
  } catch (error) {
    if (error instanceof QrNotUsableError) return linkNotActive();
    throw error;
  }
}
