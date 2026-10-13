import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { subscribeToChannel, type Subscription } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { ORDER_CHANNEL, type OrderChangedPayload } from '@/modules/ordering';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';
import { requestLogger } from '@/lib/logger';

/**
 * The guest's live feed for one order. `LISTEN/NOTIFY` → SSE.
 *
 * The kitchen's stream (`/api/kds/stream`) and this one are deliberately two
 * routes rather than one with a role switch. They authorize from different
 * credentials — a staff session with `order:read` there, a guest session cookie
 * here — and they filter on different keys. One handler doing both is one
 * `if` away from a guest subscribing to a kitchen.
 *
 * ─── What crosses this boundary ────────────────────────────────────────────
 *
 * A nudge, not the data: the order id and its new status, and only for an order
 * belonging to THIS guest's stay. The screen then re-reads the order through
 * `getOrderForContext()` under RLS, so the stream can never become a way to see
 * something the page itself would not have rendered.
 *
 * #10 is the load-bearing filter. The notification carries `stayId`, and the
 * session's `stayId` — never its room — is what it is compared against. Room
 * 214's next guest must not hear about tonight's dinner.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Same as the kitchen's: enough to keep a phone radio and a proxy interested. */
const HEARTBEAT_MS = 25_000;

/**
 * `orderId` is OPTIONAL, and that is a narrowing rather than a permission.
 *
 * The tracking screen watches one order and passes it. The orders LIST watches
 * the whole stay and does not — it needs to hear when any of this room's orders
 * moves, and opening one stream per live order would be N connections from a
 * phone to say the same thing.
 *
 * What makes that safe is that `orderId` was never the security boundary: the
 * session's own context is (#10, and D-079 for the visit half). It is taken
 * from the session and not from the query, and it is checked on every
 * notification either way. Dropping `orderId` widens what a guest hears about
 * their OWN stay or visit and nothing else.
 */
const Query = z.object({ orderId: z.uuid().optional() });

export async function GET(request: NextRequest): Promise<Response> {
  const reqId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
  const log = requestLogger(reqId, { route: '/api/guest/order-stream' });

  const parsed = Query.safeParse({
    orderId: request.nextUrl.searchParams.get('orderId'),
  });
  if (!parsed.success) {
    return Response.json({ code: 'VALIDATION', message: 'Which order?' }, { status: 422 });
  }

  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);
  /**
   * 401, not a redirect. `EventSource` cannot follow one usefully, and the page
   * that opened this stream already redirects an unresolvable session to the
   * scan route — the screen's job here is to stop retrying, not to navigate.
   *
   * Note what is NOT checked: the tier. Watching your own dinner arrive is a
   * read at REQUEST tier (#9). The charge already happened, at the one prompt.
   */
  if (!session) {
    return Response.json({ code: 'UNAUTHENTICATED', message: 'Scan the code again.' },
      { status: 401 });
  }

  const { orderId } = parsed.data;
  const encoder = new TextEncoder();
  let subscription: Subscription | undefined;
  let heartbeat: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        subscription?.unsubscribe();
        subscription = undefined;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
      };

      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The guest closed the tab between the check and the write.
          cleanup();
        }
      };

      // A guest on hotel wifi in a lift reconnects a lot. 3s, same as the
      // kitchen — long enough not to hammer, short enough to feel live.
      controller.enqueue(encoder.encode('retry: 3000\n\n'));

      subscription = subscribeToChannel(ORDER_CHANNEL, (payload) => {
        const change = payload as OrderChangedPayload;
        /**
         * Every process listening on this database hears every order in every
         * hotel. This line is what makes it this guest's own, and it is not
         * optional.
         *
         * D-079 — the session may be bound to a stay or to a visit, and this
         * route serves both: a diner watching their table's order arrive is
         * the same screen as a guest watching a tray come up. The comparison
         * is against whichever id the session HAS, and `mine` is written so
         * that a null on either side can never match a null on the other —
         * two unidentified rows are not the same row.
         */
        const mine = session.kind === 'STAY'
          ? change?.stayId === session.stayId
          : change?.visitId === session.visitId;
        if (!mine) return;
        // This one is the caller's narrowing: one order for the tracking
        // screen, the whole stay for the list.
        if (orderId && change.orderId !== orderId) return;
        send('order', { orderId: change.orderId, status: change.status });
      });

      /**
       * `ready` only once the database is actually LISTENing — the screen loads
       * the timeline when it arrives, so a transition that happened while the
       * stream was opening is covered by the read rather than lost.
       */
      subscription.ready.then(() => {
        send('ready', { orderId: orderId ?? null, at: new Date().toISOString() });
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          cleanup();
        }
      }, HEARTBEAT_MS);
      heartbeat.unref?.();

      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      });

      log.info(
        { orderId, context: session.kind, contextId: session.kind === 'STAY' ? session.stayId : session.visitId },
        'guest order stream opened',
      );
    },

    cancel() {
      subscription?.unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      log.info({ orderId }, 'guest order stream closed');
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Without this a buffering proxy turns a live feed into one batch
      // delivered when the response ends, i.e. never.
      'x-accel-buffering': 'no',
      [REQUEST_ID_HEADER]: reqId,
    },
  });
}
