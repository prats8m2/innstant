'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import {
  getRequestTypeByKey, raiseServiceRequest, advanceRequest, CALL_SERVICE_KEY,
} from '@/modules/requests';
import { AppError, ConflictError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The one tap.
 *
 * "One tap. No queue, no call, no reason needed" is the reference's own copy and
 * it is the whole feature. So: no tier check (CALL_SERVICE is free and free
 * needs nothing but a scan — #9), no confirmation step, and the note is
 * optional.
 */

export interface ServiceCallState {
  error?: string;
}

const Call = z.object({
  qrCode: z.string().min(1),
  idempotencyKey: z.uuid(),
  guestNote: z.string().trim().max(400).optional().transform((v) => (v ? v : null)),
});

export async function callForService(
  _previous: ServiceCallState,
  formData: FormData,
): Promise<ServiceCallState> {
  const parsed = Call.safeParse({
    qrCode: formData.get('qrCode'),
    idempotencyKey: formData.get('idempotencyKey'),
    guestNote: formData.get('guestNote') ?? undefined,
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };

  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) redirect(`/r/${encodeURIComponent(parsed.data.qrCode)}`);

  let requestId: string;
  try {
    const raised = await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      async (tx) => {
        const type = await getRequestTypeByKey(tx, {
          propertyId: session.propertyId,
          key: CALL_SERVICE_KEY,
        });
        // A property can switch this off. Saying so beats a button that does
        // nothing.
        if (!type) {
          throw new ConflictError(
            'Calling for service is not set up here. The front desk can help.',
          );
        }

        return raiseServiceRequest(tx, {
          tenantId: session.tenantId,
          propertyId: session.propertyId,
          stayId: session.stayId,
          roomId: session.roomId,
          lines: [{ requestTypeId: type.id, quantity: 1 }],
          guestNote: parsed.data.guestNote,
          idempotencyKey: parsed.data.idempotencyKey,
          accessTier: session.accessTier,
          guestSessionId: session.id,
        });
      },
    );

    logger.info({ requestNumber: raised.requestNumber }, 'service called');
    requestId = raised.requestId;
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code }, 'service call refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, 'service call failed');
    throw error;
  }

  redirect(`/r/${encodeURIComponent(parsed.data.qrCode)}/service/${requestId}`);
}

const Cancel = z.object({
  qrCode: z.string().min(1),
  requestId: z.uuid(),
});

/**
 * "Actually, never mind."
 *
 * Reachable from every live state, because a guest who found their own towels
 * while a runner was on the stairs is the common case, not a race to prevent
 * (see the request state machine). The reason is written for the person who was
 * already walking.
 */
export async function cancelRequest(
  _previous: ServiceCallState,
  formData: FormData,
): Promise<ServiceCallState> {
  const parsed = Cancel.safeParse({
    qrCode: formData.get('qrCode'),
    requestId: formData.get('requestId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };

  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) redirect(`/r/${encodeURIComponent(parsed.data.qrCode)}`);

  try {
    await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      (tx) => advanceRequest(tx, {
        tenantId: session.tenantId,
        propertyId: session.propertyId,
        requestId: parsed.data.requestId,
        to: 'CANCELLED',
        actor: { kind: 'GUEST', guestSessionId: session.id },
        reason: 'The guest no longer needs it.',
      }),
    );

    // The screen is server-rendered from the request row, so it has to be told.
    // Without this the guest taps "never mind" and nothing appears to happen —
    // which is exactly how an e2e caught it.
    revalidatePath(`/r/${parsed.data.qrCode}/service/${parsed.data.requestId}`);
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: publicPayloadFor(error).message };
    throw error;
  }
}
