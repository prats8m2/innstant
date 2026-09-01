'use client';

import { useEffect, useRef } from 'react';
import { useLiveRefresh } from '@/components/live-refresh';
import styles from './housekeeping.module.css';

/**
 * The live half of the board, and the sound it makes.
 *
 * Same transport as the kitchen and the guest timeline; what is different is
 * what deserves a noise. A new request arriving is worth a sound; a colleague
 * completing one is not. So the alert fires on a rise in UNCLAIMED requests, and
 * a breach gets its own, lower, insistent pair — a housekeeper who hears the
 * difference does not have to look.
 */
export function LiveBoard({
  propertyId,
  breached,
  unclaimed,
}: {
  propertyId: string;
  breached: number;
  unclaimed: number;
}) {
  const { connected } = useLiveRefresh({
    streamUrl: `/api/requests/stream?propertyId=${encodeURIComponent(propertyId)}`,
    eventName: 'request',
  });

  useFloorAlert({ unclaimed, breached });

  return (
    <span className={styles.live} data-connected={connected}>
      <span className={styles.liveDot} aria-hidden="true" />
      {connected ? 'Live' : 'Reconnecting'}
    </span>
  );
}

/**
 * Two sounds, synthesised — no asset, nothing to host, and the pitch is two
 * lines to change if a floor finds it shrill.
 *
 * Every call is wrapped: browsers refuse audio until the page has been
 * interacted with, and an AudioContext that throws must not take the board down.
 * The counts in the header are the channel that always works.
 */
function useFloorAlert({ unclaimed, breached }: { unclaimed: number; breached: number }): void {
  const previous = useRef<{ unclaimed: number; breached: number } | null>(null);
  const context = useRef<AudioContext | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = { unclaimed, breached };

    // First render: whatever is on the board was already there. Announcing a
    // backlog to someone who just opened it is noise.
    if (!before) return;

    const newRequest = unclaimed > before.unclaimed;
    const newBreach = breached > before.breached;
    if (!newRequest && !newBreach) return;

    try {
      context.current ??= new AudioContext();
      const ctx = context.current;
      void ctx.resume().catch(() => {});

      // A breach is lower and doubled — it should not sound like good news.
      const notes = newBreach ? [440, 392, 440] : [784, 1046.5];
      const now = ctx.currentTime;

      for (const [i, frequency] of notes.entries()) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;

        const start = now + i * 0.2;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.16, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);

        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.2);
      }
    } catch {
      // No audio here. The counts are still on screen.
    }
  }, [unclaimed, breached]);

  useEffect(() => () => { void context.current?.close().catch(() => {}); }, []);
}
