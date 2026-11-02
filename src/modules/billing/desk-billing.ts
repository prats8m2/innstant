import { and, eq } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { folios, folioLines, payments } from '@/db/schema/billing';
import { idempotencyKeys } from '@/db/schema/core';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { applyRateBps, formatMoney, money, type CurrencyCode } from '@/lib/money';
import { getOrCreateOpenFolio } from './folio';
import { PAYMENT_METHODS, type PaymentMethod } from './settle';

/**
 * What the desk does to a bill at checkout (D-095): add a charge, take some
 * off, give money back.
 *
 * Every one of them is a NEW row — a charge, a negative adjustment, a negative
 * payment line — never an edit (DATA-MODEL §5). The folio's totals follow
 * from the rows by trigger, so a bill read back always adds up to what is on
 * it, and each change writes its own `event_log` row in the same transaction
 * (#7), with who did it and why.
 */

export const DESK_CHARGE_KINDS = ['ROOM', 'MINIBAR', 'LAUNDRY', 'DAMAGE', 'OTHER'] as const;
export type DeskChargeKind = (typeof DESK_CHARGE_KINDS)[number];

export const DESK_CHARGE_LABEL: Record<DeskChargeKind, string> = {
  ROOM: 'Room',
  MINIBAR: 'Minibar',
  LAUNDRY: 'Laundry',
  DAMAGE: 'Damage',
  OTHER: 'Other',
};

/** 28% is the highest GST slab; nothing a desk adds is taxed above it. */
const MAX_TAX_BPS = 2_800;

async function openFolio(
  tx: Tx,
  input: { tenantId: string; propertyId: string; stayId: string; currency: string },
): Promise<{ id: string; currency: CurrencyCode }> {
  const { id } = await getOrCreateOpenFolio(tx, input);
  const [row] = await tx.select({ status: folios.status, currency: folios.currency })
    .from(folios).where(and(eq(folios.id, id), eq(folios.propertyId, input.propertyId))).limit(1);
  if (!row) throw new NotFoundError('There is no bill for this stay.');
  // A settled bill is a closed record. Something found after it closed is a
  // conversation with the guest, not a quiet line on a bill they have.
  if (row.status !== 'OPEN') throw new ConflictError('This bill is already settled.');
  return { id, currency: row.currency as CurrencyCode };
}

export interface DeskChargeInput {
  tenantId: string;
  propertyId: string;
  stayId: string;
  kind: DeskChargeKind;
  /** "3 nights", "Two Kingfisher", "Shirt, express". */
  detail?: string | null;
  quantity: number;
  unitMinor: number;
  /** GST and the like, as basis points — 1200 is 12%. Zero for none. */
  taxBps: number;
  currency: CurrencyCode;
  staffUserId: string;
}

/**
 * A charge the desk adds: room nights, the minibar, laundry, a breakage.
 *
 * The charge is one line and its tax is another, pointing at it — so the bill
 * prints "GST 12% on Room · 3 nights", and a correction of the charge does not
 * have to work out what part of a single number was tax.
 */
export async function postDeskCharge(
  tx: Tx,
  input: DeskChargeInput,
): Promise<{ folioLineId: string; taxLineId: string | null; amountMinor: number; taxMinor: number }> {
  if (!DESK_CHARGE_KINDS.includes(input.kind)) throw new ValidationError('Say what the charge is for.');
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 365) {
    throw new ValidationError('A quantity is a whole number from 1 to 365.');
  }
  if (!Number.isInteger(input.unitMinor) || input.unitMinor <= 0) {
    throw new ValidationError('Enter what one costs.');
  }
  if (!Number.isInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > MAX_TAX_BPS) {
    throw new ValidationError('Tax is between 0% and 28%.');
  }

  const folio = await openFolio(tx, input);
  const amountMinor = input.quantity * input.unitMinor;
  const label = DESK_CHARGE_LABEL[input.kind];
  const detail = input.detail?.trim();
  const description = [
    label,
    detail || null,
    input.quantity > 1 ? `${input.quantity} × ${formatMoney(money(input.unitMinor, folio.currency))}` : null,
  ].filter(Boolean).join(' · ');

  const [line] = await tx.insert(folioLines).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    folioId: folio.id,
    source: 'MANUAL',
    category: input.kind,
    description,
    amountMinor,
    currency: folio.currency,
    postedByStaffId: input.staffUserId,
  }).returning({ id: folioLines.id });

  let taxLineId: string | null = null;
  const taxMinor = input.taxBps ? applyRateBps(money(amountMinor, folio.currency), input.taxBps).amountMinor : 0;
  if (taxMinor > 0) {
    const [tax] = await tx.insert(folioLines).values({
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      folioId: folio.id,
      source: 'MANUAL',
      category: 'TAX',
      sourceRefId: line!.id,
      description: `GST ${formatRate(input.taxBps)} on ${description}`,
      amountMinor: taxMinor,
      currency: folio.currency,
      postedByStaffId: input.staffUserId,
    }).returning({ id: folioLines.id });
    taxLineId = tax!.id;
  }

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'folio',
    entityId: folio.id,
    eventType: 'folio.charge_added',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { kind: input.kind, description, amountMinor, taxMinor, currency: folio.currency },
  });

  return { folioLineId: line!.id, taxLineId, amountMinor, taxMinor };
}

export interface AdjustBillInput {
  tenantId: string;
  propertyId: string;
  stayId: string;
  /** How much comes OFF the bill — positive. */
  amountMinor: number;
  /** Said on the bill and on the event: "Late breakfast", "Wrong room charged". */
  reason: string;
  /** A correction of one line; absent for a discount on the whole bill. */
  lineId?: string | null;
  currency: CurrencyCode;
  staffUserId: string;
}

/**
 * Take something off: a discount on the stay, or a correction of one line.
 *
 * A negative ADJUSTMENT row with the reason in its description — the guest
 * reads why, and so does whoever looks at this bill in a year. A correction
 * cannot take more off a line than is left on it, and nothing can take the
 * bill below what was charged: money owed BACK is a refund, a different act
 * with a different permission.
 */
export async function adjustBill(
  tx: Tx,
  input: AdjustBillInput,
): Promise<{ folioLineId: string; amountMinor: number }> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new ValidationError('Enter how much comes off.');
  }
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ValidationError('Say why — it is printed on the bill.');

  const folio = await openFolio(tx, input);
  const lines = await tx.select({
    id: folioLines.id, source: folioLines.source, sourceRefId: folioLines.sourceRefId,
    description: folioLines.description, amountMinor: folioLines.amountMinor,
  }).from(folioLines).where(eq(folioLines.folioId, folio.id));

  const charges = lines.filter((l) => l.source !== 'PAYMENT').reduce((sum, l) => sum + l.amountMinor, 0);
  if (input.amountMinor > charges) {
    throw new ValidationError(`Only ${formatMoney(money(Math.max(0, charges), folio.currency))} has been charged.`);
  }

  let description = `Discount — ${reason}`;
  if (input.lineId) {
    const target = lines.find((l) => l.id === input.lineId && l.source !== 'PAYMENT' && l.amountMinor > 0);
    if (!target) throw new NotFoundError('That line is not on this bill.');
    // What is left on it after earlier corrections that point at it.
    const left = target.amountMinor + lines
      .filter((l) => l.source === 'ADJUSTMENT' && l.sourceRefId === target.id)
      .reduce((sum, l) => sum + l.amountMinor, 0);
    if (input.amountMinor > left) {
      throw new ValidationError(`Only ${formatMoney(money(Math.max(0, left), folio.currency))} is left on that line.`);
    }
    description = `Correction · ${target.description} — ${reason}`;
  }

  const [line] = await tx.insert(folioLines).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    folioId: folio.id,
    source: 'ADJUSTMENT',
    sourceRefId: input.lineId ?? null,
    description,
    amountMinor: -input.amountMinor,
    currency: folio.currency,
    postedByStaffId: input.staffUserId,
  }).returning({ id: folioLines.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'folio',
    entityId: folio.id,
    eventType: 'folio.adjusted',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { amountMinor: input.amountMinor, reason, lineId: input.lineId ?? null, currency: folio.currency },
  });

  return { folioLineId: line!.id, amountMinor: input.amountMinor };
}

const REFUND_SCOPE = 'folio.refund';

export interface RefundInput {
  tenantId: string;
  propertyId: string;
  stayId: string;
  amountMinor: number;
  method: PaymentMethod;
  reference?: string | null;
  reason: string;
  staffUserId: string;
  idempotencyKey: string;
}

/**
 * Money given back, when a bill is overpaid.
 *
 * Only up to what was overpaid: a refund is the end of an overpayment, not a
 * way to take money off a bill (that is `adjustBill`). Recorded as a payments
 * row in REFUNDED and a NEGATIVE payment line — `payments.amount_minor` stays
 * positive (it is what changed hands), and the line's sign is what moves the
 * balance back towards zero. Idempotent by key (#8): a double tap on a slow
 * desk gives the money back once.
 */
export async function recordRefund(
  tx: Tx,
  input: RefundInput,
): Promise<{ paymentId: string; balanceMinor: number; wasAlreadyRefunded: boolean }> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new ValidationError('Enter how much was given back.');
  }
  if (!PAYMENT_METHODS.includes(input.method)) throw new ValidationError('Say how it was given back.');
  const reason = input.reason.trim();
  if (reason.length < 3) throw new ValidationError('Say why it was given back.');

  await tx.insert(idempotencyKeys).values({
    tenantId: input.tenantId,
    scope: REFUND_SCOPE,
    key: input.idempotencyKey,
    status: 'IN_PROGRESS',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  }).onConflictDoNothing();
  const [claimed] = await tx.select({ status: idempotencyKeys.status, responseBody: idempotencyKeys.responseBody })
    .from(idempotencyKeys)
    .where(and(
      eq(idempotencyKeys.tenantId, input.tenantId),
      eq(idempotencyKeys.scope, REFUND_SCOPE),
      eq(idempotencyKeys.key, input.idempotencyKey),
    )).limit(1);
  if (claimed?.status === 'COMPLETED' && claimed.responseBody) {
    return { ...(claimed.responseBody as { paymentId: string; balanceMinor: number }), wasAlreadyRefunded: true };
  }

  const [folio] = await tx.select({ id: folios.id, status: folios.status, balanceMinor: folios.balanceMinor, currency: folios.currency })
    .from(folios)
    .where(and(eq(folios.stayId, input.stayId), eq(folios.propertyId, input.propertyId))).limit(1);
  if (!folio) throw new NotFoundError('There is no bill for this stay.');
  if (folio.status !== 'OPEN') throw new ConflictError('This bill is already settled.');
  if (folio.balanceMinor >= 0) throw new ConflictError('Nothing is owed back on this bill.');
  if (input.amountMinor > -folio.balanceMinor) {
    throw new ValidationError(`Only ${formatMoney(money(-folio.balanceMinor, folio.currency as CurrencyCode))} is owed back.`);
  }

  const [payment] = await tx.insert(payments).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    folioId: folio.id,
    provider: 'DESK',
    amountMinor: input.amountMinor,
    currency: folio.currency,
    status: 'REFUNDED',
    method: input.method,
    providerPayload: { reason, ...(input.reference ? { reference: input.reference } : {}) },
    capturedAt: new Date(),
  }).returning({ id: payments.id });

  const methodLabel = { CASH: 'Cash', CARD: 'Card', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', OTHER: 'Payment' }[input.method];
  await tx.insert(folioLines).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    folioId: folio.id,
    source: 'PAYMENT',
    sourceRefId: payment!.id,
    description: `Refund · ${methodLabel}${input.reference ? ` · ${input.reference}` : ''} — ${reason}`,
    amountMinor: -input.amountMinor,
    currency: folio.currency,
    postedByStaffId: input.staffUserId,
  });

  const [after] = await tx.select({ balanceMinor: folios.balanceMinor }).from(folios).where(eq(folios.id, folio.id));
  const balanceMinor = after?.balanceMinor ?? 0;

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'folio',
    entityId: folio.id,
    eventType: 'folio.refunded',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: { paymentId: payment!.id, amountMinor: input.amountMinor, method: input.method, reason, balanceMinor, currency: folio.currency },
  });

  const result = { paymentId: payment!.id, balanceMinor };
  await tx.update(idempotencyKeys)
    .set({ status: 'COMPLETED', responseBody: result })
    .where(and(
      eq(idempotencyKeys.tenantId, input.tenantId),
      eq(idempotencyKeys.scope, REFUND_SCOPE),
      eq(idempotencyKeys.key, input.idempotencyKey),
    ));

  return { ...result, wasAlreadyRefunded: false };
}

/** 1200 → "12%", 250 → "2.5%". */
export function formatRate(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, '')}%`;
}
