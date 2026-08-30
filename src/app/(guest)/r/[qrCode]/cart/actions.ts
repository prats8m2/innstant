'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withTenant } from '@/db';
import {
  resolveGuestSession, GUEST_SESSION_COOKIE,
  requireTier, startPhoneLast4Challenge, answerChallenge,
} from '@/modules/access';
import { setCartItemQuantity, removeCartItem, placeOrder } from '@/modules/ordering';
import { AppError, UnauthenticatedError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Editing the order.
 *
 * Both actions are plain form posts — the steppers and the remove control work
 * with JavaScript off, which on a hotel connection is not a hypothetical. The
 * cart screen has no client component at all.
 *
 * Neither action trusts the line id. `setCartItemQuantity` resolves it against
 * THIS stay's cart; a line id from another room in the same hotel is a 404
 * (RLS confines it to the tenant, the stay check confines it to the guest).
 */
const EditLine = z.object({
  qrCode: z.string().min(1).max(64),
  cartItemId: z.uuid(),
  quantity: z.coerce.number().int().min(0).max(20).optional(),
});

export interface CartEditState {
  error?: string;
  /**
   * Set when sending hit the product's ONE verification prompt (D-012).
   *
   * Its presence is what makes the screen show the prompt instead of the send
   * button. Everything needed to finish the original action is carried in it —
   * including the idempotency key, so a guest who tapped Send twice before
   * verifying still gets one order (#8).
   */
  escalation?: {
    challengeId: string;
    escalationId: string;
    idempotencyKey: string;
    attemptsLeft?: number;
  };
}

async function withStay<T>(
  fn: (ctx: { tenantId: string; propertyId: string; stayId: string }) => Promise<T>,
): Promise<T> {
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) throw new UnauthenticatedError('no guest session');
  return fn({
    tenantId: session.tenantId,
    propertyId: session.propertyId,
    stayId: session.stayId,
  });
}

export async function updateLineQuantity(
  _previous: CartEditState,
  formData: FormData,
): Promise<CartEditState> {
  const parsed = EditLine.safeParse({
    qrCode: formData.get('qrCode'),
    cartItemId: formData.get('cartItemId'),
    quantity: formData.get('quantity'),
  });
  if (!parsed.success || parsed.data.quantity === undefined) {
    return { error: 'That change did not come through. Try again.' };
  }

  try {
    await withStay(({ tenantId, propertyId, stayId }) =>
      withTenant({ tenantId, propertyId }, (tx) =>
        setCartItemQuantity(tx, {
          stayId,
          cartItemId: parsed.data.cartItemId,
          quantity: parsed.data.quantity!,
        })));

    revalidatePath(`/r/${parsed.data.qrCode}/cart`);
    revalidatePath(`/r/${parsed.data.qrCode}/menu`);
    return {};
  } catch (error) {
    return handle(error);
  }
}

export async function removeLine(
  _previous: CartEditState,
  formData: FormData,
): Promise<CartEditState> {
  const parsed = EditLine.safeParse({
    qrCode: formData.get('qrCode'),
    cartItemId: formData.get('cartItemId'),
  });
  if (!parsed.success) return { error: 'That change did not come through. Try again.' };

  try {
    await withStay(({ tenantId, propertyId, stayId }) =>
      withTenant({ tenantId, propertyId }, (tx) =>
        removeCartItem(tx, { stayId, cartItemId: parsed.data.cartItemId })));

    revalidatePath(`/r/${parsed.data.qrCode}/cart`);
    revalidatePath(`/r/${parsed.data.qrCode}/menu`);
    return {};
  } catch (error) {
    return handle(error);
  }
}

function handle(error: unknown): CartEditState {
  if (error instanceof AppError) {
    logger.info({ code: error.code, ...error.context }, 'cart edit refused');
    return { error: publicPayloadFor(error).message };
  }
  logger.error({ err: (error as Error).message }, 'cart edit failed');
  throw error;
}

/**
 * Sending the order to the kitchen.
 *
 * The idempotency key is minted when the cart screen RENDERS and travels in the
 * form (#8). That is the whole trick: two taps submit the same form, so they
 * carry the same key, and `placeOrder()` returns the first order to both
 * instead of cooking dinner twice. A key generated here, inside the action,
 * would be different per tap and would defeat the mechanism entirely.
 */
const SendOrder = z.object({
  qrCode: z.string().min(1).max(64),
  idempotencyKey: z.uuid(),
});

export async function sendOrder(
  _previous: CartEditState,
  formData: FormData,
): Promise<CartEditState> {
  const parsed = SendOrder.safeParse({
    qrCode: formData.get('qrCode'),
    idempotencyKey: formData.get('idempotencyKey'),
  });
  if (!parsed.success) return { error: 'That order could not be sent. Try again.' };

  let orderId: string;
  try {
    const session = await currentSession();

    /**
     * D-012, and the single most important branch in the product.
     *
     * An insufficient tier does NOT 403 here. A bare scan grants REQUEST and
     * browsing was never gated (#9); this is the first moment money is about to
     * move, which is exactly where the one prompt belongs. The guest is asked
     * one question and then let through — a refusal here would be the design
     * that was built, rejected and removed.
     */
    const check = await requireTier(session, 'place_order');
    if (check.required) {
      const challengeId = await startPhoneLast4Challenge(session);
      logger.info(
        { escalationId: check.escalationId, from: check.fromTier, to: check.toTier },
        'escalation prompted',
      );
      return {
        escalation: {
          challengeId,
          escalationId: check.escalationId,
          idempotencyKey: parsed.data.idempotencyKey,
        },
      };
    }

    orderId = await send(session, parsed.data.qrCode, parsed.data.idempotencyKey, session.accessTier);
  } catch (error) {
    return handle(error);
  }

  redirect(`/r/${encodeURIComponent(parsed.data.qrCode)}/order/${orderId}`);
}

const VerifyAndSend = z.object({
  qrCode: z.string().min(1).max(64),
  challengeId: z.uuid(),
  escalationId: z.uuid(),
  idempotencyKey: z.uuid(),
  answer: z.string().min(1).max(8),
});

/**
 * Answer the prompt, and then finish what the guest was doing.
 *
 * Verifying and then making them press Send again would turn one interruption
 * into two. The order is placed in the same request, with the SAME idempotency
 * key the send carried, so the whole detour is still one order.
 */
export async function verifyAndSend(
  _previous: CartEditState,
  formData: FormData,
): Promise<CartEditState> {
  const parsed = VerifyAndSend.safeParse({
    qrCode: formData.get('qrCode'),
    challengeId: formData.get('challengeId'),
    escalationId: formData.get('escalationId'),
    idempotencyKey: formData.get('idempotencyKey'),
    answer: formData.get('answer'),
  });
  if (!parsed.success) {
    return { error: 'Enter the last four digits of the phone number on your booking.' };
  }

  const carry = {
    challengeId: parsed.data.challengeId,
    escalationId: parsed.data.escalationId,
    idempotencyKey: parsed.data.idempotencyKey,
  };

  let orderId: string;
  try {
    const session = await currentSession();
    const result = await answerChallenge(
      session,
      parsed.data.challengeId,
      parsed.data.answer,
      parsed.data.escalationId,
    );

    if (!result.ok) {
      // Still escalating — the prompt stays, with the count. Saying how many
      // attempts remain is the difference between a form and a dead end.
      return {
        escalation: { ...carry, attemptsLeft: result.attemptsLeft },
        error: result.attemptsLeft === 1
          ? 'That does not match. One more attempt before this room is locked for 30 minutes.'
          : 'That does not match the number on your booking. Try again.',
      };
    }

    logger.info({ escalationId: parsed.data.escalationId }, 'escalation succeeded');
    orderId = await send(session, parsed.data.qrCode, parsed.data.idempotencyKey, result.newTier!);
  } catch (error) {
    const handled = handle(error);
    // Keep the prompt on screen for anything the guest can retry — a lockout
    // message under a vanished form is not actionable.
    return { ...handled, escalation: carry };
  }

  redirect(`/r/${encodeURIComponent(parsed.data.qrCode)}/order/${orderId}`);
}

/** Resolve the guest session, or say plainly that there is not one. */
async function currentSession() {
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) throw new UnauthenticatedError('no guest session');
  return session;
}

async function send(
  session: Awaited<ReturnType<typeof currentSession>>,
  qrCode: string,
  idempotencyKey: string,
  accessTier: Parameters<typeof placeOrder>[1]['accessTier'],
): Promise<string> {
  const placed = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    (tx) => placeOrder(tx, {
      tenantId: session.tenantId,
      propertyId: session.propertyId,
      stayId: session.stayId,
      roomNumber: session.roomNumber,
      idempotencyKey,
      guestSessionId: session.id,
      accessTier,
    }),
  );

  logger.info(
    { orderNumber: placed.orderNumber, replay: placed.wasAlreadyPlaced },
    'order placed',
  );
  revalidatePath(`/r/${qrCode}/menu`);
  return placed.orderId;
}
