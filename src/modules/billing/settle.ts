import { and, eq, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { folios, folioLines, payments } from '@/db/schema/billing';
import { idempotencyKeys } from '@/db/schema/core';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { CurrencyCode } from '@/lib/money';

/**
 * Taking the money, and closing the account.
 *
 * ─── Why this is not `postFolioLine()` ─────────────────────────────────────
 *
 * `postFolioLine()`'s `source` union deliberately excludes `PAYMENT`, and has
 * since P1. A payment is TWO rows that have to exist together: a `payments` row,
 * which is the ledger of how money actually arrived, and a `folio_lines` row
 * with `source = 'PAYMENT'`, which is what the recompute trigger sums into
 * `payments_minor` and takes off the balance.
 *
 * One without the other is a specific, awful failure. A `payments` row alone
 * leaves the guest's bill still showing the full amount after they have paid it.
 * A folio line alone leaves a settled bill with no record of how it was settled —
 * which is the row a chargeback is answered with.
 *
 * So they are written here, together, in one transaction, and the generic door
 * stays shut.
 *
 * ─── What this does NOT do ─────────────────────────────────────────────────
 *
 * Take a card. `provider` is `DESK` and the money moved somewhere else — a card
 * machine, a cash drawer, a bank transfer — which is exactly how this hotel
 * settles today. Express checkout through Razorpay is the same two rows with
 * `provider = 'RAZORPAY'` and a webhook that confirms them, and it needs an
 * external service that nobody has chosen yet.
 */

/**
 * How the money arrived. Not a provider — the provider is us, at a desk.
 *
 * `OTHER` exists because a hotel will be handed a travel-agent voucher at some
 * point and the desk should record the payment rather than route around the
 * system to do it.
 */
export const PAYMENT_METHODS = ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const IDEMPOTENCY_SCOPE = 'folio.payment';
const IDEMPOTENCY_TTL_HOURS = 24;

export interface RecordPaymentInput {
  tenantId: string;
  propertyId: string;
  stayId: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  /** What the desk wrote down — the last four of a card, a UPI ref. */
  reference?: string | null;
  staffUserId: string;
  /** #8. A desk double-clicking "Take ₹13,180" must not take it twice. */
  idempotencyKey: string;
}

export interface RecordedPayment {
  paymentId: string;
  folioId: string;
  folioLineId: string;
  amountMinor: number;
  /** What is still owed after this. Negative means the hotel owes the guest. */
  balanceMinor: number;
  currency: CurrencyCode;
  /** True when this was a replay of a key already used (#8). */
  wasAlreadyTaken: boolean;
}

export async function recordPayment(
  tx: Tx,
  input: RecordPaymentInput,
): Promise<RecordedPayment> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new ValidationError('Enter how much was taken.');
  }
  if (!PAYMENT_METHODS.includes(input.method)) {
    throw new ValidationError('Say how the money arrived.');
  }

  const replayed = await claimKey(tx, input);
  if (replayed) return { ...replayed, wasAlreadyTaken: true };

  const folioRows = await tx.select({
    id: folios.id,
    status: folios.status,
    currency: folios.currency,
  }).from(folios)
    .where(and(eq(folios.stayId, input.stayId), eq(folios.propertyId, input.propertyId)))
    .limit(1);

  const folio = folioRows[0];
  // Nothing has ever been charged. A deposit before any charge is a real thing,
  // but it is not this — `getOrCreateOpenFolio()` is how a charge opens a folio,
  // and taking money against a stay with no account is a mistake worth stopping.
  if (!folio) {
    throw new NotFoundError('There is no bill for this stay yet.');
  }
  if (folio.status === 'SETTLED') {
    throw new ConflictError('This bill is already settled.');
  }
  /**
   * The folio's currency, not the caller's. A payment in a different currency
   * from the bill it pays is not a payment (#5), and the desk's form cannot
   * choose — it is showing one bill.
   */
  if (input.currency !== folio.currency) {
    throw new ValidationError(
      `This bill is in ${folio.currency}. A payment has to be in the same currency.`,
    );
  }

  const [payment] = await tx.insert(payments).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    folioId: folio.id,
    // Not RAZORPAY. The money moved through a card machine or a drawer, and
    // pretending otherwise would make reconciliation lie.
    provider: 'DESK',
    providerPaymentId: null,
    amountMinor: input.amountMinor,
    currency: folio.currency,
    status: 'CAPTURED',
    method: input.method,
    providerPayload: input.reference ? { reference: input.reference } : null,
    capturedAt: new Date(),
  }).returning({ id: payments.id });

  /**
   * And the folio line, in the same breath. The trigger on `folio_lines` is what
   * moves `payments_minor` and `balance_minor`; the `payments` row above moves
   * nothing on its own.
   */
  const [line] = await tx.insert(folioLines).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    folioId: folio.id,
    source: 'PAYMENT',
    sourceRefId: payment!.id,
    description: describePayment(input.method, input.reference),
    amountMinor: input.amountMinor,
    currency: folio.currency,
    postedByStaffId: input.staffUserId,
  }).returning({ id: folioLines.id });

  const after = await tx.select({ balanceMinor: folios.balanceMinor })
    .from(folios).where(eq(folios.id, folio.id)).limit(1);
  const balanceMinor = after[0]?.balanceMinor ?? 0;

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'folio',
    entityId: folio.id,
    eventType: 'folio.payment_taken',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: {
      paymentId: payment!.id,
      amountMinor: input.amountMinor,
      currency: folio.currency,
      method: input.method,
      ...(input.reference ? { reference: input.reference } : {}),
      balanceMinor,
    },
  });

  const result: Omit<RecordedPayment, 'wasAlreadyTaken'> = {
    paymentId: payment!.id,
    folioId: folio.id,
    folioLineId: line!.id,
    amountMinor: input.amountMinor,
    balanceMinor,
    currency: folio.currency as CurrencyCode,
  };

  await tx.update(idempotencyKeys)
    .set({ status: 'COMPLETED', responseBody: result })
    .where(and(
      eq(idempotencyKeys.tenantId, input.tenantId),
      eq(idempotencyKeys.scope, IDEMPOTENCY_SCOPE),
      eq(idempotencyKeys.key, input.idempotencyKey),
    ));

  return { ...result, wasAlreadyTaken: false };
}

/** "Card · 4242", "Cash". What the guest reads on their own bill. */
function describePayment(method: PaymentMethod, reference?: string | null): string {
  const label = {
    CASH: 'Cash',
    CARD: 'Card',
    UPI: 'UPI',
    BANK_TRANSFER: 'Bank transfer',
    OTHER: 'Payment',
  }[method];
  return reference ? `${label} · ${reference}` : label;
}

export interface SettleFolioResult {
  folioId: string;
  alreadySettled: boolean;
}

/**
 * Close the account.
 *
 * ─── Why this is separate from the balance reaching zero ───────────────────
 *
 * A folio hits zero in the middle of a stay all the time: an order is charged
 * and then rejected, and D-027's reversal nets it back to nothing. That guest is
 * still here and still ordering. SETTLED means "this stay's account is closed",
 * which is a decision about the stay rather than an arithmetic fact about the
 * balance.
 *
 * It still refuses when the balance is not zero, because a settled bill with
 * money outstanding is the one thing this status must never mean.
 */
export async function settleFolio(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    stayId: string;
    staffUserId: string;
    now?: Date;
  },
): Promise<SettleFolioResult> {
  const rows = await tx.select({
    id: folios.id,
    status: folios.status,
    balanceMinor: folios.balanceMinor,
    currency: folios.currency,
  }).from(folios)
    .where(and(eq(folios.stayId, input.stayId), eq(folios.propertyId, input.propertyId)))
    .limit(1);

  const folio = rows[0];
  if (!folio) throw new NotFoundError('There is no bill for this stay.');
  if (folio.status === 'SETTLED') {
    return { folioId: folio.id, alreadySettled: true };
  }

  if (folio.balanceMinor !== 0) {
    throw new ConflictError(
      folio.balanceMinor > 0
        ? 'There is still money on this bill. Take it first.'
        : 'This bill is overpaid. The difference has to be returned before it closes.',
    );
  }

  const now = input.now ?? new Date();
  const updated = await tx.update(folios)
    .set({ status: 'SETTLED', settledAt: now, updatedAt: now })
    // Compare-and-set: two people at the desk closing the same bill write one
    // event, not two.
    .where(and(eq(folios.id, folio.id), eq(folios.status, folio.status)))
    .returning({ id: folios.id });

  if (!updated[0]) return { folioId: folio.id, alreadySettled: true };

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'folio',
    entityId: folio.id,
    eventType: 'folio.settled',
    fromStatus: 'OPEN',
    toStatus: 'SETTLED',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { currency: folio.currency },
  });

  return { folioId: folio.id, alreadySettled: false };
}

/** #8, the same shape the cart and the request path use. */
async function claimKey(
  tx: Tx,
  input: RecordPaymentInput,
): Promise<Omit<RecordedPayment, 'wasAlreadyTaken'> | null> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 60 * 60 * 1000);

  await tx.insert(idempotencyKeys).values({
    tenantId: input.tenantId,
    scope: IDEMPOTENCY_SCOPE,
    key: input.idempotencyKey,
    status: 'IN_PROGRESS',
    expiresAt,
  }).onConflictDoNothing();

  const rows = await tx.select({
    status: idempotencyKeys.status,
    responseBody: idempotencyKeys.responseBody,
    createdAt: idempotencyKeys.createdAt,
  }).from(idempotencyKeys)
    .where(and(
      eq(idempotencyKeys.tenantId, input.tenantId),
      eq(idempotencyKeys.scope, IDEMPOTENCY_SCOPE),
      eq(idempotencyKeys.key, input.idempotencyKey),
    ))
    .limit(1);

  const claim = rows[0];
  if (!claim) throw new ConflictError('That could not be taken. Try again.');

  if (claim.status === 'COMPLETED') {
    return claim.responseBody as Omit<RecordedPayment, 'wasAlreadyTaken'>;
  }

  const isOurs = Date.now() - new Date(claim.createdAt).getTime() < 1_000;
  if (isOurs) return null;

  // Somebody else's in-flight attempt with the same key. Refusing is right on a
  // money path: two desks taking the same payment is worse than one retry.
  throw new ConflictError('That payment is already being taken.');
}

/** Every payment against this stay, for the desk and for a dispute. */
export async function paymentsForStay(
  tx: Tx,
  input: { propertyId: string; stayId: string },
): Promise<Array<{
  id: string;
  amountMinor: number;
  currency: CurrencyCode;
  method: string | null;
  provider: string;
  capturedAt: Date | null;
}>> {
  const rows = await tx.select({
    id: payments.id,
    amountMinor: payments.amountMinor,
    currency: payments.currency,
    method: payments.method,
    provider: payments.provider,
    capturedAt: payments.capturedAt,
  }).from(payments)
    .innerJoin(folios, eq(folios.id, payments.folioId))
    .where(and(
      eq(folios.stayId, input.stayId),
      eq(payments.propertyId, input.propertyId),
      eq(payments.status, 'CAPTURED'),
    ))
    .orderBy(sql`${payments.capturedAt} ASC`);

  return rows.map((row) => ({ ...row, currency: row.currency as CurrencyCode }));
}
