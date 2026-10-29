import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { subscribeToChannel, type Subscription } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { REQUEST_CHANNEL, type RequestChangedPayload } from '@/modules/requests';
import { httpStatusFor, publicPayloadFor } from '@/lib/errors';
import { streamSessionCheck } from '@/lib/stream-session';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';
import { requestLogger } from '@/lib/logger';

/**
 * The service-request feed for a staff board. `LISTEN/NOTIFY` → SSE.
 *
 * The third stream in the product, and the point at which D-026's own note
 * applies: the transport is shared (`useLiveRefresh` on the client), and what
 * stays per-route is the authorize step and the filter — which here is
 * `request:read` at the property, not `order:read`.
 *
 * A nudge, not the data: the id, the number, the floor and the new status. The
 * board re-reads through RLS and its own permission check, so a subscription
 * cannot become a way to read a request the viewer could not have loaded.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 25_000;

const Query = z.object({ propertyId: z.uuid() });

export async function GET(request: NextRequest): Promise<Response> {
  const reqId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
  const log = requestLogger(reqId, { route: '/api/requests/stream' });

  const parsed = Query.safeParse({
    propertyId: request.nextUrl.searchParams.get('propertyId'),
  });
  if (!parsed.success) {
    return Response.json({ code: 'VALIDATION', message: 'Which property?' }, { status: 422 });
  }

  const propertyId = parsed.data.propertyId;

  try {
    // The same check the board makes. A stream is a read, authorized like one.
    await requirePermission(propertyId, 'request:read');
  } catch (error) {
    return Response.json(publicPayloadFor(error), { status: httpStatusFor(error) });
  }

  const stillAllowed = streamSessionCheck(request, propertyId, 'request:read');
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
          cleanup();
        }
      };

      controller.enqueue(encoder.encode('retry: 3000\n\n'));

      subscription = subscribeToChannel(REQUEST_CHANNEL, (payload) => {
        const change = payload as RequestChangedPayload;
        // Every process listening on this database hears every property.
        if (change?.propertyId !== propertyId) return;
        send('request', {
          requestId: change.requestId,
          requestNumber: change.requestNumber,
          floorId: change.floorId,
          status: change.status,
        });
      });

      subscription.ready.then(() => {
        send('ready', { propertyId, at: new Date().toISOString() });
      });

      // The heartbeat also re-asks whether the session is still good — a
      // stream outlives a sign-out otherwise (see `streamSessionCheck`).
      heartbeat = setInterval(() => {
        void stillAllowed().then((ok) => {
          if (!heartbeat) return;
          if (ok) {
            try {
              controller.enqueue(encoder.encode(': keep-alive\n\n'));
            } catch {
              cleanup();
            }
            return;
          }
          send('signed-out', {});
          cleanup();
          try {
            controller.close();
          } catch {
            // Already closed by the runtime.
          }
        });
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

      log.info({ propertyId }, 'request stream opened');
    },

    cancel() {
      subscription?.unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      log.info({ propertyId }, 'request stream closed');
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      [REQUEST_ID_HEADER]: reqId,
    },
  });
}
