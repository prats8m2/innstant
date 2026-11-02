/**
 * Which part of revenue a folio line is — pure, so the rule is tested without
 * a database (tests in revenue-rules.test.ts).
 *
 * The overview's revenue is what was POSTED to folios in the period, by when it
 * was posted (`folio_lines.created_at`), net of corrections, in three parts:
 *
 *   rooms     desk-added room charges (MANUAL · ROOM) and the tax on them
 *   services  amenities and services (SERVICE_REQUEST), late checkout
 *             (CHECKOUT_FEE), every other desk charge (minibar, laundry,
 *             damage, other — MANUAL) and the tax on those
 *   credits   a whole-bill discount: an ADJUSTMENT that names no line
 *
 * A correction (ADJUSTMENT) lands in the part of the line it corrects, on the
 * day it was made — a ₹500 minibar refund on Tuesday is Tuesday's services,
 * not a rewrite of Monday's.
 *
 * Food and drink is NOT taken from folios. It comes from the orders themselves
 * (ordering's `ordersReport`), because a property-link order is never on a
 * folio (D-079). So an ORDER line is skipped here, and so is the reversal of
 * an order the kitchen rejected or a guest cancelled — that order is already
 * left out of food sales by its status, and counting the reversal too would
 * take it off twice. What IS kept is a desk correction made against an order's
 * line ("take ₹200 off that dinner"), as `foodCorrections`: it is not on the
 * order, and the food figure has to carry it.
 *
 * PAYMENT lines are money in, not revenue.
 */

export type FolioSource =
  | 'ORDER' | 'SERVICE_REQUEST' | 'CHECKOUT_FEE' | 'ADJUSTMENT' | 'PAYMENT' | 'MANUAL';

export type RevenuePart = 'rooms' | 'services' | 'foodCorrections' | 'credits';

/** A folio line as the report reads it, with what it points at. */
export interface RevenueLine {
  source: FolioSource;
  category: string | null;
  /**
   * The line this one points at by id (`source_ref_id = that line's id`): the
   * line a desk correction takes money off, or the charge a TAX line is on.
   */
  target: { source: FolioSource; category: string | null; targetCategory: string | null } | null;
  /**
   * The source of a charge that shares this line's `source_ref_id` — set when
   * an ADJUSTMENT is a reversal of an order or a request (D-095's
   * `reverseFolioLinesForSource`), which points at the order or request
   * rather than at a line.
   */
  reverses: FolioSource | null;
}

/** The part of revenue a charge (not a correction) belongs to. */
function partOfCharge(
  source: FolioSource,
  category: string | null,
  taxOn: string | null,
): RevenuePart | 'food' | null {
  switch (source) {
    case 'PAYMENT': return null;
    case 'ORDER': return 'food';
    case 'SERVICE_REQUEST':
    case 'CHECKOUT_FEE': return 'services';
    case 'MANUAL':
      if (category === 'ROOM') return 'rooms';
      if (category === 'TAX') return taxOn === 'ROOM' ? 'rooms' : 'services';
      return 'services';
    case 'ADJUSTMENT': return 'credits';
  }
}

export function revenuePartOf(line: RevenueLine): RevenuePart | null {
  if (line.source === 'PAYMENT' || line.source === 'ORDER') return null;

  if (line.source !== 'ADJUSTMENT') {
    const part = partOfCharge(line.source, line.category, line.target?.category ?? null);
    return part === 'food' ? null : part;
  }

  // A correction against a named line goes where that line went.
  if (line.target) {
    const part = partOfCharge(line.target.source, line.target.category, line.target.targetCategory);
    if (part === null) return null;
    return part === 'food' ? 'foodCorrections' : part;
  }
  // A reversal of an order: already out of food sales by its status.
  if (line.reverses === 'ORDER') return null;
  if (line.reverses === 'SERVICE_REQUEST' || line.reverses === 'CHECKOUT_FEE') return 'services';
  return 'credits';
}

export interface RevenueParts {
  roomsMinor: number;
  servicesMinor: number;
  foodCorrectionsMinor: number;
  creditsMinor: number;
}

export function emptyParts(): RevenueParts {
  return { roomsMinor: 0, servicesMinor: 0, foodCorrectionsMinor: 0, creditsMinor: 0 };
}

/** Adds one line's amount to the part it belongs to. Returns the same object. */
export function addToParts(parts: RevenueParts, line: RevenueLine, amountMinor: number): RevenueParts {
  switch (revenuePartOf(line)) {
    case 'rooms': parts.roomsMinor += amountMinor; break;
    case 'services': parts.servicesMinor += amountMinor; break;
    case 'foodCorrections': parts.foodCorrectionsMinor += amountMinor; break;
    case 'credits': parts.creditsMinor += amountMinor; break;
    case null: break;
  }
  return parts;
}

/** Everything from folios that counts towards revenue. */
export function folioRevenueMinor(parts: RevenueParts): number {
  return parts.roomsMinor + parts.servicesMinor + parts.foodCorrectionsMinor + parts.creditsMinor;
}
