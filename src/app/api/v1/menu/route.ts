import { getMenu } from '@/modules/catalog';
import { NotFoundError } from '@/lib/errors';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler } from '../_lib/handler';
import { withVisitContext } from '../_lib/context';
import { apiSection } from '../_lib/serialise';
import type { ApiMenu } from '@/lib/api-contract';

/**
 * `GET /api/v1/menu` — the whole menu for this link's outlet. D-080.
 *
 * ─── The outlet is read, never passed ──────────────────────────────────────
 *
 * It comes from the SESSION, which got it from the link. There is no outlet id
 * in the path or the query, and that is the same rule the web menu follows: an
 * app that could name an outlet could read a rooftop bar's menu through a
 * cafe's link, and a stale client could put a rooftop dish in a cafe's cart.
 *
 * ─── Sent whole, not paged ─────────────────────────────────────────────────
 *
 * A restaurant menu is tens of dishes, not thousands, and the app renders it
 * as one scrolling list with a section rail. Paging it would mean the rail
 * cannot know its own sections until the last page lands, for a payload that
 * is a few tens of kilobytes. The server already assembles it in one read for
 * the web.
 *
 * CLAUDE.md #9 — browsing is never gated. A session is required because there
 * is no other way to know WHICH menu, not as a permission: the session this
 * needs is the one a bare link hands out with nothing asked.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiHandler('/api/v1/menu', async (request): Promise<ApiMenu> => {
  const session = await requireVisitSession(request);

  return withVisitContext(session, async (tx, ctx) => {
    // `ctx.at` is property-local — the collection windows ("After 10pm") and
    // each dish's own schedule are applied against the hotel's clock, never
    // the container's.
    const menu = await getMenu(tx, {
      propertyId: ctx.propertyId,
      outletId: ctx.outletId,
      at: ctx.at,
    });
    if (!menu) throw new NotFoundError('This menu is no longer being served.');

    return {
      outlet: ctx.apiOutlet,
      sections: menu.sections.map(apiSection),
    };
  });
});
