import { z } from 'zod';
import {
  getOrderForContext, trackView, trackEta, contextForSession,
} from '@/modules/ordering';
import { findVisit, destinationLabelFor } from '@/modules/visit';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler } from '../../_lib/handler';
import { withVisitContext } from '../../_lib/context';
import { apiOrder, paymentLineFor } from '../../_lib/serialise';
import type { ApiOrder } from '@/lib/api-contract';

/**
 * `GET /api/v1/orders/{orderId}` — one order, and its timeline. D-080.
 *
 * ─── The state machine stays on the server ─────────────────────────────────
 *
 * `trackView()` and `trackEta()` run here, and the app receives steps that are
 * already decided: which one is active, what each says, when it happened, and
 * whether the whole thing is still moving. A React Native reimplementation
 * would be a second copy of an order state machine — unit-tested in one place
 * and not the other, and free to disagree with the kitchen about what READY
 * means. CLAUDE.md's "use a library for a solved problem" argument, one layer
 * up: the solved problem here is our own, and the answer is to send the result
 * rather than the inputs.
 *
 * It is also what makes `isLive` trustworthy. The app polls only while that is
 * true, so a finished order stops costing a request — and an order the kitchen
 * rejected stops polling immediately rather than after a timeout.
 *
 * ─── Scoped by context, because the id travels in a URL ────────────────────
 *
 * `getOrderForContext` matches on the visit as well as the id. RLS confines
 * this to the tenant; the context check confines it to the one customer. An
 * order id from the next table is a 404, not somebody else's dinner.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const OrderId = z.uuid();

export const GET = apiHandler('/api/v1/orders/[orderId]', async (request): Promise<ApiOrder> => {
  const session = await requireVisitSession(request);

  const segments = new URL(request.url).pathname.split('/');
  const parsed = OrderId.safeParse(segments.at(-1));
  if (!parsed.success) throw new ValidationError('That is not an order.');

  return withVisitContext(session, async (tx) => {
    const order = await getOrderForContext(tx, {
      context: contextForSession(session),
      orderId: parsed.data,
    });
    if (!order) throw new NotFoundError('That order is not one of yours.');

    const visit = await findVisit(tx, session.visitId);

    // D-080 — the timeline is worded for where the food is going. Without
    // this a delivery reads "On the way up" and "No bell after 10", which is
    // hotel-corridor copy shown to somebody standing on a pavement.
    const fulfilment = visit?.fulfilment ?? 'TAKEAWAY';

    return apiOrder(
      order,
      trackView(order.status, order, order.haltReason, fulfilment),
      trackEta(order.status, order.promisedByAt, order),
      {
        /**
         * The visit's CURRENT destination, not the order's snapshot.
         *
         * The snapshot on the order is the kitchen's copy, frozen at placement
         * and phrased for a cook. This is the customer's own screen, and they
         * know their address — what they need back is confirmation it went to
         * the right place, in the words they would use. The web tracking screen
         * makes the same distinction for the same reason.
         */
        destination: visit ? destinationLabelFor(visit) : order.orderNumber,
        fulfilment,
        paymentLine: paymentLineFor(fulfilment),
      },
    );
  });
});
