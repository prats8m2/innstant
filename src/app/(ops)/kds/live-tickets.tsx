'use client';

import { useEffect, useRef } from 'react';
import { useLiveRefresh } from '@/components/live-refresh';
import styles from './kds.module.css';

/**
 * The live half of the kitchen display, and the sound it makes.
 *
 * The transport is shared (`useLiveRefresh`); what stays here is what a cook
 * sees and hears. `EventSource` reconnecting on its own is most of why this is
 * SSE and not a websocket — a tablet spends its evening on hotel wifi.
 */
export function LiveTickets({
  propertyId,
  /** Tickets nobody has accepted yet. Drives the alert. */
  unacknowledged,
}: {
  propertyId: string;
  unacknowledged: number;
}) {
  const { connected } = useLiveRefresh({
    streamUrl: `/api/kds/stream?propertyId=${encodeURIComponent(propertyId)}`,
    eventName: 'order',
  });

  useKitchenAlert(unacknowledged);

  return (
    <span className={styles.live} data-connected={connected}>
      <span className={styles.liveDot} aria-hidden="true" />
      {connected ? 'Live' : 'Reconnecting'}
    </span>
  );
}

/**
 * A sound when a new ticket lands.
 *
 * ─── Why it is synthesised rather than an audio file ───────────────────────
 *
 * Two beeps from an oscillator need no asset, no CDN and no R2 bucket — which
 * is the difference between this working today and waiting on image hosting.
 * It is also two lines to change the pitch if a kitchen finds it shrill.
 *
 * ─── Why it can fail, and why that is fine ─────────────────────────────────
 *
 * Browsers refuse to start audio until the page has been interacted with. A
 * kitchen tablet has been tapped — someone signed in on it — so the context
 * usually resumes; when it does not, the count in the header is still there and
 * still growing. The alert is the second channel, never the only one, and every
 * call here is wrapped because an AudioContext that throws must not take the
 * board down with it.
 *
 * It fires on a RISE in the unacknowledged count, not on every event: a cook
 * accepting one ticket while another arrives should hear one sound, and a board
 * refreshing for a bump three tables away should hear none.
 */
function useKitchenAlert(unacknowledged: number): void {
  const previous = useRef<number | null>(null);
  const context = useRef<AudioContext | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = unacknowledged;

    // First render: whatever is on the board was already there. Announcing a
    // backlog to someone who just walked up to the screen is noise.
    if (before === null || unacknowledged <= before) return;

    try {
      context.current ??= new AudioContext();
      const ctx = context.current;
      // Suspended after a page load without a gesture; resuming is a promise
      // that can reject, and a rejection here is not worth a console error.
      void ctx.resume().catch(() => {});

      const now = ctx.currentTime;
      for (const [i, frequency] of [880, 1174.7].entries()) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        // A short envelope rather than a square edge: a clean on/off click is
        // what makes a beep sound cheap and makes people mute it.
        const start = now + i * 0.18;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);

        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.18);
      }
    } catch {
      // No audio on this device, or the context is in a state that refuses.
      // The visible count is the alert that always works.
    }
  }, [unacknowledged]);

  // Nothing to tear down per render — the context is reused for the life of the
  // screen, which is the whole evening.
  useEffect(() => () => { void context.current?.close().catch(() => {}); }, []);
}
