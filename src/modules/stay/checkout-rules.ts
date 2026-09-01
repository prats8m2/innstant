import { atLocalHourOnSameDay, formatHour, localTimeAt, spellCount } from '@/lib/clock';

/**
 * Which checkout changes a guest may be offered, and what each one says.
 *
 * Pure — no database, no React — so the rules can be tested at any hour of any
 * day from a laptop in any timezone. Every one of them is property-local: a
 * guest due out at 11am in Udaipur must not be offered "2pm" because it is still
 * yesterday on the server.
 */

export interface CheckoutTier {
  id: string;
  /** Property-local hour of the new checkout time, 0–23. */
  hour: number;
  note: string | null;
  feeMinor: number;
  currency: string;
}

export interface CheckoutOffer {
  id: string;
  hour: number;
  /** "Late checkout, 2pm" */
  title: string;
  /** "Three extra hours", or the property's own note. */
  sub: string;
  feeMinor: number;
  currency: string;
  /** The instant `scheduled_checkout_at` becomes if this is approved. */
  checkoutAt: Date;
}

export interface OfferInput {
  tiers: readonly CheckoutTier[];
  scheduledCheckoutAt: Date;
  now: Date;
  timeZone: string;
}

/**
 * The tiers worth showing this guest, right now.
 *
 * Three filters, each of which is a way the screen would otherwise lie:
 *
 *   **later than they are already due out** — a guest due out at 2pm offered
 *   "late checkout, 2pm" for ₹2,500 is being sold nothing.
 *
 *   **still in the future** — at 3pm, "late checkout, 2pm" is an hour that has
 *   already gone. The desk can still do something about an overstay; a button
 *   promising a time in the past cannot.
 *
 *   **on the checkout day** — the hour is anchored to the day the guest leaves,
 *   which is what makes "2pm" mean the 2pm they care about rather than tomorrow's.
 */
export function checkoutOffersFor(input: OfferInput): CheckoutOffer[] {
  const dueOut = localTimeAt(input.scheduledCheckoutAt, input.timeZone);

  return input.tiers
    .map((tier) => {
      const checkoutAt = atLocalHourOnSameDay(
        input.scheduledCheckoutAt, tier.hour, input.timeZone,
      );
      return { tier, checkoutAt };
    })
    .filter(({ tier, checkoutAt }) =>
      tier.hour * 60 > dueOut.minutes && checkoutAt.getTime() > input.now.getTime())
    .sort((a, b) => a.tier.hour - b.tier.hour)
    .map(({ tier, checkoutAt }) => ({
      id: tier.id,
      hour: tier.hour,
      title: `Late checkout, ${formatHour(tier.hour)}`,
      sub: tier.note ?? describeGain(dueOut.minutes, tier.hour),
      feeMinor: tier.feeMinor,
      currency: tier.currency,
      checkoutAt,
    }));
}

/**
 * "Three extra hours" — derived, so one tier reads correctly for two guests due
 * out at different times. Only the editorial line ("The room is yours all day")
 * is stored.
 */
function describeGain(dueOutMinutes: number, hour: number): string {
  const hours = Math.round((hour * 60 - dueOutMinutes) / 60);
  if (hours <= 0) return 'No extra time';
  return hours === 1 ? 'One extra hour' : `${spellCount(hours)} extra hours`;
}

/**
 * What the button says once a guest has picked one.
 *
 * The reference's own shape — "Request 2pm checkout" with the price beside it —
 * and the price is on the button because agreeing to the amount IS the action.
 */
export function checkoutCtaFor(offer: CheckoutOffer): string {
  return `Request ${formatHour(offer.hour)} checkout`;
}

/* ── The request's own small state machine ──────────────────────────────── */

export const CHECKOUT_REQUEST_STATUSES = [
  'REQUESTED', 'APPROVED', 'COMPLETED', 'DECLINED', 'CANCELLED',
] as const;

export type CheckoutRequestStatus = (typeof CHECKOUT_REQUEST_STATUSES)[number];

/**
 * REQUESTED is the only state anyone may act on.
 *
 * APPROVED is terminal for the desk — it has already moved
 * `scheduled_checkout_at` and posted a fee, and un-approving would have to
 * unwind both. That is a credit and a second decision, not a transition, and it
 * is the desk's `folio:adjust` rather than this machine's business.
 */
const ALLOWED: Record<CheckoutRequestStatus, readonly CheckoutRequestStatus[]> = {
  REQUESTED: ['APPROVED', 'DECLINED', 'CANCELLED'],
  APPROVED: ['COMPLETED'],
  COMPLETED: [],
  DECLINED: [],
  CANCELLED: [],
};

export function canDecideCheckout(
  from: CheckoutRequestStatus,
  to: CheckoutRequestStatus,
): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/**
 * The fee actually charged: the desk's override when there is one, otherwise
 * what the guest agreed to.
 *
 * `overridden_fee_minor` is nullable and 0 is a legitimate override — "waived" —
 * so this checks for null rather than for falsiness. A `??` would have been
 * right and a `||` would have silently charged the full fee every time somebody
 * waived it.
 */
export function effectiveFeeMinor(input: {
  feeMinor: number;
  overriddenFeeMinor: number | null;
}): number {
  return input.overriddenFeeMinor ?? input.feeMinor;
}
