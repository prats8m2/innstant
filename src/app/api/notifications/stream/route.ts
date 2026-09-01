import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { subscribeToChannel, type Subscription } from '@/db';
import { getStaffSession } from '@/lib/auth-context';
import { NOTIFICATION_CHANNEL, type StaffNotifiedPayload } from '@/modules/notifications';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';
import { requestLogger } from '@/lib/logger';

/**
 * One member of staff's alerts. `LISTEN/NOTIFY` → SSE.
 *
 * The fourth staff stream, and D-026's rule applies unchanged: the transport is
 * shared (`useLiveRefresh` on the client) and the authorize-and-filter pair is
 * written out here where the blast radius of getting it wrong reads in one
 * screen.
 *
 * ─── What is different about this one ──────────────────────────────────────
 *
 * Every other stream filters on the PROPERTY: everyone standing at the pass
 * should see every ticket. This one filters on the RECIPIENT as well, because
 * an alert is addressed to a person. A duty manager's escalations are not the
 * night porter's business, and a filter that dropped the staff id would put
 * them on every bell in the hotel.
 *
 * Which is also why the check here is a session and a property, not a
 * permission. There is no `notification:read` and there should not be: the
 * question is not "may this role read alerts" but "is this your alert", and the
 * answer is the staff id in the session cookie — not anything a caller sends.
 *
 * A nudge, not the data. The bell re-reads through RLS on `router.refresh()`.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEARTBEAT_MS = 25_000;

const Query = z.object({ propertyId: z.uuid() });

export async function GET(request: NextRequest): Promise<Response> {
  const reqId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
  const log = requestLogger(reqId, { route: '/api/notifications/stream' });

  const parsed = Query.safeParse({
    propertyId: request.nextUrl.searchParams.get('propertyId'),
  });
  if (!parsed.success) {
    return Response.json({ code: 'VALIDATION', message: 'Which property?' }, { status: 422 });
  }

  const propertyId = parsed.data.propertyId;

  /**
   * 401 rather than a redirect, and a plain 404 for a property this account
   * cannot see — the same two rules the rest of the product follows.
   * `EventSource` cannot follow a redirect usefully; a 302 to the login made
   * the guest streams retry in a loop before they were fixed the same way.
   */
  const session = await getStaffSession();
  if (!session) {
    return Response.json({ code: 'UNAUTHENTICATED', message: 'Sign in first.' }, { status: 401 });
  }
  if (!session.properties.has(propertyId)) {
    return Response.json({ code: 'NOT_FOUND', message: 'No such property.' }, { status: 404 });
  }

  const staffUserId = session.staffUserId;

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

      subscription = subscribeToChannel(NOTIFICATION_CHANNEL, (payload) => {
        const notified = payload as StaffNotifiedPayload;
        // Every process listening on this database hears every property, and
        // every member of staff. Both halves of the filter are load-bearing.
        if (notified?.propertyId !== propertyId) return;
        if (notified?.recipientStaffId !== staffUserId) return;
        send('notification', { at: new Date().toISOString() });
      });

      subscription.ready.then(() => {
        send('ready', { propertyId, at: new Date().toISOString() });
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

      log.info({ propertyId, staffUserId }, 'notification stream opened');
    },

    cancel() {
      subscription?.unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      log.info({ propertyId, staffUserId }, 'notification stream closed');
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
