'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { advanceOrder, type OrderStatus } from '@/modules/ordering';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { Permission } from '@/modules/identity';

/**
 * The kitchen's four buttons.
 *
 * One action, because every one of them is the same transition with a different
 * target — and because the permission each needs is data, not a branch someone
 * has to remember to add.
 *
 * `order:advance` is not enough for all of them on purpose: accepting and
 * rejecting are commitments to the guest, and the KITCHEN role holds them
 * deliberately (see the note on that role in permissions.ts). A screen left
 * logged in overnight in a hot kitchen is the credential most likely to be
 * misused, so it is thin.
 */
const PERMISSION_FOR: Partial<Record<OrderStatus, Permission>> = {
  ACCEPTED: 'order:accept',
  REJECTED: 'order:reject',
  PREPARING: 'order:advance',
  READY: 'order:advance',
  OUT_FOR_DELIVERY: 'order:advance',
  DELIVERED: 'order:advance',
  CANCELLED: 'order:cancel',
};

const Bump = z.object({
  propertyId: z.uuid(),
  orderId: z.uuid(),
  to: z.enum(['ACCEPTED', 'REJECTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']),
  reason: z.string().max(200).optional(),
});

export interface BumpState {
  error?: string;
}

export async function bumpOrder(
  _previous: BumpState,
  formData: FormData,
): Promise<BumpState> {
  const parsed = Bump.safeParse({
    propertyId: formData.get('propertyId'),
    orderId: formData.get('orderId'),
    to: formData.get('to'),
    reason: formData.get('reason') || undefined,
  });
  if (!parsed.success) return { error: 'That did not come through. Try the ticket again.' };

  const permission = PERMISSION_FOR[parsed.data.to];
  if (!permission) return { error: 'That is not something this screen can do.' };

  try {
    // Server-side, every time. The middleware is a turnstile and the buttons
    // rendered on the page are a suggestion.
    const session = await requirePermission(parsed.data.propertyId, permission);

    const result = await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      (tx) => advanceOrder(tx, {
        tenantId: session.tenantId,
        propertyId: parsed.data.propertyId,
        orderId: parsed.data.orderId,
        to: parsed.data.to,
        reason: parsed.data.reason,
        actor: { kind: 'STAFF', staffUserId: session.staffUserId },
      }),
    );

    logger.info(
      { orderNumber: result.orderNumber, from: result.from, to: result.to },
      'order advanced',
    );

    // The rail is server-rendered; every other screen hears about it through
    // the NOTIFY that advanceOrder() fired inside the same transaction.
    revalidatePath('/kds');
    return {};
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code }, 'bump refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, 'bump failed');
    throw error;
  }
}
