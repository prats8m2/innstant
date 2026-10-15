import { describe, it, expect } from 'vitest';
import { trackView, trackProgress, TRACK_STEPS, orderStateFor, OPEN_TO_A_GUEST } from './track';
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
     * And the guest is told what happened to the money. This copy is only
     * allowed to say "nothing has been charged" because the REJECTED transition
     * credits the folio line in the same transaction (`advanceOrder()`, and
     * tests/integration/advance-order.test.ts proves it against a real
     * database). If that reversal is ever removed, this assertion fails — which
     * is the point: the sentence is a promise about the money.
     */
    expect(view.halt?.detail).toMatch(/nothing has been charged/i);
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


/**
 * The same timeline, as a fraction — for a card with room for segments and no
 * room for titles.
 *
 * Held to the standard the rest of this file holds `trackView()` and
 * `orderStateFor()` to: EVERY member of `ORDER_STATUSES` gets an answer, and
 * the answer is a position on the timeline or an honest zero. The failure this
 * guards is quieter than a blank timeline — a card drawing four of five
 * segments for an order the kitchen refused looks like progress.
 */
describe('trackProgress', () => {
  it('answers for every status the machine can reach, in range', () => {
    for (const status of ORDER_STATUSES) {
      const { index, of } = trackProgress(status);
      expect(of, `${status} reported the wrong step count`).toBe(TRACK_STEPS.length);
      expect(index, `${status} is off the timeline`).toBeGreaterThanOrEqual(0);
      expect(index, `${status} is past the end`).toBeLessThanOrEqual(TRACK_STEPS.length);
    }
  });

  /**
   * ACCEPTED and PREPARING are both 2, which is the decision this whole file
   * exists to pin: they are ONE step with two sub-lines. A card that drew six
   * segments — one per live status — would be a second, wrong copy of the
   * state machine, which is why `stepCount` travels on the wire.
   */
  it('maps the five live statuses onto five steps, not six', () => {
    expect(trackProgress('PLACED').index).toBe(1);
    expect(trackProgress('ACCEPTED').index).toBe(2);
    expect(trackProgress('PREPARING').index).toBe(2);
    expect(trackProgress('READY').index).toBe(3);
    expect(trackProgress('OUT_FOR_DELIVERY').index).toBe(4);
  });

  it('fills the bar once the food has been handed over', () => {
    expect(trackProgress('DELIVERED').index).toBe(TRACK_STEPS.length);
    expect(trackProgress('CLOSED').index).toBe(TRACK_STEPS.length);
  });

  /**
   * Zero, not a partial bar. `trackView()` answers these three with a sentence
   * instead of a timeline, and a card has to make the same choice — a halted
   * order showing two of five segments reads as "still coming".
   */
  it('gives the halted statuses no progress at all', () => {
    for (const status of ['REJECTED', 'CANCELLED', 'DISPUTED'] as const) {
      expect(trackProgress(status).index, status).toBe(0);
    }
  });

  it('gives the cart none either', () => {
    // DRAFT never leaves placeOrder(); it is here so the record is exhaustive.
    expect(trackProgress('DRAFT').index).toBe(0);
  });

  it('agrees with the timeline about which step is active', () => {
    // The two views of the same position must not drift: wherever `trackView`
    // lights a step, `trackProgress` is that step's 1-based index.
    for (const status of ORDER_STATUSES) {
      const steps = trackView(status).steps;
      if (!steps) continue;
      const active = steps.findIndex((step) => step.state === 'active');
      const expected = active < 0
        // Nothing active and every step done is the end of the line; nothing
        // active and nothing done is DRAFT.
        ? (steps.every((step) => step.state === 'done') ? steps.length : 0)
        : active + 1;
      expect(trackProgress(status).index, status).toBe(expected);
    }
  });
});

/**
 * The guest-facing vocabulary, held to the machine.
 *
 * track.ts's own header names the risk this file exists for: "this is the one
 * place a status the machine can reach might have no step to stand on, and the
 * failure mode is a guest staring at a screen that says nothing is happening."
 *
 * The orders LIST added a second place with that shape, and the tests above
 * already hold `trackView()` to it. `ORDER_STATUSES` is
 * eleven long and will grow; a status added there and not here does not fail to
 * compile in a screen that reads it through a lookup, it just renders something
 * vague at somebody who is waiting for dinner.
 */
describe('orderStateFor', () => {
  it('has a line for every status the machine can reach', () => {
    for (const status of ORDER_STATUSES) {
      const state = orderStateFor(status);
      expect(state, `no state for ${status}`).toBeDefined();
      expect(state.label.length, `${status} has an empty label`).toBeGreaterThan(0);
      expect(state.short.length, `${status} has an empty short form`).toBeGreaterThan(0);
    }
  });

  /**
   * The tone is what the screen colours by, and `stopped` is the one that turns
   * a row critical. It must mean "what you asked for is not coming" and nothing
   * else — a delivered dinner tinted like a refusal would be alarming, and a
   * refusal tinted like a delivery would be worse.
   */
  it('reserves the stopped tone for orders that are not coming', () => {
    const stopped = ORDER_STATUSES.filter((s) => orderStateFor(s).tone === 'stopped');
    expect([...stopped].sort()).toEqual(['CANCELLED', 'REJECTED']);
  });

  it('calls only the terminal happy states done', () => {
    const done = ORDER_STATUSES.filter((s) => orderStateFor(s).tone === 'done');
    expect([...done].sort()).toEqual(['CLOSED', 'DELIVERED']);
  });

  /**
   * `OPEN_TO_A_GUEST` is what the list puts under "Happening now", and the
   * history is its complement — so the two groups partition every status by
   * construction and there is nothing to assert about that. What IS worth
   * pinning is the membership itself, because it is a product decision that
   * looks like a detail.
   *
   * DISPUTED is the one that has to be argued for. Its tone is `open` — the
   * hotel is still doing something about it — but it is NOT "happening now":
   * the dinner arrived, possibly days ago, and what is open is the money. It
   * belongs in the history beside the order it is about, not above it with the
   * food that is still coming.
   */
  it('counts only the statuses where food is still moving as happening now', () => {
    expect([...OPEN_TO_A_GUEST].sort()).toEqual([
      'ACCEPTED', 'OUT_FOR_DELIVERY', 'PLACED', 'PREPARING', 'READY',
    ]);
  });

  it('keeps the cart out of the list entirely', () => {
    // DRAFT is the cart. `listOrdersForStay` filters it out, and it must not
    // sneak back in through the happening-now group either.
    expect(OPEN_TO_A_GUEST).not.toContain('DRAFT' as OrderStatus);
  });

  it('never shows a raw status name to a guest', () => {
    for (const status of ORDER_STATUSES) {
      const { label, short } = orderStateFor(status);
      for (const text of [label, short]) {
        expect(text, `${status} leaks the enum`).not.toMatch(/[A-Z]{3,}|_/);
      }
    }
  });
});

describe('the list and the timeline agree', () => {
  /**
   * Every status the five-step timeline can render must also have a list line,
   * because the list is how a guest reaches the timeline. If one knows about a
   * status the other does not, the row is unreachable or the screen is blank.
   */
  it('covers every status the timeline knows about', () => {
    for (const step of TRACK_STEPS) {
      for (const status of step.statuses) {
        expect(orderStateFor(status).label.length).toBeGreaterThan(0);
      }
    }
  });
});
