'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { advanceRequest, type RequestStatus } from '@/modules/requests';
import { clockIn, clockOut } from '@/modules/housekeeping';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { Permission } from '@/modules/identity';

/**
 * The board's buttons.
 *
 * One action for every transition, because each needs the same four things — a
 * legality check the machine already owns, the permission, a reason where the
 * guest is told, and a revalidate. Three near-identical actions would be three
 * places to forget one.
 *
 * `request:verify` is separate from `request:advance` on purpose: the person who
 * did the work and the person who checks it are different people (the state
 * machine has VERIFIED for exactly that), and a property that wants the second
 * signature can withhold the permission from whoever did the first.
 */
const PERMISSION_FOR: Partial<Record<RequestStatus, Permission>> = {
  ASSIGNED: 'request:assign',
  IN_PROGRESS: 'request:advance',
  COMPLETED: 'request:advance',
  VERIFIED: 'request:verify',
  REJECTED: 'request:advance',
  CANCELLED: 'request:cancel',
  OPEN: 'request:assign',
};

export interface BoardState {
  error?: string;
}

const Move = z.object({
  propertyId: z.uuid(),
  requestId: z.uuid(),
  to: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'REJECTED']),
  reason: z.string().trim().max(200).optional(),
  /** "Take it" sets the assignee to whoever tapped. */
  claim: z.boolean().optional(),
});

export async function moveRequest(
  _previous: BoardState,
  formData: FormData,
): Promise<BoardState> {
  const parsed = Move.safeParse({
    propertyId: formData.get('propertyId'),
    requestId: formData.get('requestId'),
    to: formData.get('to'),
    reason: formData.get('reason') || undefined,
    claim: formData.get('claim') === 'true',
  });
  if (!parsed.success) return { error: 'That did not come through. Try the card again.' };

  const permission = PERMISSION_FOR[parsed.data.to];
  if (!permission) return { error: 'That is not something this screen can do.' };

  try {
    // Server-side, every time. The middleware is a turnstile and the buttons on
    // the page are a suggestion.
    const session = await requirePermission(parsed.data.propertyId, permission);

    const result = await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      (tx) => advanceRequest(tx, {
        tenantId: session.tenantId,
        propertyId: parsed.data.propertyId,
        requestId: parsed.data.requestId,
        to: parsed.data.to,
        reason: parsed.data.reason,
        actor: { kind: 'STAFF', staffUserId: session.staffUserId },
        /**
         * Whoever taps takes it on. Only on the claiming transitions — a
         * housekeeper who completes someone else's request must not quietly
         * become its owner in the record, which is what the SLA report reads.
         */
        ...(parsed.data.claim ? { assignedStaffId: session.staffUserId } : {}),
      }),
    );

    logger.info(
      { requestNumber: result.requestNumber, from: result.from, to: result.to },
      'request moved',
    );

    // The board is server-rendered; every other screen hears about it through
    // the NOTIFY that advanceRequest() fired inside the same transaction.
    revalidatePath('/housekeeping');
    return {};
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code }, 'request move refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, 'request move failed');
    throw error;
  }
}

/* ── Clocking in and out ──────────────────────────────────────────────────── */

const Shift = z.object({
  propertyId: z.uuid(),
  floorIds: z.array(z.uuid()).min(1, 'Choose at least one floor to cover.'),
});

/**
 * Clock in for the floors you are covering.
 *
 * `shift:clock` and nothing more — this is the permission every floor role holds
 * and no manager needs. Routing is the reason it exists: without a shift with
 * zones on it, "on shift ∩ covers floor" has no data behind it and every
 * request waits for someone to notice it.
 */
export async function startShift(
  _previous: BoardState,
  formData: FormData,
): Promise<BoardState> {
  const parsed = Shift.safeParse({
    propertyId: formData.get('propertyId'),
    floorIds: formData.getAll('floorIds').map(String),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Choose the floors you are covering.' };
  }

  try {
    const session = await requirePermission(parsed.data.propertyId, 'shift:clock');

    await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      (tx) => clockIn(tx, {
        tenantId: session.tenantId,
        propertyId: parsed.data.propertyId,
        staffUserId: session.staffUserId,
        floorIds: parsed.data.floorIds,
      }),
    );

    logger.info(
      { staffUserId: session.staffUserId, floors: parsed.data.floorIds.length },
      'clocked in',
    );
    revalidatePath('/housekeeping');
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: publicPayloadFor(error).message };
    logger.error({ err: (error as Error).message }, 'clock in failed');
    throw error;
  }
}

export async function endShift(
  _previous: BoardState,
  formData: FormData,
): Promise<BoardState> {
  const propertyId = z.uuid().safeParse(formData.get('propertyId'));
  if (!propertyId.success) return { error: 'That did not come through. Try again.' };

  try {
    const session = await requirePermission(propertyId.data, 'shift:clock');

    await withTenant(
      { tenantId: session.tenantId, propertyId: propertyId.data },
      (tx) => clockOut(tx, {
        tenantId: session.tenantId,
        propertyId: propertyId.data,
        staffUserId: session.staffUserId,
      }),
    );

    logger.info({ staffUserId: session.staffUserId }, 'clocked out');
    revalidatePath('/housekeeping');
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: publicPayloadFor(error).message };
    logger.error({ err: (error as Error).message }, 'clock out failed');
    throw error;
  }
}
