'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { advanceOrder, type OrderStatus } from '@/modules/ordering';
import { getInRoomDiningOutletConfig, setMenuItemAvailability } from '@/modules/catalog';
import { AppError, NotFoundError, publicPayloadFor } from '@/lib/errors';
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

/**
 * 86 a dish from the kitchen display, and put it back again.
 *
 * `catalog:availability` and nothing more — the KITCHEN role holds exactly that
 * (permissions.ts), which is the whole reason the permission was split out from
 * `catalog:manage`. A cook who has run out of sole must be able to say so from
 * the screen in front of them, at 9pm, without holding the permission to
 * reprice the menu.
 *
 * Its own action rather than a branch in `bumpOrder`: that one moves an ORDER
 * through the state machine, and this changes the CATALOG. Same screen, two
 * different things, two different permissions.
 *
 * ─── Why one action takes both directions ─────────────────────────────────
 *
 * The 86 tray puts a dish back, and putting it back is the same write with the
 * boolean flipped — same permission, same table, same event_log entity, and
 * `setMenuItemAvailability()` already took the flag. Two actions would have
 * been two copies of the identical guard, and the pair that must agree about
 * which permission governs "what the guest can order tonight" is exactly the
 * pair to keep in one function.
 */
const Availability = z.object({
  propertyId: z.uuid(),
  menuItemId: z.uuid(),
  // A checkbox-shaped string, because it arrives through FormData. Absent is
  // false, which is the direction a cook taps twenty times a service.
  available: z.enum(['true', 'false']).default('false'),
});

export async function setDishAvailability(
  _previous: BumpState,
  formData: FormData,
): Promise<BumpState> {
  const parsed = Availability.safeParse({
    propertyId: formData.get('propertyId'),
    menuItemId: formData.get('menuItemId'),
    available: formData.get('available') ?? 'false',
  });
  if (!parsed.success) return { error: 'That did not come through. Try the ticket again.' };

  const isAvailable = parsed.data.available === 'true';

  try {
    const session = await requirePermission(parsed.data.propertyId, 'catalog:availability');

    const item = await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      async (tx) => {
        const outlet = await getInRoomDiningOutletConfig(tx, parsed.data.propertyId);
        if (!outlet) throw new NotFoundError('No kitchen here.');
        return setMenuItemAvailability(tx, {
          tenantId: session.tenantId,
          propertyId: parsed.data.propertyId,
          outletId: outlet.id,
          itemId: parsed.data.menuItemId,
          isAvailable,
          actorStaffId: session.staffUserId,
        });
      },
    );

    logger.info({ name: item.name, isAvailable }, isAvailable ? 'dish put back' : 'dish 86d from the kds');

    // The guest menu is rendered per request, so there is nothing to invalidate
    // there — the next guest to look simply does not see it.
    revalidatePath('/kds');
    return {};
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code }, '86 refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, '86 failed');
    throw error;
  }
}
