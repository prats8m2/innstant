import { NextResponse, type NextRequest } from 'next/server';
import { scanQrCode, resolveStaySession, GUEST_SESSION_COOKIE, QrNotUsableError } from '@/modules/access';
import { resolveQrRouting } from '@/db';

/**
 * The link. `/r/{publicCode}` — printed on a nightstand sticker, or simply
 * sent to someone.
 *
 * A Route Handler rather than a page, for one reason: it must SET A COOKIE, and
 * a Server Component cannot. Without this, every reload of the room home would
 * mint another `guest_sessions` row, which makes `access_escalations`
 * unreadable and re-prompts a verified guest after each refresh.
 *
 * So: resolve or issue the session here, set the cookie, redirect to
 * `/r/{code}/home`. One extra hop, and the guest never sees it.
 *
 * CLAUDE.md #9 — no login, no signup, no verification, no onboarding. If you
 * add a screen here, read D-012 first: that design was built and removed.
 */
export const dynamic = 'force-dynamic';

function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

/**
 * The dead end, made readable.
 *
 * This used to be `new NextResponse(null, { status: 404 })` — a blank browser
 * error page for somebody who had just pointed their phone at a sticker, or
 * opened a link they were sent last week. It is the most likely screen in the
 * product to be seen by a person with no idea what went wrong, and it said
 * nothing at all.
 *
 * ─── It still reveals nothing ──────────────────────────────────────────────
 *
 * The security property is unchanged and worth restating: unknown code,
 * revoked sticker, wrong version and no-active-stay all land HERE, with the
 * same status and the same words. Somebody scanning from a corridor cannot
 * tell which, and in particular cannot learn whether a room is occupied.
 *
 * ─── Why the styles are inline ─────────────────────────────────────────────
 *
 * A Route Handler returns bytes, not a React tree, so it cannot reach the
 * stylesheet — the bundle's filename is hashed at build time and is not
 * knowable from here. Rather than link a file that may not exist, the page
 * carries the four values it needs. They are the brand constants from
 * `theme.css`, and this is the one file in the product allowed to repeat them.
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
<p>It may be an old code, or the stay it belonged to has ended. If you are in
the room, scan the code on the nightstand again. If somebody sent you this to
show you how it works, the demo is always at the link below.</p>
<a href="/demo">Open the demo room</a>
</main></body></html>`;

  return new NextResponse(html, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> },
): Promise<NextResponse> {
  const { qrCode } = await params;
  /**
   * A RELATIVE Location, deliberately.
   *
   * `NextResponse.redirect()` needs an absolute URL, and building one from
   * `request.url` or `nextUrl` derives the host from the server's bind
   * address — which under `output: 'standalone'` is 0.0.0.0, and behind
   * Railway's proxy would send a guest to an internal hostname.
   *
   * A relative Location is valid (RFC 7231 §7.1.2) and the browser resolves it
   * against the URL it actually requested, so there is no host to get wrong.
   */
  const home = `/r/${encodeURIComponent(qrCode)}/home`;

  /**
   * Is this code real, before anything else?
   *
   * The reuse shortcut below used to come first, which meant a browser holding
   * ANY live session was sent to `/r/{whatever}/home` without the code being
   * looked at — so a dead link answered 200 and rendered a room. No data
   * crossed (the session is bound to its own stay, #10, so it showed the
   * holder their own room), but it made a broken link indistinguishable from a
   * working one, which is how a reseed that invalidated every printed URL went
   * unnoticed. It hid the bug it was being used to test for.
   *
   * `resolveQrRouting()` is the one pre-tenant lookup in the request path and
   * returns routing ids only. Cheap, and it turns an unknown or revoked code
   * into the same page it gets for everyone else.
   */
  const routing = await resolveQrRouting(qrCode);
  if (!routing || routing.revokedAt) return linkNotActive();

  // Already carrying a live session — reuse it rather than minting another on
  // every reload, which would make `access_escalations` unreadable and
  // re-prompt a verified guest after each refresh.
  const existing = await resolveStaySession(request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (existing) return redirectTo(home);

  try {
    const scan = await scanQrCode(qrCode, {
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    const response = redirectTo(home);
    response.cookies.set(GUEST_SESSION_COOKIE, scan.cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: scan.session.expiresAt,
    });
    return response;
  } catch (error) {
    // Unknown code, revoked sticker, wrong version, or nobody checked in — all
    // the same 404 page. Someone scanning from a corridor learns nothing from
    // which it was, including whether the room is occupied.
    if (error instanceof QrNotUsableError) return linkNotActive();
    throw error;
  }
}
