import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { subscribeToChannel, type Subscription } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { REQUEST_CHANNEL, type RequestChangedPayload } from '@/modules/requests';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';
import { requestLogger } from '@/lib/logger';

/**
 * The guest's live feed for one service request.
 *
 * The fourth stream, and the fourth time the same shape has been right: a nudge
 * carrying routing and status, authorized from the credential the surface
 * actually has, filtered to what the viewer may see. The transport is shared
 * (`useLiveRefresh`); this is the authorize-and-filter half that D-026 says
 * stays per route.
 *
 * Filtered on `stay_id` — never `room_id` (#10). Rooms are reused, and the next
 * occupant of 214 must not hear that someone else's towels are on the way.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 25_000;

const Query = z.object({ requestId: z.uuid() });

export async function GET(request: NextRequest): Promise<Response> {
  const reqId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
  const log = requestLogger(reqId, { route: '/api/guest/request-stream' });

  const parsed = Query.safeParse({
    requestId: request.nextUrl.searchParams.get('requestId'),
  });
  if (!parsed.success) {
    return Response.json({ code: 'VALIDATION', message: 'Which request?' }, { status: 422 });
  }

  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);
  // 401, not a redirect: EventSource cannot follow one usefully, and the page
  // that opened this stream already sends an unresolvable session to the scan.
  if (!session) {
    return Response.json({ code: 'UNAUTHENTICATED', message: 'Scan the code again.' },
      { status: 401 });
  }

  const { requestId } = parsed.data;
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
        // These two lines are what make it this guest's one request.
        if (change?.stayId !== session.stayId) return;
        if (change.requestId !== requestId) return;
        send('request', { requestId: change.requestId, status: change.status });
      });

      subscription.ready.then(() => {
        send('ready', { requestId, at: new Date().toISOString() });
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

      log.info({ requestId, stayId: session.stayId }, 'guest request stream opened');
    },

    cancel() {
      subscription?.unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      log.info({ requestId }, 'guest request stream closed');
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
