import { formatFolioDate } from '@/lib/clock';
import type { FolioSummary } from './folio';

/**
 * The folio as a bill the guest reads, rather than as three integers and a list.
 *
 * Pure and separate from `folio.ts` so the decisions in it can be tested without
 * a database — and they are decisions, not formatting. What "total so far"
 * means once a payment has landed, what a credit looks like next to the charge
 * it cancels, and what the screen says when there is nothing on the room at all
 * are all answers this product has to give consistently, and getting one wrong
 * is a guest arguing with the front desk at 7am on checkout day.
 *
 * Money stays in minor units the whole way through (#5). Nothing here formats a
 * currency — `formatMoney()` does that at the edge, once.
 */

export interface StatementLine {
  id: string;
  /** Property-local, narrow: "12 Mar". A charge posted at 00:30 Thursday in
   *  Udaipur is a Thursday line, not a Wednesday one. */
  date: string;
  description: string;
  amountMinor: number;
  /** A reversal (D-027) or a desk adjustment. Drawn differently, never hidden. */
  isCredit: boolean;
}

export interface GuestStatement {
  lines: StatementLine[];
  /** What is on the room before anything paid. Charges only, credits netted. */
  chargesMinor: number;
  paidMinor: number;
  /** What is still owed. Negative means the hotel owes the guest. */
  balanceMinor: number;
  currency: string;
  /** Label above the big number: what that number actually is. */
  totalLabel: string;
  /** One line under it, true of this folio. Never "nothing is charged yet"
   *  unless nothing is. */
  note: string;
  settled: boolean;
  hasCredits: boolean;
}

/**
 * The empty folio, which is not an error.
 *
 * A guest who has ordered nothing has no `folios` row at all — it is opened
 * lazily by the first charge — so "no folio" and "a folio with no lines" are
 * the same thing to the person reading the screen, and both are normal on the
 * first evening of a stay.
 */
export const EMPTY_STATEMENT_NOTE =
  'Anything you order or ask for goes on here, and you settle it at the desk when you leave.';

export function buildGuestStatement(
  folio: FolioSummary | null,
  options: { timeZone: string; currency: string },
): GuestStatement {
  if (!folio || !folio.lines.length) {
    return {
      lines: [],
      chargesMinor: 0,
      paidMinor: 0,
      balanceMinor: 0,
      currency: folio?.currency ?? options.currency,
      totalLabel: 'Nothing on your room yet',
      note: EMPTY_STATEMENT_NOTE,
      settled: false,
      hasCredits: false,
    };
  }

  const lines: StatementLine[] = folio.lines
    // PAYMENT rows are not charges and must not read as one. They are summed
    // into `paidMinor` and shown as their own line under the total instead.
    .filter((line) => line.source !== 'PAYMENT')
    .map((line) => ({
      id: line.id,
      date: formatFolioDate(line.createdAt, options.timeZone),
      description: line.description,
      amountMinor: line.amountMinor,
      isCredit: line.amountMinor < 0,
    }));

  /**
   * Recomputed from the lines rather than read off the header.
   *
   * `folio_lines_recompute` maintains the header and is the authority for the
   * hotel; this screen shows a guest a list and a total, and a total that does
   * not equal the list above it is the one thing a bill may never do. If the
   * two ever disagree the header is right and this is a rendering bug — but the
   * guest still reads a self-consistent page while somebody finds out.
   */
  const chargesMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const paidMinor = folio.paymentsMinor;
  const balanceMinor = chargesMinor - paidMinor;

  const settled = balanceMinor === 0 && (chargesMinor !== 0 || paidMinor !== 0);
  const hasCredits = lines.some((line) => line.isCredit);

  return {
    lines,
    chargesMinor,
    paidMinor,
    balanceMinor,
    currency: folio.currency,
    totalLabel: labelFor({ settled, paidMinor, balanceMinor }),
    note: noteFor({ settled, paidMinor, balanceMinor, hasCredits }),
    settled,
    hasCredits,
  };
}

function labelFor(input: {
  settled: boolean; paidMinor: number; balanceMinor: number;
}): string {
  if (input.settled) return 'Settled';
  if (input.balanceMinor < 0) return 'We owe you';
  // "Total so far" while nothing is paid — the reference's words, and true.
  // "Left to pay" once something is, because "total" would then be a different
  // number from the one the guest is being asked for.
  return input.paidMinor > 0 ? 'Left to pay' : 'Total so far';
}

function noteFor(input: {
  settled: boolean; paidMinor: number; balanceMinor: number; hasCredits: boolean;
}): string {
  if (input.settled) return 'Nothing left to pay. Ask at the desk if you want a copy.';

  if (input.balanceMinor < 0) {
    return 'You have paid more than the room owes. The desk will settle the difference when you leave.';
  }

  /**
   * NOT the reference's "Room and taxes settle at checkout. Nothing here is
   * charged yet."
   *
   * The reference's stay screen is a mock with no folio behind it, and that
   * sentence is false the moment a real room charge is posted — which the
   * seeder does on the first night. CLAUDE.md says the reference wins on
   * design; it does not license telling a guest their bill is empty while
   * ₹21,540 sits above the line. Same layout, same type, true words (D-031).
   */
  const base = 'This is what is on the room. You settle it at the desk when you leave.';
  return input.hasCredits
    ? `${base} Anything taken off shows as a credit rather than disappearing.`
    : base;
}
