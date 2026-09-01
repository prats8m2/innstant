import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { folios, folioLines } from '@/db/schema/billing';
import { NotFoundError } from '@/lib/errors';

/**
 * The folio — what a stay owes.
 *
 * One per stay, opened lazily. `ordering` and `requests` post to it through
 * these functions rather than reaching for the tables (D-001), which is also
 * what keeps every charge going through one place when the PMS adapter arrives
 * to drain them (D-011).
 *
 * Balances are NOT maintained here. `folio_lines_recompute` (0002_constraints)
 * recomputes charges, payments and balance from the lines on every insert, so
 * a caller that forgot to update the header cannot leave the folio wrong.
 * Write the line; the totals follow.
 */

export interface PostFolioLineInput {
  tenantId: string;
  propertyId: string;
  stayId: string;
  source: 'ORDER' | 'SERVICE_REQUEST' | 'CHECKOUT_FEE' | 'ADJUSTMENT' | 'MANUAL';
  /** The order / request this came from. Not an FK — sources live in different
   *  modules — but it is what a dispute is resolved with. */
  sourceRefId?: string | null;
  description: string;
  amountMinor: number;
  currency: string;
  postedByStaffId?: string | null;
}

/**
 * Opens the stay's folio if it does not have one.
 *
 * `ON CONFLICT DO NOTHING` on the unique (stay_id) index rather than
 * check-then-insert: two charges landing at once — an order and an amenity —
 * would otherwise race to create the same folio.
 */
export async function getOrCreateOpenFolio(
  tx: Tx,
  input: { tenantId: string; propertyId: string; stayId: string; currency: string },
): Promise<{ id: string }> {
  await tx.insert(folios).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    stayId: input.stayId,
    currency: input.currency,
    status: 'OPEN',
  }).onConflictDoNothing();

  const rows = await tx.select({ id: folios.id }).from(folios)
    .where(eq(folios.stayId, input.stayId)).limit(1);

  const folio = rows[0];
  // Only reachable if the insert was rejected by RLS, which means the stay is
  // not this tenant's — and saying more would confirm that it exists.
  if (!folio) throw new NotFoundError('No folio for this stay.');
  return folio;
}

export async function postFolioLine(
  tx: Tx,
  input: PostFolioLineInput,
): Promise<{ folioId: string; folioLineId: string }> {
  const folio = await getOrCreateOpenFolio(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    stayId: input.stayId,
    currency: input.currency,
  });

  const [line] = await tx.insert(folioLines).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    folioId: folio.id,
    source: input.source,
    sourceRefId: input.sourceRefId ?? null,
    description: input.description,
    amountMinor: input.amountMinor,
    currency: input.currency,
    postedByStaffId: input.postedByStaffId ?? null,
  }).returning({ id: folioLines.id });

  return { folioId: folio.id, folioLineId: line!.id };
}

/**
 * Take a charge back off the folio.
 *
 * A NEGATIVE ADJUSTMENT row, never an edit or a delete — DATA-MODEL §5, and the
 * `folio_lines_recompute` trigger sums every non-PAYMENT line, so the totals
 * follow on their own. The original charge stays visible: at 7am on checkout
 * day the guest and the desk can both see that dinner was charged and then
 * credited, which is exactly the conversation a deleted row makes unwinnable.
 *
 * ─── Why it nets rather than mirrors ───────────────────────────────────────
 *
 * It sums everything already posted against `sourceRefId` and posts the
 * opposite of the NET. So:
 *   - called twice, the second call finds a net of zero and does nothing;
 *   - a charge that was partly credited by hand at the desk is only credited
 *     for the remainder, not twice.
 *
 * That makes this safe to call from inside a transition (#8) without a second
 * idempotency mechanism of its own.
 */
export interface ReverseFolioLinesInput {
  tenantId: string;
  propertyId: string;
  stayId: string;
  /** The order / request whose charge is coming off. */
  sourceRefId: string;
  /** What the guest reads on the bill. Say what it reverses. */
  description: string;
  reversedByStaffId?: string | null;
}

export interface FolioReversal {
  folioId: string;
  folioLineId: string;
  /** Negative — what was credited. */
  amountMinor: number;
  currency: string;
}

export async function reverseFolioLinesForSource(
  tx: Tx,
  input: ReverseFolioLinesInput,
): Promise<FolioReversal | null> {
  const folioRows = await tx.select({ id: folios.id }).from(folios)
    .where(eq(folios.stayId, input.stayId)).limit(1);
  const folio = folioRows[0];
  // No folio at all: nothing was ever charged for this stay. A cancelled DRAFT
  // reaches here, and it is not an error.
  if (!folio) return null;

  const posted = await tx.select({
    amountMinor: folioLines.amountMinor,
    currency: folioLines.currency,
  }).from(folioLines)
    .where(and(
      eq(folioLines.folioId, folio.id),
      eq(folioLines.sourceRefId, input.sourceRefId),
    ));

  if (!posted.length) return null;

  const net = posted.reduce((sum, line) => sum + line.amountMinor, 0);
  // Already square — either nothing was charged, or this has been reversed.
  if (net === 0) return null;

  // The currency of the lines being reversed, not one passed in: a credit in a
  // different currency from the charge it cancels is not a credit (#5).
  const currency = posted[0]!.currency;

  const [line] = await tx.insert(folioLines).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    folioId: folio.id,
    source: 'ADJUSTMENT',
    sourceRefId: input.sourceRefId,
    description: input.description,
    amountMinor: -net,
    currency,
    postedByStaffId: input.reversedByStaffId ?? null,
  }).returning({ id: folioLines.id });

  return { folioId: folio.id, folioLineId: line!.id, amountMinor: -net, currency };
}

export interface FolioSummary {
  id: string;
  status: string;
  chargesMinor: number;
  paymentsMinor: number;
  balanceMinor: number;
  currency: string;
  lines: Array<{
    id: string;
    source: string;
    sourceRefId: string | null;
    description: string;
    amountMinor: number;
    createdAt: Date;
  }>;
}

/**
 * What every one of these stays owes, in one query.
 *
 * For the front desk's room list, which needs a balance against 34 rooms. The
 * alternative is `getFolioForStay()` in a loop, which is 34 round trips on a
 * screen somebody refreshes all morning — the same mistake `provisionProperty()`
 * made per-room before it was batched.
 *
 * A stay with no folio is absent from the map rather than zero: no folio means
 * nothing was ever charged, and the screen says so differently.
 */
export async function folioBalancesForStays(
  tx: Tx,
  input: { stayIds: readonly string[] },
): Promise<Map<string, { balanceMinor: number; currency: string; status: string }>> {
  if (!input.stayIds.length) return new Map();

  const rows = await tx.select({
    stayId: folios.stayId,
    balanceMinor: folios.balanceMinor,
    currency: folios.currency,
    status: folios.status,
  }).from(folios).where(inArray(folios.stayId, [...input.stayIds]));

  return new Map(rows.map((row) => [row.stayId, {
    balanceMinor: row.balanceMinor,
    currency: row.currency,
    status: row.status,
  }]));
}

/**
 * What this guest has spent at this property, across every stay.
 *
 * Computed from the folios rather than read from
 * `guest_property_profiles.lifetime_value_minor`, which exists, is written by
 * nobody, and is read by nobody. A denormalised total that nothing maintains is
 * worse than no total; a denormalised total that something maintains is a second
 * source that can drift from the folios, which is the reason
 * `folio_lines_recompute` computes the folio's own totals in the database rather
 * than trusting a caller.
 *
 * At a 34-key hotel this is one indexed sum. If it ever stops being cheap, the
 * fix is a materialised total maintained by a trigger the way the folio's is —
 * not the unmaintained column (D-036).
 */
export async function lifetimeSpendForGuest(
  tx: Tx,
  input: { propertyId: string; guestId: string },
): Promise<{ chargesMinor: number; currency: string; stays: number }> {
  const rows = await tx.execute<{ charges: number; currency: string | null; stays: number }>(sql`
    SELECT
      COALESCE(SUM(f.charges_minor), 0)::int AS charges,
      MIN(f.currency) AS currency,
      COUNT(*)::int AS stays
    FROM folios f
    JOIN stays s ON s.id = f.stay_id
    WHERE s.property_id = ${input.propertyId}
      AND s.guest_id = ${input.guestId}
  `);

  const row = rows.rows[0];
  return {
    chargesMinor: Number(row?.charges ?? 0),
    currency: row?.currency ?? 'INR',
    stays: Number(row?.stays ?? 0),
  };
}

/** The folio as a guest sees it. Oldest first — it reads as a bill. */
export async function getFolioForStay(
  tx: Tx,
  stayId: string,
): Promise<FolioSummary | null> {
  const rows = await tx.select({
    id: folios.id,
    status: folios.status,
    chargesMinor: folios.chargesMinor,
    paymentsMinor: folios.paymentsMinor,
    balanceMinor: folios.balanceMinor,
    currency: folios.currency,
  }).from(folios).where(eq(folios.stayId, stayId)).limit(1);

  const folio = rows[0];
  if (!folio) return null;

  const lines = await tx.select({
    id: folioLines.id,
    source: folioLines.source,
    sourceRefId: folioLines.sourceRefId,
    description: folioLines.description,
    amountMinor: folioLines.amountMinor,
    createdAt: folioLines.createdAt,
  }).from(folioLines)
    .where(and(eq(folioLines.folioId, folio.id)))
    .orderBy(folioLines.createdAt);

  return { ...folio, lines };
}
