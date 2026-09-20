import { NextResponse, type NextRequest } from 'next/server';
import { GUEST_SESSION_COOKIE, QrNotUsableError } from '@/modules/access';
import {
  resolveDemoRoomCode, openDemoSession,
  DEMO_NAME_COOKIE, DEMO_FLAG_COOKIE, DEMO_COOKIE_DAYS,
} from '@/modules/demo';

/**
 * The door between the website and the product.
 *
 * A Route Handler for the same reason `/r/{code}` is one: it has to set a
 * cookie, and a Server Component cannot. It picks the room, opens the session,
 * marks it as a demo and hands the visitor to the ordinary guest app — which
 * from that point on has no idea it is being demonstrated, beyond one ribbon.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Nobody has said what to call them yet. Ask first — /demo redirects back
  // here the moment it has an answer.
  if (!request.cookies.get(DEMO_NAME_COOKIE)?.value) {
    return new NextResponse(null, { status: 307, headers: { Location: '/demo' } });
  }

  const code = await resolveDemoRoomCode();
  if (!code) {
    // No seeded property reachable — DEMO_TENANT_ID unset, or the demo data has
    // never been loaded into this database. Say so rather than 404, because the
    // person who needs to read this is whoever deployed it.
    return new NextResponse(null, { status: 307, headers: { Location: '/demo?unavailable=1' } });
  }

  try {
    const demo = await openDemoSession(code, {
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    // Relative, for the same reason `/r/{code}` redirects relatively: under
    // `output: 'standalone'` the server's own host is 0.0.0.0.
    const response = new NextResponse(null, {
      status: 307,
      headers: { Location: demo.home },
    });

    response.cookies.set(GUEST_SESSION_COOKIE, demo.cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: demo.session.expiresAt,
    });

    // Outlives the guest session on purpose: it is what stops the name being
    // asked for again next week, after the session behind it has lapsed.
    response.cookies.set(DEMO_FLAG_COOKIE, '1', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: DEMO_COOKIE_DAYS * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    if (error instanceof QrNotUsableError) {
      // The seeded stay has aged out of its checkout window — `pnpm demo:reset`
      // is the fix, and the visitor should not be shown a bare 404 for it.
      return new NextResponse(null, { status: 307, headers: { Location: '/demo?unavailable=1' } });
    }
    throw error;
  }
}
