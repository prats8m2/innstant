'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * An SSE stream that refreshes a server-rendered page.
 *
 * Every live surface in the product works the same way: the page is rendered on
 * the server, the stream carries a nudge rather than state, and the client's
 * only job is to call `router.refresh()` when something moved. A screen that
 * missed an hour of events is then correct after one refresh, instead of
 * correct-looking and built from events it may not have received.
 *
 * This is the shared half — the transport. What each surface does NOT share is
 * the authorization and the filter on its stream, which stay in the route
 * handler where they can be read in one screen (D-026). The KDS and the runner
 * queue subscribe to the same `/api/kds/stream` because they are the same read
 * for the same outlet under the same permission; the guest has its own route.
 *
 * Returns `connected`, which is for telling the truth on screen — not for
 * gating anything. EventSource reconnects on its own.
 */
export function useLiveRefresh({
  streamUrl,
  /**
   * The SSE event name that means "something moved".
   *
   * Named per surface — `order` from the kitchen's stream, `request` from the
   * floor board's — because a stream that says what changed is easier to read in
   * a network tab than one that says `message`. It defaulted to `order` when
   * this hook served one caller, and the floor board then connected, saw
   * nothing, and looked broken: the stream was delivering `request` events
   * nobody was listening for. There is no default now, so the next surface
   * cannot make the same mistake silently.
   */
  eventName,
  /** Coalescing window. A kitchen bumping two states in one breath is one
   *  re-render, and 250ms is well under what reads as a delay. */
  coalesceMs = 250,
}: {
  streamUrl: string;
  eventName: string;
  coalesceMs?: number;
}): { connected: boolean } {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  // A ref, not state: changing it must not re-render and tear the stream down.
  const pending = useRef<number | null>(null);

  useEffect(() => {
    const source = new EventSource(streamUrl);

    source.addEventListener('ready', () => {
      setConnected(true);
      // The server sends `ready` only once the database is actually LISTENing,
      // so this load covers anything that happened while it was connecting.
      router.refresh();
    });

    source.addEventListener(eventName, () => {
      if (pending.current !== null) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        router.refresh();
      }, coalesceMs);
    });

    source.onerror = () => {
      setConnected(false);
    };

    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current);
      source.close();
    };
  }, [streamUrl, eventName, coalesceMs, router]);

  return { connected };
}
