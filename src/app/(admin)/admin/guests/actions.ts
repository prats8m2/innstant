'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { updateGuestProfile, DIETARY_FLAGS } from '@/modules/stay';
import { recordPayment, PAYMENT_METHODS } from '@/modules/billing';
import { parseMoneyInput, formatMoney, money, MoneyInputError } from '@/lib/money';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * What this property writes down about a guest.
 *
 * Two of these fields change what the product DOES rather than what it displays:
 * `chargingBlocked` refuses every charge to the room, and `dietaryFlags` reaches
 * the kitchen on every ticket they send. Both are behind `guest:update`, and both
 * leave a diff in the log.
 */

export interface GuestProfileState {
  error?: string;
  done?: string;
}

const Profile = z.object({
  propertyId: z.uuid(),
  guestId: z.uuid(),
  isVip: z.boolean(),
  chargingBlocked: z.boolean(),
  staffNotes: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
  dietaryFlags: z.array(z.enum(DIETARY_FLAGS)),
});

export async function saveGuestProfile(
  _previous: GuestProfileState,
  formData: FormData,
): Promise<GuestProfileState> {
  const parsed = Profile.safeParse({
    propertyId: formData.get('propertyId'),
    guestId: formData.get('guestId'),
    isVip: formData.get('isVip') === 'on',
    chargingBlocked: formData.get('chargingBlocked') === 'on',
    staffNotes: formData.get('staffNotes') ?? undefined,
    dietaryFlags: formData.getAll('dietaryFlags').map(String),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details.' };
  }
  const input = parsed.data;

  try {
    const session = await requirePermission(input.propertyId, 'guest:update');

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => updateGuestProfile(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        guestId: input.guestId,
        isVip: input.isVip,
        chargingBlocked: input.chargingBlocked,
        staffNotes: input.staffNotes,
        dietaryFlags: input.dietaryFlags,
        staffUserId: session.staffUserId,
      }),
    );

    logger.info(
      { guestId: input.guestId, chargingBlocked: input.chargingBlocked },
      'guest profile saved',
    );

    revalidatePath(`/admin/guests/${input.guestId}`);
    // The room board shows the guest's name and the kitchen reads the flags.
    revalidatePath('/admin/rooms');

    return {
      done: input.chargingBlocked
        ? 'Saved. Charges to their room will be refused until you lift this.'
        : 'Saved.',
    };
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code }, 'guest profile save refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, 'guest profile save failed');
    throw error;
  }
}

/* ── Taking the money ───────────────────────────────────────────────────── */

const TakePayment = z.object({
  propertyId: z.uuid(),
  stayId: z.uuid(),
  guestId: z.uuid(),
  amount: z.string().min(1, 'Enter how much was taken.'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(64).optional().transform((v) => (v ? v : null)),
  /**
   * #8. Minted when the screen renders and passed in, so both halves of a
   * double-click carry the SAME key — generating it here would produce a
   * different one per click and take the money twice, which is the exact
   * failure the key exists to prevent.
   */
  idempotencyKey: z.uuid(),
});

/**
 * The desk took the money. Somewhere else — a card machine, a drawer, a bank
 * transfer — and this records it.
 *
 * `folio:settle` and not `folio:post_charge`: adding to a bill and settling one
 * are different authorities, and permissions.ts has kept them apart since S5.
 * FRONT_DESK holds both; a role that can order room service for a guest need not
 * be able to mark their bill paid.
 */
export async function takePayment(
  _previous: GuestProfileState,
  formData: FormData,
): Promise<GuestProfileState> {
  const parsed = TakePayment.safeParse({
    propertyId: formData.get('propertyId'),
    stayId: formData.get('stayId'),
    guestId: formData.get('guestId'),
    amount: formData.get('amount') ?? '',
    method: formData.get('method') ?? '',
    reference: formData.get('reference') ?? undefined,
    idempotencyKey: formData.get('idempotencyKey'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the payment.' };
  }
  const input = parsed.data;

  try {
    const session = await requirePermission(input.propertyId, 'folio:settle');

    const amount = parseMoneyInput(input.amount, 'INR');

    const result = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => recordPayment(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        stayId: input.stayId,
        amountMinor: amount.amountMinor,
        currency: 'INR',
        method: input.method,
        reference: input.reference,
        staffUserId: session.staffUserId,
        idempotencyKey: input.idempotencyKey,
      }),
    );

    logger.info(
      {
        stayId: input.stayId,
        amountMinor: result.amountMinor,
        method: input.method,
        balanceMinor: result.balanceMinor,
        replay: result.wasAlreadyTaken,
      },
      'payment taken at the desk',
    );

    revalidatePath(`/admin/guests/${input.guestId}`);
    revalidatePath('/admin/rooms');
    // The guest is reading the same bill on their own phone.
    revalidatePath('/r/[qrCode]/stay', 'page');

    const left = formatMoney(money(Math.abs(result.balanceMinor), 'INR'));
    return {
      done: result.balanceMinor === 0
        ? 'Taken. The bill is square — checking them out will close it.'
        : result.balanceMinor > 0
          ? `Taken. ${left} still on the room.`
          : `Taken. That is ${left} more than the bill — the difference is owed back.`,
    };
  } catch (error) {
    if (error instanceof MoneyInputError) return { error: error.message };
    if (error instanceof AppError) {
      logger.info({ code: error.code }, 'payment refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, 'payment failed');
    throw error;
  }
}
