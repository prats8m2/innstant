import { describe, it, expect } from 'vitest';
import { trackView, TRACK_STEPS } from './track';
import { ORDER_STATUSES, type OrderStatus } from './transitions';

/**
 * The guest's view of the state machine.
 *
 * CLAUDE.md asks for a unit test on every transition; these are the same
 * transitions read from the other side. The one that matters most is the last
 * test in the file: every status the machine can reach has to produce a screen
 * that says something, and a status added to transitions.ts without a step here
 * would otherwise ship as a timeline with nothing lit on it.
 */
const at = (iso: string) => new Date(iso);

describe('trackView', () => {
  it('lights the first step and nothing else when the order has just been placed', () => {
    const view = trackView('PLACED', { placedAt: at('2026-09-01T18:00:00Z') });

    expect(view.halt).toBeNull();
    expect(view.live).toBe(true);
    expect(view.steps?.map((s) => s.state)).toEqual([
      'active', 'pending', 'pending', 'pending', 'pending',
    ]);
    expect(view.steps?.[0]?.at).toEqual(at('2026-09-01T18:00:00Z'));
  });

  it('treats ACCEPTED and PREPARING as one step with different words', () => {
    const accepted = trackView('ACCEPTED', { acceptedAt: at('2026-09-01T18:02:00Z') });
    const preparing = trackView('PREPARING', { acceptedAt: at('2026-09-01T18:02:00Z') });

    expect(accepted.steps?.map((s) => s.state)).toEqual([
      'done', 'active', 'pending', 'pending', 'pending',
    ]);
    expect(preparing.steps?.map((s) => s.state)).toEqual(accepted.steps?.map((s) => s.state));

    const acceptedSub = accepted.steps?.[1]?.sub;
    const preparingSub = preparing.steps?.[1]?.sub;
    expect(acceptedSub).not.toEqual(preparingSub);
    // The difference a guest actually cares about: is a pan on.
    expect(preparingSub).toMatch(/cooking/i);
  });

  it('does not repeat the current status as the line under every finished step', () => {
    const view = trackView('OUT_FOR_DELIVERY', {
      placedAt: at('2026-09-01T18:00:00Z'),
      acceptedAt: at('2026-09-01T18:02:00Z'),
      readyAt: at('2026-09-01T18:20:00Z'),
      outForDeliveryAt: at('2026-09-01T18:22:00Z'),
    });

    const subs = view.steps?.slice(0, 4).map((s) => s.sub) ?? [];
    expect(new Set(subs).size).toBe(subs.length);
  });

  it('closes the stream once the tray is at the door', () => {
    expect(trackView('READY').live).toBe(true);
    expect(trackView('DELIVERED', { deliveredAt: at('2026-09-01T18:30:00Z') }).live).toBe(false);
    expect(trackView('CLOSED', { closedAt: at('2026-09-01T22:00:00Z') }).live).toBe(false);
  });

  it('shows no time against a step that has not happened', () => {
    const view = trackView('PLACED', {
      placedAt: at('2026-09-01T18:00:00Z'),
      // Out of order on purpose: a correction can stamp backwards, and a guest
      // must not read a delivery time for a tray still on the pass.
      deliveredAt: at('2026-09-01T18:30:00Z'),
    });

    expect(view.steps?.filter((s) => s.state === 'pending').every((s) => s.at === null)).toBe(true);
  });

  it('falls back to the later stamp when the earlier one was skipped', () => {
    // A kitchen that taps straight to Preparing leaves accepted_at null.
    const view = trackView('PREPARING', { preparingAt: at('2026-09-01T18:05:00Z') });
    expect(view.steps?.[1]?.at).toEqual(at('2026-09-01T18:05:00Z'));
  });

  it('replaces the timeline with one sentence and the reason when the kitchen says no', () => {
    const view = trackView('REJECTED', {}, 'Out of sole tonight.');

    expect(view.steps).toBeNull();
    expect(view.live).toBe(false);
    expect(view.halt?.reason).toBe('Out of sole tonight.');
    /**
     * And the guest is told what happens to the money — because something DID
     * happen to it. `placeOrder()` posts the folio line at placement and
     * nothing reverses it on rejection, so this copy may not say "nothing has
     * been charged". When a rejection learns to void its own line, this
     * assertion is the one to change, and it should be changed deliberately.
     */
    expect(view.halt?.detail).toMatch(/folio/i);
    expect(view.halt?.detail).not.toMatch(/nothing has been charged/i);
  });

  it('halts on CANCELLED and DISPUTED too, carrying the reason given', () => {
    expect(trackView('CANCELLED', {}, 'Guest changed their mind.').halt?.reason)
      .toBe('Guest changed their mind.');
    expect(trackView('DISPUTED').halt).not.toBeNull();
    expect(trackView('DISPUTED').steps).toBeNull();
  });

  it('says something for every status the machine can reach', () => {
    for (const status of ORDER_STATUSES as readonly OrderStatus[]) {
      const view = trackView(status);
      const lit = view.steps?.some((s) => s.state !== 'pending') ?? false;

      // Either a halt panel, or a timeline with a step on it. DRAFT is the one
      // status with neither, and it never leaves placeOrder().
      if (status === 'DRAFT') {
        expect(view.halt, 'DRAFT').toBeNull();
        expect(lit, 'DRAFT should light nothing').toBe(false);
        continue;
      }
      expect(view.halt !== null || lit, `${status} shows the guest nothing`).toBe(true);
    }
  });

  it('keeps the reference’s five steps, in the reference’s order', () => {
    expect(TRACK_STEPS.map((s) => s.title)).toEqual([
      'Order received',
      'In the kitchen',
      'Plated and covered',
      'On the way up',
      'At your door',
    ]);
  });
});
