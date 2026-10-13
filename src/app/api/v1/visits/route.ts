import { z } from 'zod';
import { withTenant } from '@/db';
import { scanVisitLink, QrNotUsableError } from '@/modules/access';
import { findVisit } from '@/modules/visit';
import { NotFoundError } from '@/lib/errors';
import { apiHandler, parseBody } from '../_lib/handler';
import { loadVisitContext } from '../_lib/context';
import { apiVisit } from '../_lib/serialise';
import type { ApiSession } from '@/lib/api-contract';

/**
 * `POST /api/v1/visits` — the app's front door. D-080.
 *
 * The mobile equivalent of opening `/p/{code}` in a browser, and deliberately
 * the same function underneath: `scanVisitLink()` opens the visit, mints the
 * session and writes `guest_session.visit_opened` to the log. What differs is
 * only where the credential goes — a bearer token in the response body instead
 * of a `Set-Cookie` header (see src/lib/api-auth.ts).
 *
 * ─── Why the token comes back in the body ──────────────────────────────────
 *
 * It has to be readable by the app, which stores it and sends it on every
 * later request. That is the one thing `httpOnly` exists to prevent, so a
 * cookie cannot do this job. The value is identical, and so are its lifetime
 * and its revocation: close the visit and this token dies with the browser's.
 *
 * ─── #9 holds here exactly as it does on the web ───────────────────────────
 *
 * Nothing is asked for. No account, no sign-in, no name. A customer who opens
 * this sees a menu, and the one question — a name and a number so the kitchen
 * can ring — comes at checkout, in `POST /api/v1/orders`.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  // Same shape check as `resolveVisitLink` makes before touching the database:
  // this is a public endpoint and it will be fuzzed.
  code: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

export const POST = apiHandler('/api/v1/visits', async (request): Promise<ApiSession> => {
  const { code } = await parseBody(
    request,
    Body,
    'That link did not come through. Scan it again, or ask at the counter.',
  );

  let scan;
  try {
    scan = await scanVisitLink(code, {
      // Behind Railway's proxy the socket address is the proxy. Same header the
      // web route reads, and the same reason: it is what makes a code
      // photographed off a menu board and used from elsewhere visible later.
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: request.headers.get('user-agent') ?? undefined,
    });
  } catch (error) {
    /**
     * Unknown code, revoked link, wrong version — one error and one sentence,
     * exactly as the web dead-end page gives one page for all of them.
     * Somebody probing codes against this endpoint learns nothing from which
     * it was, and this endpoint is far easier to probe than a browser is.
     */
    if (error instanceof QrNotUsableError) {
      throw new NotFoundError(
        'This link is not active. The restaurant may have replaced it — ' +
          'scan the code on your table, or ask at the counter.',
      );
    }
    throw error;
  }

  const session = scan.session;

  return withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      const ctx = await loadVisitContext(tx, session);
      const visit = await findVisit(tx, session.visitId);

      return {
        token: scan.cookieValue,
        visit: apiVisit(visit!),
        outlet: ctx.apiOutlet,
        property: ctx.apiProperty,
        linkKind: scan.linkKind,
      };
    },
  );
});
