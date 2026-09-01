import { describe, it, expect } from 'vitest';
import {
  checkoutOffersFor, checkoutCtaFor, canDecideCheckout, effectiveFeeMinor,
  type CheckoutTier,
} from './checkout-rules';

/**
 * Which checkout changes a guest is offered.
 *
 * Every rule here is property-local, and every one of them is a way the screen
 * would otherwise lie to somebody: selling an hour they already have, selling an
 * hour that has gone, or quoting a duration measured from the wrong checkout
 * time.
 */
const UDAIPUR = 'Asia/Kolkata';

/** Thursday 12 March 2026, 11:00 IST = 05:30 UTC. */
const DUE_OUT_11AM = new Date('2026-03-12T05:30:00Z');
/** Thursday 09:00 IST. */
const THURSDAY_9AM = new Date('2026-03-12T03:30:00Z');

const TIERS: CheckoutTier[] = [
  { id: 'two', hour: 14, note: null, feeMinor: 250_000, currency: 'INR' },
  { id: 'six', hour: 18, note: 'The room is yours all day', feeMinor: 500_000, currency: 'INR' },
];

const offers = (over: Partial<Parameters<typeof checkoutOffersFor>[0]> = {}) =>
  checkoutOffersFor({
    tiers: TIERS,
    scheduledCheckoutAt: DUE_OUT_11AM,
    now: THURSDAY_9AM,
    timeZone: UDAIPUR,
    ...over,
  });

describe('what a guest may be offered', () => {
  it('offers the tiers that are later than they are already due out', () => {
    expect(offers().map((o) => o.title)).toEqual([
      'Late checkout, 2pm', 'Late checkout, 6pm',
    ]);
  });

  it('resolves each one to the hotel\'s own hour on the checkout day', () => {
    const [twoPm] = offers();
    // 14:00 IST on 12 March = 08:30 UTC.
    expect(twoPm!.checkoutAt.toISOString()).toBe('2026-03-12T08:30:00.000Z');
  });

  /**
   * A guest due out at 2pm being sold "late checkout, 2pm" for ₹2,500 is being
   * sold nothing at all.
   */
  it('never sells an hour the guest already has', () => {
    const dueOut2pm = new Date('2026-03-12T08:30:00Z');
    expect(offers({ scheduledCheckoutAt: dueOut2pm }).map((o) => o.hour)).toEqual([18]);
  });

  it('drops a tier equal to the current checkout hour, not just earlier ones', () => {
    const dueOut6pm = new Date('2026-03-12T12:30:00Z');
    expect(offers({ scheduledCheckoutAt: dueOut6pm })).toEqual([]);
  });

  /**
   * At 3pm, "late checkout, 2pm" is an hour that has gone. The desk can still do
   * something about an overstay; a button promising a time in the past cannot.
   */
  it('drops an hour that has already passed today', () => {
    const threePm = new Date('2026-03-12T09:30:00Z');
    expect(offers({ now: threePm }).map((o) => o.hour)).toEqual([18]);
  });

  it('still offers everything the night before', () => {
    const wednesdayMidnight = new Date('2026-03-11T18:45:00Z'); // Thu 00:15 IST
    expect(offers({ now: wednesdayMidnight })).toHaveLength(2);
  });

  it('sorts by hour however the tiers were stored', () => {
    expect(offers({ tiers: [...TIERS].reverse() }).map((o) => o.hour)).toEqual([14, 18]);
  });

  it('offers nothing when the property has configured nothing', () => {
    expect(offers({ tiers: [] })).toEqual([]);
  });

  /* ── What each card says ─────────────────────────────────────────────── */

  /**
   * Derived from THIS stay's checkout, so one row reads correctly for two
   * guests due out at different times.
   */
  it('measures the extra hours from the guest\'s own checkout time', () => {
    expect(offers()[0]!.sub).toBe('Three extra hours');

    const dueOut1pm = new Date('2026-03-12T07:30:00Z');
    expect(offers({ scheduledCheckoutAt: dueOut1pm })[0]!.sub).toBe('One extra hour');
  });

  it('prefers the property\'s own line when it has written one', () => {
    expect(offers()[1]!.sub).toBe('The room is yours all day');
  });

  it('puts the hour on the button, the way the reference writes it', () => {
    expect(checkoutCtaFor(offers()[0]!)).toBe('Request 2pm checkout');
    expect(checkoutCtaFor(offers()[1]!)).toBe('Request 6pm checkout');
  });

  it('carries the fee through untouched, in minor units', () => {
    expect(offers()[0]!.feeMinor).toBe(250_000);
    expect(offers()[0]!.currency).toBe('INR');
  });
});

describe('deciding a checkout request', () => {
  it('lets the desk approve, decline or the guest cancel an open one', () => {
    for (const to of ['APPROVED', 'DECLINED', 'CANCELLED'] as const) {
      expect(canDecideCheckout('REQUESTED', to)).toBe(true);
    }
  });

  /**
   * Approving moved the stay, posted a fee and extended every session on it.
   * Un-approving would have to unwind all three, which is a credit and a second
   * decision rather than a transition.
   */
  it('will not un-approve', () => {
    expect(canDecideCheckout('APPROVED', 'DECLINED')).toBe(false);
    expect(canDecideCheckout('APPROVED', 'CANCELLED')).toBe(false);
    expect(canDecideCheckout('APPROVED', 'COMPLETED')).toBe(true);
  });

  it('will not reopen anything that is finished with', () => {
    for (const from of ['DECLINED', 'CANCELLED', 'COMPLETED'] as const) {
      expect(canDecideCheckout(from, 'APPROVED')).toBe(false);
    }
  });

  it('refuses a repeat of the state it is already in', () => {
    expect(canDecideCheckout('REQUESTED', 'REQUESTED')).toBe(false);
  });
});

describe('the fee actually charged', () => {
  it('is what the guest agreed to when the desk changes nothing', () => {
    expect(effectiveFeeMinor({ feeMinor: 250_000, overriddenFeeMinor: null })).toBe(250_000);
  });

  it('is the desk\'s number when there is one', () => {
    expect(effectiveFeeMinor({ feeMinor: 250_000, overriddenFeeMinor: 100_000 })).toBe(100_000);
  });

  /**
   * The one that a `||` would get wrong, silently, every single time: waiving a
   * fee is an override of ZERO, and falling back to the agreed amount there
   * would charge the guest the full ₹2,500 the desk had just written off.
   */
  it('treats a waiver as an override, not as an absent one', () => {
    expect(effectiveFeeMinor({ feeMinor: 250_000, overriddenFeeMinor: 0 })).toBe(0);
  });
});
