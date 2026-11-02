'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import {
  postDeskCharge, adjustBill, recordRefund, recordPayment, DESK_CHARGE_KINDS, PAYMENT_METHODS,
} from '@/modules/billing';
import { checkOutStay, getStayAtDesk } from '@/modules/stay';
import { parseMoneyInput, MoneyInputError, formatMoney, money } from '@/lib/money';
import { AppError, NotFoundError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The checkout screen's buttons (D-095).
 *
 * Who may do what follows the role definitions, not this file: the desk adds
 * charges (`folio:post_charge`) and takes money (`folio:settle`); taking
 * money OFF a bill (`folio:adjust`), giving it back (`payment:refund`) and
 * letting somebody leave owing are the manager's — `payment:refund` is cash
 * leaving the building. Every action confirms the stay is this property's
 * before touching its bill.
 */
export interface CheckoutState {
  error?: string;
  done?: string;
}

const Base = z.object({ propertyId: z.uuid(), stayId: z.uuid() });

async function guard(what: string, run: () => Promise<CheckoutState>): Promise<CheckoutState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MoneyInputError) return { error: error.message };
    if (error instanceof AppError) {
      logger.info({ code: error.code, what }, 'checkout action refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message, what }, 'checkout action failed');
    throw error;
  }
}

function refresh(stayId: string) {
  revalidatePath(`/admin/checkouts/${stayId}`);
  revalidatePath('/admin/checkouts');
  revalidatePath('/admin/rooms');
  revalidatePath('/admin/desk');
}

async function ownStay(tx: Parameters<typeof getStayAtDesk>[0], propertyId: string, stayId: string) {
  const stay = await getStayAtDesk(tx, { propertyId, stayId });
  if (!stay) throw new NotFoundError('That stay is not at this property.');
  return stay;
}

const Charge = Base.extend({
  kind: z.enum(DESK_CHARGE_KINDS),
  detail: z.string().trim().max(120).optional(),
  quantity: z.coerce.number().int().min(1).max(365),
  unitPrice: z.string().min(1, 'Enter what one costs.'),
  taxPercent: z.coerce.number().min(0).max(28),
});

export async function addCharge(_previous: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const parsed = Charge.safeParse({
    propertyId: formData.get('propertyId'),
    stayId: formData.get('stayId'),
    kind: formData.get('kind'),
    detail: formData.get('detail') || undefined,
    quantity: formData.get('quantity') || 1,
    unitPrice: String(formData.get('unitPrice') ?? ''),
    taxPercent: formData.get('taxPercent') || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the charge.' };
  const input = parsed.data;

  return guard('add charge', async () => {
    const session = await requirePermission(input.propertyId, 'folio:post_charge');
    const unit = parseMoneyInput(input.unitPrice, 'INR');
    const posted = await withTenant({ tenantId: session.tenantId, propertyId: input.propertyId }, async (tx) => {
      await ownStay(tx, input.propertyId, input.stayId);
      return postDeskCharge(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        stayId: input.stayId,
        kind: input.kind,
        detail: input.detail,
        quantity: input.quantity,
        unitMinor: unit.amountMinor,
        taxBps: Math.round(input.taxPercent * 100),
        currency: 'INR',
        staffUserId: session.staffUserId,
      });
    });
    refresh(input.stayId);
    const total = formatMoney(money(posted.amountMinor + posted.taxMinor, 'INR'));
    return { done: `Added ${total}${posted.taxMinor ? ' with tax' : ''}.` };
  });
}

const Payment = Base.extend({
  amount: z.string().min(1, 'Enter how much was taken.'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(80).optional(),
  idempotencyKey: z.uuid(),
});

export async function takePayment(_previous: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const parsed = Payment.safeParse({
    propertyId: formData.get('propertyId'),
    stayId: formData.get('stayId'),
    amount: String(formData.get('amount') ?? ''),
    method: formData.get('method'),
    reference: formData.get('reference') || undefined,
    idempotencyKey: formData.get('idempotencyKey'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the payment.' };
  const input = parsed.data;

  return guard('take payment', async () => {
    const session = await requirePermission(input.propertyId, 'folio:settle');
    const amount = parseMoneyInput(input.amount, 'INR');
    const taken = await withTenant({ tenantId: session.tenantId, propertyId: input.propertyId }, async (tx) => {
      await ownStay(tx, input.propertyId, input.stayId);
      return recordPayment(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        stayId: input.stayId,
        amountMinor: amount.amountMinor,
        currency: 'INR',
        method: input.method,
        reference: input.reference,
        staffUserId: session.staffUserId,
        idempotencyKey: input.idempotencyKey,
      });
    });
    refresh(input.stayId);
    const left = taken.balanceMinor;
    return {
      done: left > 0
        ? `Took ${formatMoney(money(taken.amountMinor, 'INR'))}. ${formatMoney(money(left, 'INR'))} still to pay.`
        : left < 0
          ? `Took ${formatMoney(money(taken.amountMinor, 'INR'))}. ${formatMoney(money(-left, 'INR'))} is owed back.`
          : `Took ${formatMoney(money(taken.amountMinor, 'INR'))}. Nothing left to pay.`,
    };
  });
}

const Adjust = Base.extend({
  amount: z.string().min(1, 'Enter how much comes off.'),
  reason: z.string().trim().min(3, 'Say why — it is printed on the bill.').max(160),
  lineId: z.uuid().optional(),
});

export async function adjust(_previous: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const parsed = Adjust.safeParse({
    propertyId: formData.get('propertyId'),
    stayId: formData.get('stayId'),
    amount: String(formData.get('amount') ?? ''),
    reason: String(formData.get('reason') ?? ''),
    lineId: formData.get('lineId') || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the adjustment.' };
  const input = parsed.data;

  return guard('adjust bill', async () => {
    const session = await requirePermission(input.propertyId, 'folio:adjust');
    const amount = parseMoneyInput(input.amount, 'INR');
    await withTenant({ tenantId: session.tenantId, propertyId: input.propertyId }, async (tx) => {
      await ownStay(tx, input.propertyId, input.stayId);
      return adjustBill(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        stayId: input.stayId,
        amountMinor: amount.amountMinor,
        reason: input.reason,
        lineId: input.lineId,
        currency: 'INR',
        staffUserId: session.staffUserId,
      });
    });
    refresh(input.stayId);
    return { done: `${formatMoney(amount)} taken off.` };
  });
}

const Refund = Base.extend({
  amount: z.string().min(1, 'Enter how much was given back.'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(80).optional(),
  reason: z.string().trim().min(3, 'Say why it was given back.').max(160),
  idempotencyKey: z.uuid(),
});

export async function refund(_previous: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const parsed = Refund.safeParse({
    propertyId: formData.get('propertyId'),
    stayId: formData.get('stayId'),
    amount: String(formData.get('amount') ?? ''),
    method: formData.get('method'),
    reference: formData.get('reference') || undefined,
    reason: String(formData.get('reason') ?? ''),
    idempotencyKey: formData.get('idempotencyKey'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the refund.' };
  const input = parsed.data;

  return guard('refund', async () => {
    const session = await requirePermission(input.propertyId, 'payment:refund');
    const amount = parseMoneyInput(input.amount, 'INR');
    await withTenant({ tenantId: session.tenantId, propertyId: input.propertyId }, async (tx) => {
      await ownStay(tx, input.propertyId, input.stayId);
      return recordRefund(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        stayId: input.stayId,
        amountMinor: amount.amountMinor,
        method: input.method,
        reference: input.reference,
        reason: input.reason,
        staffUserId: session.staffUserId,
        idempotencyKey: input.idempotencyKey,
      });
    });
    refresh(input.stayId);
    return { done: `${formatMoney(amount)} given back.` };
  });
}

const CheckOut = Base.extend({
  unpaidReason: z.string().trim().max(160).optional(),
});

export async function checkOut(_previous: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const parsed = CheckOut.safeParse({
    propertyId: formData.get('propertyId'),
    stayId: formData.get('stayId'),
    unpaidReason: formData.get('unpaidReason') || undefined,
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('check out', async () => {
    const session = await requirePermission(input.propertyId, 'stay:check_out');
    // Leaving with money still on the bill is the manager's call, and the
    // reason is recorded on the departure (checkOutStay refuses without one).
    if (input.unpaidReason) await requirePermission(input.propertyId, 'folio:adjust');

    const result = await withTenant({ tenantId: session.tenantId, propertyId: input.propertyId }, async (tx) => {
      await ownStay(tx, input.propertyId, input.stayId);
      return checkOutStay(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        stayId: input.stayId,
        staffUserId: session.staffUserId,
        unpaidReason: input.unpaidReason,
      });
    });
    refresh(input.stayId);
    revalidatePath('/housekeeping');
    return {
      done: result.balanceMinor === 0
        ? 'Checked out. The bill is settled and closed.'
        : `Checked out with ${formatMoney(money(Math.abs(result.balanceMinor), result.currency))} ${result.balanceMinor > 0 ? 'unpaid' : 'owed back'}.`,
    };
  });
}
