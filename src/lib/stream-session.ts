import type { NextRequest } from 'next/server';
import { can, resolveStaffSession, STAFF_SESSION_COOKIE, type Permission } from '@/modules/identity';
import { logger } from '@/lib/logger';

/**
 * Is the session that opened this stream still good?
 *
 * A stream is authorized once, when it opens — and then stays open for hours on
 * a kitchen tablet. Signing out revokes the session row, but a check made at
 * connect time cannot see that, so before this a signed-out screen kept
 * receiving the kitchen's feed until the tab was closed. Each stream now asks
 * again on its heartbeat and, when the answer is no, says `signed-out` and
 * closes; the client then re-renders the page, which sends it to the sign-in
 * form.
 *
 * The cookie VALUE is captured at connect: `cookies()` is not available once
 * the response has started, and the question is about the session this stream
 * was opened with — not whichever account the browser holds now.
 *
 * A database error answers yes. Dropping every kitchen's feed because one
 * query timed out is worse than a revoked session living one heartbeat longer.
 */
export function streamSessionCheck(
  request: NextRequest,
  propertyId: string,
  /** Null when the stream needs only membership of the property. */
  permission: Permission | null,
): () => Promise<boolean> {
  const cookieValue = request.cookies.get(STAFF_SESSION_COOKIE)?.value;
  return async () => {
    try {
      const session = await resolveStaffSession(cookieValue);
      if (!session) return false;
      return permission ? can(session, propertyId, permission) : session.properties.has(propertyId);
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'stream session check failed; keeping the stream');
      return true;
    }
  };
}
