import { and, eq } from 'drizzle-orm';
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
