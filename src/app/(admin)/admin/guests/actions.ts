'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { updateGuestProfile, DIETARY_FLAGS } from '@/modules/stay';
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
