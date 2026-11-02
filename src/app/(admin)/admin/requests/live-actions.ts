'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { advanceRequest, raiseServiceRequest, type RequestStatus } from '@/modules/requests';
import { activeStayForRoom } from '@/modules/stay';
import type { Permission } from '@/modules/identity';
import { AppError, NotFoundError, ValidationError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * What a manager can do to a live request from the console (D-094).
 *
 * The same state machine and the same `advanceRequest()` the floor board uses —
 * one event per transition, the guest's timeline updated by the NOTIFY inside
 * it. Nothing here moves a request a way the board could not; what the
 * console adds is choosing WHO.
 *
 * Reassigning is two transitions, ASSIGNED → OPEN → ASSIGNED, in one
 * transaction: the machine has no ASSIGNED → ASSIGNED edge, and the event log
 * then says truthfully that it was taken off one person and given to another.
 *
 * "Mark done" is offered only on a request somebody has: the work is
 * attributed to the assignee in the record the SLA report reads, and a
 * manager closing an unowned request would have to own it first.
 */
export interface LiveRequestState {
  error?: string;
  done?: string;
}

const ACTS = ['assign', 'putBack', 'done', 'verify', 'reject', 'cancel'] as const;
type Act = (typeof ACTS)[number];

const PERMISSION: Record<Act, Permission> = {
  assign: 'request:assign',
  putBack: 'request:assign',
  done: 'request:advance',
  verify: 'request:verify',
  reject: 'request:advance',
  cancel: 'request:cancel',
};

const Input = z.object({
  propertyId: z.uuid(),
  requestId: z.uuid(),
  act: z.enum(ACTS),
  /** The status the console drew the buttons for. A stale one is refused by
   *  the machine, which says what happened instead. */
  from: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED']),
  staffId: z.uuid().optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function actOnRequest(
  _previous: LiveRequestState,
  formData: FormData,
): Promise<LiveRequestState> {
  const parsed = Input.safeParse({
    propertyId: formData.get('propertyId'),
    requestId: formData.get('requestId'),
    act: formData.get('act'),
    from: formData.get('from'),
    staffId: formData.get('staffId') || undefined,
    reason: formData.get('reason') || undefined,
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  try {
    if (input.act === 'assign' && !input.staffId) throw new ValidationError('Choose who should take it.');
    if ((input.act === 'reject' || input.act === 'cancel') && !input.reason) {
      throw new ValidationError(input.act === 'reject'
        ? 'Say why it cannot be done — the guest is told.'
        : 'Say why it is cancelled — the guest is told.');
    }

    const session = await requirePermission(input.propertyId, PERMISSION[input.act]);
    const actor = { kind: 'STAFF' as const, staffUserId: session.staffUserId };
    const move = (to: RequestStatus, extra: { assignedStaffId?: string; reason?: string } = {}) =>
      (tx: Parameters<typeof advanceRequest>[0]) => advanceRequest(tx, {
        tenantId: session.tenantId, propertyId: input.propertyId, requestId: input.requestId, to, actor, ...extra,
      });

    const done = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        switch (input.act) {
          case 'assign':
            if (input.from === 'ASSIGNED') await move('OPEN')(tx);
            await move('ASSIGNED', { assignedStaffId: input.staffId })(tx);
            return 'Assigned. They have it on their phone now.';
          case 'putBack':
            await move('OPEN')(tx);
            return 'Back with nobody. It routes to whoever is free.';
          case 'done':
            if (input.from === 'ASSIGNED') await move('IN_PROGRESS')(tx);
            await move('COMPLETED')(tx);
            return 'Marked done. The guest has been told.';
          case 'verify':
            await move('VERIFIED')(tx);
            return 'Checked.';
          case 'reject':
            await move('REJECTED', { reason: input.reason })(tx);
            return 'Refused. The guest has been told why.';
          case 'cancel':
            await move('CANCELLED', { reason: input.reason })(tx);
            return 'Cancelled.';
        }
      },
    );

    logger.info({ requestId: input.requestId, act: input.act }, 'request acted on from the console');
    revalidatePath('/admin/requests');
    revalidatePath('/admin/desk');
    revalidatePath('/housekeeping');
    return { done };
  } catch (error) {
    if (error instanceof AppError) return { error: publicPayloadFor(error).message };
    logger.error({ err: (error as Error).message }, 'request action failed');
    throw error;
  }
}

const RaiseForPhonedGuest = z.object({
  propertyId: z.uuid(),
  roomId: z.uuid('Choose the room that rang.'),
  requestTypeId: z.uuid('Choose what they asked for.'),
  quantity: z.coerce.number().int().min(1).max(20),
  note: z.string().trim().max(300).optional(),
  idempotencyKey: z.uuid(),
});

/**
 * "Raise for a guest who phoned", from the Requests board (D-096's desk
 * action, reached from where a manager watches the requests). The same call
 * the Rooms panel makes: `raiseServiceRequest()` in the guest's stay, tier
 * FULL on the desk's judgement, the event naming who took the call, and the
 * note saying it came by phone. `stay:update`, as there.
 *
 * The board picks a ROOM; the stay is the one checked in to it now (#10 —
 * the request binds to the stay, never the room).
 */
export async function raiseForPhonedGuest(
  _previous: LiveRequestState,
  formData: FormData,
): Promise<LiveRequestState> {
  const parsed = RaiseForPhonedGuest.safeParse({
    propertyId: formData.get('propertyId'),
    roomId: formData.get('roomId'),
    requestTypeId: formData.get('requestTypeId'),
    quantity: formData.get('quantity') || 1,
    note: formData.get('note') || undefined,
    idempotencyKey: formData.get('idempotencyKey'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the request.' };
  const input = parsed.data;

  try {
    const session = await requirePermission(input.propertyId, 'stay:update');
    const raised = await withTenant({ tenantId: session.tenantId, propertyId: input.propertyId }, async (tx) => {
      const stay = await activeStayForRoom(tx, input.roomId);
      if (!stay) throw new NotFoundError('Nobody is checked in to that room.');
      return raiseServiceRequest(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        stayId: stay.stayId,
        roomId: input.roomId,
        lines: [{ requestTypeId: input.requestTypeId, quantity: input.quantity }],
        guestNote: input.note ? `Taken by phone: ${input.note}` : 'Taken by phone at the desk',
        idempotencyKey: input.idempotencyKey,
        accessTier: 'FULL',
        staffUserId: session.staffUserId,
      });
    });
    revalidatePath('/admin/requests');
    revalidatePath('/admin/rooms');
    revalidatePath('/housekeeping');
    return { done: `${raised.requestNumber} raised. It goes to whoever is on that floor.` };
  } catch (error) {
    if (error instanceof AppError) return { error: publicPayloadFor(error).message };
    logger.error({ err: (error as Error).message }, 'raise for a phoned guest failed');
    throw error;
  }
}
