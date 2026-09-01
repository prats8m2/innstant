'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { findProperty } from '@/modules/identity';
import { createStay, checkOutStay } from '@/modules/stay';
import { vouchForGuest } from '@/modules/access';
import { atLocalHourOnSameDay } from '@/lib/clock';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The front desk's three buttons.
 *
 * Check-IN goes through `createStay()` — the only place a stay is born (#4).
 * This action is its second real caller after the seeder, which is what that
 * function was written for; when booking arrives it becomes a fourth rather than
 * a sixth code path.
 */

export interface DeskState {
  error?: string;
  done?: string;
}

const CheckIn = z.object({
  propertyId: z.uuid(),
  roomId: z.uuid(),
  fullName: z.string().trim().min(1, 'A name, however they gave it.').max(160),
  phone: z.string().trim().max(32).optional().transform((v) => (v ? v : null)),
  nights: z.coerce.number().int().min(1, 'At least one night.').max(60),
  /**
   * Explicit rather than a constant. There is no property-level standard
   * checkout hour anywhere in the schema, and hardcoding 11 here would be a
   * business value living in a form — the kind this codebase keeps finding and
   * deleting. The desk sees it, and what gets stored is what they saw.
   */
  checkoutHour: z.coerce.number().int().min(0).max(23),
});

export async function checkInGuest(
  _previous: DeskState,
  formData: FormData,
): Promise<DeskState> {
  const parsed = CheckIn.safeParse({
    propertyId: formData.get('propertyId'),
    roomId: formData.get('roomId'),
    fullName: formData.get('fullName') ?? '',
    phone: formData.get('phone') ?? undefined,
    nights: formData.get('nights') ?? '',
    checkoutHour: formData.get('checkoutHour') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details.' };
  }
  const input = parsed.data;

  try {
    const session = await requirePermission(input.propertyId, 'stay:check_in');

    const done = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        const property = await findProperty(tx, input.propertyId);
        const timeZone = property?.timezone ?? 'Asia/Kolkata';

        // The departure day, property-local: a guest checked in at 11pm on a
        // one-night stay leaves tomorrow, not tonight.
        const departureDay = new Date(Date.now() + input.nights * 86_400_000);
        const scheduledCheckoutAt = atLocalHourOnSameDay(
          departureDay, input.checkoutHour, timeZone,
        );

        const created = await createStay(tx, {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          roomId: input.roomId,
          guest: { fullName: input.fullName, phone: input.phone },
          status: 'CHECKED_IN',
          source: 'FRONT_DESK',
          scheduledCheckoutAt,
          actor: { kind: 'STAFF', staffUserId: session.staffUserId },
        });

        return created.guestIsNew
          ? `${input.fullName} is in. Their QR sticker works now.`
          : `${input.fullName} is in — we had them already, so their notes came with them.`;
      },
    );

    revalidatePath('/admin/rooms');
    return { done };
  } catch (error) {
    return handle(error, 'check in');
  }
}

const CheckOut = z.object({
  propertyId: z.uuid(),
  stayId: z.uuid(),
});

export async function checkOutGuest(
  _previous: DeskState,
  formData: FormData,
): Promise<DeskState> {
  const parsed = CheckOut.safeParse({
    propertyId: formData.get('propertyId'),
    stayId: formData.get('stayId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };

  try {
    const session = await requirePermission(parsed.data.propertyId, 'stay:check_out');

    const result = await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      (tx) => checkOutStay(tx, {
        tenantId: session.tenantId,
        propertyId: parsed.data.propertyId,
        stayId: parsed.data.stayId,
        staffUserId: session.staffUserId,
      }),
    );

    logger.info(
      { stayId: result.stayId, balanceMinor: result.balanceMinor, sessions: result.sessionsRevoked },
      'guest checked out',
    );

    revalidatePath('/admin/rooms');
    revalidatePath('/admin/checkouts');

    return {
      done: result.sessionsRevoked === 1
        ? 'Checked out. One phone stopped working; the room is free.'
        : `Checked out. ${result.sessionsRevoked} devices stopped working; the room is free.`,
    };
  } catch (error) {
    return handle(error, 'check out');
  }
}

const Vouch = z.object({
  propertyId: z.uuid(),
  stayId: z.uuid(),
  reason: z.string().trim().max(200).optional().transform((v) => (v ? v : undefined)),
});

/**
 * "Yes, that is the guest in 214."
 *
 * D-012's deliberate bypass of the product's only anti-fraud control, and the
 * reason it has its own permission rather than riding inside `guest:update`.
 * `guest:vouch` has existed since S5 with no way to use it; this is the way.
 *
 * It grants CHARGE and not FULL (D-031): someone else asserting a guest's
 * identity is enough to let a charge through and not enough to hand over their
 * bill. A guest who wants their folio answers the prompt themselves.
 */
export async function vouchForRoom(
  _previous: DeskState,
  formData: FormData,
): Promise<DeskState> {
  const parsed = Vouch.safeParse({
    propertyId: formData.get('propertyId'),
    stayId: formData.get('stayId'),
    reason: formData.get('reason') ?? undefined,
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };

  try {
    const session = await requirePermission(parsed.data.propertyId, 'guest:vouch');

    await vouchForGuest({
      tenantId: session.tenantId,
      propertyId: parsed.data.propertyId,
      stayId: parsed.data.stayId,
      staffUserId: session.staffUserId,
      reason: parsed.data.reason,
    });

    logger.info(
      { stayId: parsed.data.stayId, staffUserId: session.staffUserId },
      'guest vouched for',
    );

    revalidatePath('/admin/rooms');
    return { done: 'Vouched. They can charge to the room without being asked.' };
  } catch (error) {
    return handle(error, 'vouch');
  }
}

function handle(error: unknown, what: string): DeskState {
  if (error instanceof AppError) {
    logger.info({ code: error.code, what }, 'front desk action refused');
    return { error: publicPayloadFor(error).message };
  }
  logger.error({ err: (error as Error).message, what }, 'front desk action failed');
  throw error;
}
