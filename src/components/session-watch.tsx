'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const CHANNEL = 'innstant-staff-session';

/**
 * Keeps every tab of one browser on the same account.
 *
 * The session is one cookie per browser, so signing out in one tab — or
 * signing in as somebody else — changes it for every tab at once. The tabs
 * that did not do it kept drawing the old person's screen, and their buttons
 * then acted as the new one (or as nobody). Each staff screen now says who it
 * was rendered for when it mounts; a tab that hears a different answer
 * re-renders, which either shows it as the new person or sends it to the
 * sign-in form.
 *
 * The sign-in page mounts this with `null`, so arriving there after signing
 * out is itself the announcement — after the session is revoked, not before,
 * which a click handler on the button could not promise.
 *
 * Only an id crosses the channel, and only between tabs of the same origin.
 * A browser without BroadcastChannel gets the stream-side check alone, which
 * is slower but just as true.
 */
export function SessionWatch({ staffUserId }: { staffUserId: string | null }) {
  const router = useRouter();

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<{ staffUserId: string | null }>) => {
      if (event.data?.staffUserId !== staffUserId) router.refresh();
    };
    channel.postMessage({ staffUserId });
    return () => channel.close();
  }, [staffUserId, router]);

  return null;
}
