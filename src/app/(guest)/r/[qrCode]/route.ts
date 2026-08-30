import { NextResponse, type NextRequest } from 'next/server';
import { scanQrCode, resolveGuestSession, GUEST_SESSION_COOKIE, QrNotUsableError } from '@/modules/access';

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

  // Already carrying a live session for this stay — reuse it.
  const existing = await resolveGuestSession(request.cookies.get(GUEST_SESSION_COOKIE)?.value);
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
    // 404. Someone scanning from a corridor learns nothing from which it was,
    // including whether the room is occupied.
    if (error instanceof QrNotUsableError) {
      return new NextResponse(null, { status: 404 });
    }
    throw error;
  }
}
