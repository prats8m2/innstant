'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { findProperty } from '@/modules/identity';
import { decideCheckoutRequest } from '@/modules/stay';
import { parseMoneyInput, MoneyInputError } from '@/lib/money';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The desk decides.
 *
 * `checkout_request:approve` and `checkout_request:override_fee` are separate
 * permissions and were separate from the day the model was written — approving
 * a 2pm checkout is a rota decision, and waiving the ₹2,500 that comes with it
 * is money leaving the building. FRONT_DESK holds both (permissions.ts, which
 * calls the waiver "a discount authority… controlled by audit rather than by an
 * approval step"), and a property that disagrees withholds one of them.
 */

export interface DeskCheckoutState {
  error?: string;
  done?: string;
}

const Decide = z.object({
  propertyId: z.uuid(),
  checkoutRequestId: z.uuid(),
  to: z.enum(['APPROVED', 'DECLINED']),
  /** Blank means "charge what the guest agreed to". "0" means waived. */
  fee: z.string().optional(),
  declineReason: z.string().trim().max(200).optional(),
});

export async function decideCheckout(
  _previous: DeskCheckoutState,
  formData: FormData,
): Promise<DeskCheckoutState> {
  const parsed = Decide.safeParse({
    propertyId: formData.get('propertyId'),
    checkoutRequestId: formData.get('checkoutRequestId'),
    to: formData.get('to'),
    fee: formData.get('fee') ?? undefined,
    declineReason: formData.get('declineReason') || undefined,
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  try {
    const session = await requirePermission(input.propertyId, 'checkout_request:approve');

    /**
     * An override is only an override when something was typed. Blank leaves
     * the agreed fee alone; "0" is a deliberate waiver and has to survive as
     * one, which is why this checks the string rather than the parsed number.
     */
    const typed = input.fee?.trim();
    let overriddenFeeMinor: number | null = null;
    if (typed) {
      await requirePermission(input.propertyId, 'checkout_request:override_fee');
      overriddenFeeMinor = parseMoneyInput(typed, 'INR').amountMinor;
    }

    const result = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        const property = await findProperty(tx, input.propertyId);
        return decideCheckoutRequest(tx, {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          checkoutRequestId: input.checkoutRequestId,
          to: input.to,
          overriddenFeeMinor,
          declineReason: input.declineReason ?? null,
          staffUserId: session.staffUserId,
          timeZone: property?.timezone ?? 'Asia/Kolkata',
        });
      },
    );

    logger.info(
      {
        checkoutRequestId: input.checkoutRequestId,
        to: input.to,
        feeMinor: result.feeMinor,
        sessionsExtended: result.sessionsExtended,
      },
      'checkout request decided',
    );

    revalidatePath('/admin/checkouts');
    // The guest's own screen reads the stay and the request.
    revalidatePath('/r/[qrCode]/stay', 'page');

    return {
      done: input.to === 'APPROVED'
        ? result.feeMinor > 0
          ? 'Approved. The stay has moved and the fee is on the folio.'
          : 'Approved, no charge. The stay has moved.'
        : 'Declined. The guest can read your reason on their phone.',
    };
  } catch (error) {
    if (error instanceof MoneyInputError) return { error: error.message };
    if (error instanceof AppError) {
      logger.info({ code: error.code }, 'checkout decision refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, 'checkout decision failed');
    throw error;
  }
}
