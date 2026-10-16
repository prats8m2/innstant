import {
  dishesOrderedBefore, listOrdersForContext, listOrdersForCustomer, contextForSession,
} from '@/modules/ordering';
import type { OrderSummary } from '@/modules/ordering';
import type { Tx } from '@/db';
import { requireVisitSession, customerSessionFrom } from '@/lib/api-auth';
import { apiHandler, corsPreflight } from '../../_lib/handler';
import { withVisitContext } from '../../_lib/context';
import type { ApiOrderedBefore } from '@/lib/api-contract';

/**
 * `GET /api/v1/orders/again` — the dishes behind the "Order again" rail.
 *
 * ─── Why it sends ids and the app sends itself the rest ────────────────────
 *
 * The rail is photo cards with prices and a + on each, and every one of those
 * facts belongs to the menu the app is already holding. Sending a second copy
 * of a dish from here would be a second price for it, reachable on the same
 * screen as the first. See `ApiOrderedBefore`.
 *
 * ─── Whose history, and why a visit session is still required ──────────────
 *
 * The same branch `/orders` and `/orders/reorder` make (D-081): signed in, the
 * account's orders across visits; signed out, this visit's own. Read here
 * rather than posted by the app, so the list that decides what to offer is the
 * list the server scoped.
 *
 * A visit session is required even for an account's history, for the reason
 * the reorder route gives: the rail's + writes to a cart, a cart belongs to a
 * visit (#10), and there is no such thing as ordering again into nothing. It
 * is also what pins the tenant, so a customer token minted elsewhere reads
 * nothing here rather than reaching across.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Twelve is a rail somebody flicks through, not a history. The app draws
 *  only the ones still on tonight's menu, so this is the ceiling and rarely
 *  the count. */
const RAIL_LIMIT = 12;

async function historyFor(
  tx: Tx,
  request: Request,
  session: Awaited<ReturnType<typeof requireVisitSession>>,
): Promise<readonly OrderSummary[]> {
  const customer = await customerSessionFrom(request);
  if (customer) return listOrdersForCustomer(tx, { guestId: customer.guestId });
  return listOrdersForContext(tx, { context: contextForSession(session) });
}

export const GET = apiHandler(
  '/api/v1/orders/again',
  async (request): Promise<ApiOrderedBefore> => {
    const session = await requireVisitSession(request);

    return withVisitContext(session, async (tx) => {
      const history = await historyFor(tx, request, session);
      return {
        menuItemIds: await dishesOrderedBefore(tx, { history, limit: RAIL_LIMIT }),
      };
    });
  },
);

export const OPTIONS = corsPreflight;
