import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { withTenant, subscribeToChannel, type Subscription } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { ORDER_CHANNEL, type OrderChangedPayload } from '@/modules/ordering';
import { httpStatusFor, publicPayloadFor } from '@/lib/errors';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';
import { requestLogger } from '@/lib/logger';

/**
 * The kitchen's live feed. `LISTEN/NOTIFY` → SSE.
 *
 * A Route Handler, not a Server Action: this is a long-lived response, and the
 * client is `EventSource`. SSE rather than websockets because the traffic is
 * one-directional — the kitchen reads changes and writes through ordinary form
 * posts — and because SSE reconnects on its own, which matters on a tablet that
 * spends its evening on hotel wifi.
 *
 * ─── What crosses this boundary ────────────────────────────────────────────
 *
 * A nudge, not the data. Each event carries the order id, its number and its
 * new status; the screen re-reads the rail through RLS and its own permission
 * check. That way a subscription cannot become a way to read an order the
 * viewer could not have loaded, and the payload cannot drift out of date.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Comment frames keep proxies and phone radios from closing a quiet stream. */
const HEARTBEAT_MS = 25_000;

const Query = z.object({ propertyId: z.uuid() });

export async function GET(request: NextRequest): Promise<Response> {
  const reqId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
  const log = requestLogger(reqId, { route: '/api/kds/stream' });

  const parsed = Query.safeParse({
    propertyId: request.nextUrl.searchParams.get('propertyId'),
  });
  if (!parsed.success) {
    return Response.json({ code: 'VALIDATION', message: 'Which property?' }, { status: 422 });
  }

  let outletId: string;
  try {
    // The same check the KDS page makes. A stream is a read, and it is
    // authorized exactly like one — the middleware is only a turnstile
    // (src/middleware.ts), and this route is not even behind it.
    const session = await requirePermission(parsed.data.propertyId, 'order:read');

    const outlet = await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      (tx) => getInRoomDiningOutletConfig(tx, parsed.data.propertyId),
    );
    if (!outlet) {
      return Response.json({ code: 'NOT_FOUND', message: 'No kitchen here.' }, { status: 404 });
    }
    outletId = outlet.id;
  } catch (error) {
    return Response.json(publicPayloadFor(error), { status: httpStatusFor(error) });
  }

  const encoder = new TextEncoder();
  let subscription: Subscription | undefined;
  let heartbeat: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The client vanished between the check and the write. Nothing to
          // do but stop, and cleanup below handles it.
          cleanup();
        }
      };

      const cleanup = () => {
        subscription?.unsubscribe();
        subscription = undefined;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
      };

      // `retry:` tells EventSource how long to wait before reconnecting. The
      // default is 3s in some browsers and unspecified in others; a kitchen
      // tablet coming back from a dead spot should not hammer.
      controller.enqueue(encoder.encode('retry: 3000\n\n'));

      subscription = subscribeToChannel(ORDER_CHANNEL, (payload) => {
        const change = payload as OrderChangedPayload;
        // Every process listening on this database hears every notification.
        // This is where it becomes THIS kitchen's feed.
        if (change?.outletId !== outletId) return;
        send('order', {
          orderId: change.orderId,
          orderNumber: change.orderNumber,
          status: change.status,
        });
      });

      /**
       * `ready` is sent only once the database is actually LISTENing, and the
       * screen loads its rail when it arrives. Anything that happens in between
       * is then covered by the load rather than lost — the alternative is a
       * kitchen that opens its screen as an order lands and never sees it.
       */
      subscription.ready.then(() => {
        send('ready', { outletId, at: new Date().toISOString() });
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

      log.info({ outletId }, 'kds stream opened');
    },

    cancel() {
      subscription?.unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      log.info({ outletId }, 'kds stream closed');
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx and friends buffer by default, which turns a live feed into a
      // batch delivered when the response ends — i.e. never.
      'x-accel-buffering': 'no',
      [REQUEST_ID_HEADER]: reqId,
    },
  });
}
