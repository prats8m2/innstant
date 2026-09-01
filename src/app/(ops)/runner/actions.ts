'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { advanceOrder } from '@/modules/ordering';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The runner's two buttons.
 *
 * Separate from the kitchen's `bumpOrder` on purpose, even though both end in
 * `advanceOrder()`. Picking a tray up is not just a status: it records WHO is
 * carrying it, and that only makes sense from the surface where the person
 * holding the phone is the person carrying the tray. Folding it into the
 * kitchen's action would mean a flag that decides whether to attribute the
 * order to whoever tapped, which is exactly the kind of branch that ends up
 * assigning a tray to a tablet on a wall.
 */
const Move = z.object({
  propertyId: z.uuid(),
  orderId: z.uuid(),
  to: z.enum(['OUT_FOR_DELIVERY', 'DELIVERED']),
});

export interface MoveState {
  error?: string;
}

export async function moveTray(
  _previous: MoveState,
  formData: FormData,
): Promise<MoveState> {
  const parsed = Move.safeParse({
    propertyId: formData.get('propertyId'),
    orderId: formData.get('orderId'),
    to: formData.get('to'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try the card again.' };

  try {
    // Server-side, every time. The middleware is a turnstile and the buttons on
    // the page are a suggestion.
    const session = await requirePermission(parsed.data.propertyId, 'order:advance');

    const result = await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      (tx) => advanceOrder(tx, {
        tenantId: session.tenantId,
        propertyId: parsed.data.propertyId,
        orderId: parsed.data.orderId,
        to: parsed.data.to,
        actor: { kind: 'STAFF', staffUserId: session.staffUserId },
        /**
         * Whoever taps "Take it up" owns the tray from here. Only set on the
         * pickup: leaving it out of the DELIVERED hop means a runner who hands
         * over someone else's tray does not quietly become its owner in the
         * record, which is what the SLA report reads later.
         */
        ...(parsed.data.to === 'OUT_FOR_DELIVERY'
          ? { assignedRunnerId: session.staffUserId }
          : {}),
      }),
    );

    logger.info(
      { orderNumber: result.orderNumber, from: result.from, to: result.to },
      'tray moved',
    );

    // This screen is server-rendered; every other one hears about it through
    // the NOTIFY that advanceOrder() fired inside the same transaction.
    revalidatePath('/runner');
    return {};
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code }, 'tray move refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, 'tray move failed');
    throw error;
  }
}
