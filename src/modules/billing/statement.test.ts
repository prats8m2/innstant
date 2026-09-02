import { describe, it, expect } from 'vitest';
import { buildGuestStatement, EMPTY_STATEMENT_NOTE } from './statement';
import type { FolioSummary } from './folio';

/**
 * The bill a guest reads.
 *
 * These are the wording and arithmetic decisions the screen makes, and each one
 * of them is a conversation at the front desk at 7am on checkout day if it is
 * wrong. The layout is the reference's; the words are not, and this file is
 * where the difference is pinned down.
 */
const TZ = 'Asia/Kolkata';

/** 12 March 2026, 18:30 IST — 13:00 UTC. */
const MARCH_12 = new Date('2026-03-12T13:00:00Z');

function folio(
  lines: Array<Partial<FolioSummary['lines'][number]> & { amountMinor: number }>,
  header: Partial<FolioSummary> = {},
): FolioSummary {
  const full = lines.map((line, i) => ({
    id: `line-${i}`,
    source: 'ORDER',
    sourceRefId: null,
    description: 'Something',
    createdAt: MARCH_12,
    ...line,
  }));
  const charges = full.filter((l) => l.source !== 'PAYMENT')
    .reduce((sum, l) => sum + l.amountMinor, 0);
  const payments = full.filter((l) => l.source === 'PAYMENT')
    .reduce((sum, l) => sum + l.amountMinor, 0);

  return {
    id: 'folio-1',
    status: 'OPEN',
    chargesMinor: charges,
    paymentsMinor: payments,
    balanceMinor: charges - payments,
    currency: 'INR',
    lines: full,
    ...header,
  };
}

const build = (f: FolioSummary | null) =>
  buildGuestStatement(f, { timeZone: TZ, currency: 'INR' });

describe('the folio a guest reads', () => {
  /* ── Nothing yet ─────────────────────────────────────────────────────── */

  /**
   * The folio row is opened lazily by the first charge, so a guest on their
   * first evening has no folio at all. That is normal, not an error, and the
   * screen must not read like something is missing.
   */
  it('says what the folio is FOR when there is nothing on it', () => {
    const statement = build(null);
    expect(statement.lines).toEqual([]);
    expect(statement.balanceMinor).toBe(0);
    expect(statement.totalLabel).toBe('Nothing on your room yet');
    expect(statement.note).toBe(EMPTY_STATEMENT_NOTE);
    // Not "settled" — nothing has happened, which is a different thing from
    // having paid.
    expect(statement.settled).toBe(false);
  });

  it('treats a folio with no lines the same as no folio', () => {
    expect(build(folio([])).totalLabel).toBe('Nothing on your room yet');
  });

  /* ── The ordinary bill ───────────────────────────────────────────────── */

  it('lists the charges oldest first and totals exactly what is listed', () => {
    const statement = build(folio([
      { description: 'Room charge · Lake view', amountMinor: 1_800_000 },
      { description: 'In-room dining · KE-1180', amountMinor: 247_000 },
    ]));

    expect(statement.lines.map((l) => l.description)).toEqual([
      'Room charge · Lake view', 'In-room dining · KE-1180',
    ]);
    expect(statement.chargesMinor).toBe(2_047_000);
    expect(statement.balanceMinor).toBe(2_047_000);
    expect(statement.totalLabel).toBe('Total so far');
  });

  it('dates each line in the property\'s timezone, not the server\'s', () => {
    // 00:30 on the 12th in Udaipur is still the 11th in UTC. A charge posted
    // then belongs on the 12th's bill.
    const justAfterMidnight = new Date('2026-03-11T19:00:00Z');
    const statement = build(folio([
      { amountMinor: 100, createdAt: justAfterMidnight },
    ]));
    expect(statement.lines[0]!.date).toBe('12 Mar');
  });

  /**
   * The reference's footnote is "Room and taxes settle at checkout. Nothing
   * here is charged yet." It is false the moment a room charge is posted, which
   * the seeder does on the first night.
   */
  it('never tells a guest with a bill that nothing is charged', () => {
    const statement = build(folio([{ amountMinor: 1_800_000 }]));
    expect(statement.note).not.toMatch(/nothing.*charged/i);
    expect(statement.note).toMatch(/settle it at the desk/i);
  });

  /* ── Credits ─────────────────────────────────────────────────────────── */

  /**
   * D-027: a rejected order posts a negative ADJUSTMENT rather than deleting
   * the charge, so both rows are on the bill. The guest has to be able to see
   * that dinner was charged AND credited — that is exactly the conversation a
   * deleted row makes unwinnable.
   */
  it('keeps a credit next to the charge it cancels, and nets them', () => {
    const statement = build(folio([
      { source: 'ORDER', description: 'In-room dining · KE-1180', amountMinor: 247_000 },
      { source: 'ADJUSTMENT', description: 'Reversed · KE-1180', amountMinor: -247_000 },
    ]));

    expect(statement.lines).toHaveLength(2);
    expect(statement.lines[1]!.isCredit).toBe(true);
    expect(statement.chargesMinor).toBe(0);
    expect(statement.hasCredits).toBe(true);
    // And says so, so a guest scanning the total does not think the charge is
    // still there.
    expect(statement.note).toMatch(/credit rather than disappearing/i);
  });

  it('marks only the negative lines as credits', () => {
    const statement = build(folio([
      { amountMinor: 100 }, { amountMinor: -40 }, { amountMinor: 0 },
    ]));
    expect(statement.lines.map((l) => l.isCredit)).toEqual([false, true, false]);
  });

  /* ── Payments ────────────────────────────────────────────────────────── */

  /**
   * A PAYMENT row is not a charge. The recompute trigger splits on exactly this
   * (`source <> 'PAYMENT'`), and a bill that listed a payment among the charges
   * would double-count it in front of the guest.
   */
  it('keeps a payment out of the charge list and off the charge total', () => {
    const statement = build(folio([
      { source: 'ORDER', amountMinor: 100_000 },
      { source: 'PAYMENT', description: 'Card · 4242', amountMinor: 40_000 },
    ]));

    expect(statement.lines).toHaveLength(1);
    expect(statement.chargesMinor).toBe(100_000);
    expect(statement.paidMinor).toBe(40_000);
    expect(statement.balanceMinor).toBe(60_000);
  });

  /**
   * Kept rather than dropped. "Paid ₹450" without "Card · 4242" is missing the
   * half of a bill a guest actually checks — that the right card was charged.
   */
  it('lists how they paid, separately from what they bought', () => {
    const statement = build(folio([
      { source: 'ORDER', description: 'Dinner', amountMinor: 100_000 },
      { source: 'PAYMENT', description: 'Card · 4242', amountMinor: 60_000 },
      { source: 'PAYMENT', description: 'Cash', amountMinor: 40_000 },
    ]));

    expect(statement.lines.map((l) => l.description)).toEqual(['Dinner']);
    expect(statement.payments.map((l) => l.description)).toEqual(['Card · 4242', 'Cash']);
    expect(statement.payments.reduce((sum, l) => sum + l.amountMinor, 0)).toBe(100_000);
  });

  it('has no payment list when nothing has been paid', () => {
    expect(build(folio([{ amountMinor: 100 }])).payments).toEqual([]);
    expect(build(null).payments).toEqual([]);
  });

  it('stops calling it a total once part of it is paid', () => {
    const statement = build(folio([
      { source: 'ORDER', amountMinor: 100_000 },
      { source: 'PAYMENT', amountMinor: 40_000 },
    ]));
    // "Total so far" next to 60,000 when the total is 100,000 is a lie of
    // exactly the kind a bill cannot afford.
    expect(statement.totalLabel).toBe('Left to pay');
  });

  it('says settled when it is settled', () => {
    const statement = build(folio([
      { source: 'ORDER', amountMinor: 100_000 },
      { source: 'PAYMENT', amountMinor: 100_000 },
    ]));
    expect(statement.settled).toBe(true);
    expect(statement.balanceMinor).toBe(0);
    expect(statement.totalLabel).toBe('Settled');
    expect(statement.note).toMatch(/Nothing left to pay/);
  });

  it('does not call an empty folio settled', () => {
    expect(build(folio([])).settled).toBe(false);
  });

  /**
   * Overpaid, or credited after paying — the hotel owes the guest. Rare, and
   * the one case where a bill showing a bare negative number would be read as
   * a charge.
   */
  it('says who owes whom when the balance goes negative', () => {
    const statement = build(folio([
      { source: 'ORDER', amountMinor: 100_000 },
      { source: 'ADJUSTMENT', amountMinor: -100_000 },
      { source: 'PAYMENT', amountMinor: 100_000 },
    ]));
    expect(statement.balanceMinor).toBe(-100_000);
    expect(statement.totalLabel).toBe('We owe you');
    expect(statement.note).toMatch(/settle the difference/i);
  });

  /* ── Self-consistency ────────────────────────────────────────────────── */

  /**
   * The total under a list must equal the list. It is recomputed from the lines
   * rather than read off the header for that reason — the header is the hotel's
   * authority and this is the guest's page, and they must never disagree ON
   * SCREEN even if a bug makes them disagree in the database.
   */
  it('totals the lines it drew, not the header it was handed', () => {
    const wrongHeader = folio(
      [{ amountMinor: 100 }, { amountMinor: 200 }],
      { chargesMinor: 999_999, balanceMinor: 999_999 },
    );
    const statement = build(wrongHeader);
    const drawn = statement.lines.reduce((sum, l) => sum + l.amountMinor, 0);
    expect(statement.chargesMinor).toBe(drawn);
    expect(statement.chargesMinor).toBe(300);
  });
});
