import { findVisit } from '@/modules/visit';
import { NotFoundError } from '@/lib/errors';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler } from '../../_lib/handler';
import { withVisitContext } from '../../_lib/context';
import { apiVisit } from '../../_lib/serialise';
import type { ApiSession } from '@/lib/api-contract';

/**
 * `GET /api/v1/visits/current` — is the stored token still good? D-080.
 *
 * The app calls this on every cold start. Three things can have happened since
 * it last ran, and all three come back as a 401 that the app answers by sending
 * somebody back to the link:
 *
 *   · the six-hour window lapsed (`VISIT_WINDOW_HOURS`)
 *   · the visit was closed
 *   · the session was revoked
 *
 * That is `resolveVisitSession()` doing exactly what it does for a browser
 * (#10) — a stale credential resolves to nothing rather than to a half-working
 * screen, and the app finds out before it renders a menu somebody cannot order
 * from.
 *
 * **No token comes back.** Re-issuing one here would turn a read into a
 * refresh, and a session whose expiry moves every time the app is opened never
 * expires at all.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiHandler('/api/v1/visits/current', async (request): Promise<ApiSession> => {
  const session = await requireVisitSession(request);

  return withVisitContext(session, async (tx, ctx) => {
    const visit = await findVisit(tx, session.visitId);
    // The session resolved, so the visit is OPEN and this cannot be null —
    // unless somebody deleted the row underneath us, which is a 404 rather
    // than a crash.
    if (!visit) throw new NotFoundError('This order session has ended. Open the link again.');

    return {
      visit: apiVisit(visit),
      outlet: ctx.apiOutlet,
      property: ctx.apiProperty,
      linkKind: visit.linkKind ?? 'ONLINE',
    };
  });
});
