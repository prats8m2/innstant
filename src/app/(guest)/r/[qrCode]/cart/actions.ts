'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
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
    const store = await cookies();
    const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);
    if (!session) throw new UnauthenticatedError('no guest session');

    const placed = await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      (tx) => placeOrder(tx, {
        tenantId: session.tenantId,
        propertyId: session.propertyId,
        stayId: session.stayId,
        roomNumber: session.roomNumber,
        idempotencyKey: parsed.data.idempotencyKey,
        guestSessionId: session.id,
      }),
    );

    logger.info(
      { orderNumber: placed.orderNumber, replay: placed.wasAlreadyPlaced },
      'order placed',
    );

    revalidatePath(`/r/${parsed.data.qrCode}/menu`);
    orderId = placed.orderId;
  } catch (error) {
    return handle(error);
  }

  // Outside the try: redirect() throws a control-flow signal that must not be
  // caught and reported to the guest as a failure.
  redirect(`/r/${encodeURIComponent(parsed.data.qrCode)}/order/${orderId}`);
}
