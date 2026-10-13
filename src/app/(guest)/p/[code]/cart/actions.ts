'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withTenant } from '@/db';
import { resolveVisitSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import {
  setCartItemQuantity, removeCartItem, placeOrder, contextForSession,
  type OrderContext,
} from '@/modules/ordering';
import { setVisitDetails, destinationLabelFor, VISIT_FULFILMENTS } from '@/modules/visit';
import { AppError, UnauthenticatedError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Editing and sending a property-link order. D-079.
 *
 * ─── What replaces the verification prompt ─────────────────────────────────
 *
 * The room flow's version of this file carries an escalation state: the guest
 * taps send, the tier check fires, and the screen asks for the last four digits
 * of the phone on the stay. There is none of that here, and its absence is the
 * design rather than a gap — see modules/access/visit-sessions.ts. A visit
 * posts nothing to anybody's room, so the fraud that prompt defends against
 * cannot happen.
 *
 * What IS asked for is a name and a number, in one form, at the same moment the
 * order is sent. Not as a gate — as the thing a kitchen needs to ring somebody
 * when the food is ready, and the thing a delivery needs to arrive somewhere.
 * `setVisitDetails()` enforces it in the domain, because a form is an
 * affordance and an affordance is not a control.
 *
 * Both actions are plain form posts, so the steppers and the send work with
 * JavaScript off. On a restaurant's wifi that is not a hypothetical either.
 */
const EditLine = z.object({
  code: z.string().min(1).max(64),
  cartItemId: z.uuid(),
  quantity: z.coerce.number().int().min(0).max(20).optional(),
});

export interface CartEditState {
  error?: string;
  /** Which field the message belongs under, when it belongs under one. */
  field?: 'name' | 'phone' | 'address';
}

async function withVisit<T>(
  fn: (ctx: { tenantId: string; propertyId: string; context: OrderContext }) => Promise<T>,
): Promise<T> {
  const store = await cookies();
  const session = await resolveVisitSession(store.get(GUEST_SESSION_COOKIE)?.value);
  if (!session) throw new UnauthenticatedError('no visit session');
  return fn({
    tenantId: session.tenantId,
    propertyId: session.propertyId,
    context: contextForSession(session),
  });
}

export async function updateLineQuantity(
  _previous: CartEditState,
  formData: FormData,
): Promise<CartEditState> {
  const parsed = EditLine.safeParse({
    code: formData.get('code'),
    cartItemId: formData.get('cartItemId'),
    quantity: formData.get('quantity'),
  });
  if (!parsed.success || parsed.data.quantity === undefined) {
    return { error: 'That change did not come through. Try again.' };
  }

  try {
    await withVisit(({ tenantId, propertyId, context }) =>
      withTenant({ tenantId, propertyId }, (tx) =>
        setCartItemQuantity(tx, {
          context,
          cartItemId: parsed.data.cartItemId,
          quantity: parsed.data.quantity!,
        })));

    revalidatePath(`/p/${parsed.data.code}/cart`);
    revalidatePath(`/p/${parsed.data.code}/menu`);
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
    code: formData.get('code'),
    cartItemId: formData.get('cartItemId'),
  });
  if (!parsed.success) return { error: 'That change did not come through. Try again.' };

  try {
    await withVisit(({ tenantId, propertyId, context }) =>
      withTenant({ tenantId, propertyId }, (tx) =>
        removeCartItem(tx, { context, cartItemId: parsed.data.cartItemId })));

    revalidatePath(`/p/${parsed.data.code}/cart`);
    revalidatePath(`/p/${parsed.data.code}/menu`);
    return {};
  } catch (error) {
    return handle(error);
  }
}

/**
 * Who this is, where it goes, and send.
 *
 * ─── Why identifying and sending are ONE action ────────────────────────────
 *
 * They could be two: save the details, then send. That shape was rejected
 * because of what it does on a failure. A customer who fills in a name and a
 * number and then hits a closed kitchen has given their details to a screen
 * that cannot do anything with them — and a customer who taps send twice on a
 * slow connection, with the save already committed, has to be reasoned about
 * separately from the idempotency key that protects the order itself.
 *
 * As one action both happen in ONE transaction. Either the kitchen has the
 * order and the kitchen has the number, or neither happened and the form still
 * holds what they typed.
 */
const SendOrder = z.object({
  code: z.string().min(1).max(64),
  idempotencyKey: z.uuid(),
  name: z.string().min(1).max(80),
  phone: z.string().min(1).max(32),
  fulfilment: z.enum(VISIT_FULFILMENTS),
  address: z.string().max(400).optional(),
  addressNotes: z.string().max(280).optional(),
});

export async function sendVisitOrder(
  _previous: CartEditState,
  formData: FormData,
): Promise<CartEditState> {
  const parsed = SendOrder.safeParse({
    code: formData.get('code'),
    idempotencyKey: formData.get('idempotencyKey'),
    name: formData.get('name'),
    phone: formData.get('phone'),
    fulfilment: formData.get('fulfilment'),
    address: formData.get('address') || undefined,
    addressNotes: formData.get('addressNotes') || undefined,
  });

  if (!parsed.success) {
    // Zod's own messages are for developers. The screen says what to do.
    const field = parsed.error.issues[0]?.path[0];
    if (field === 'name') return { error: 'We need a name for the order.', field: 'name' };
    if (field === 'phone') {
      return { error: 'A number, so the kitchen can call when it is ready.', field: 'phone' };
    }
    return { error: 'That did not come through. Try again.' };
  }

  const store = await cookies();
  let orderId: string;

  try {
    const session = await resolveVisitSession(store.get(GUEST_SESSION_COOKIE)?.value);
    if (!session) throw new UnauthenticatedError('no visit session');

    const placed = await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      async (tx) => {
        // Identify first, in the same transaction — the visit row is what the
        // destination label is built from, so it has to be true before the
        // snapshot is taken.
        const visit = await setVisitDetails(tx, {
          tenantId: session.tenantId,
          propertyId: session.propertyId,
          visitId: session.visitId,
          name: parsed.data.name,
          phone: parsed.data.phone,
          fulfilment: parsed.data.fulfilment,
          deliveryAddress: parsed.data.address,
          deliveryNotes: parsed.data.addressNotes,
          guestSessionId: session.id,
        });

        return placeOrder(tx, {
          tenantId: session.tenantId,
          propertyId: session.propertyId,
          context: contextForSession(session),
          // The outlet the LINK points at, not the in-room one. A restaurant
          // using this product may have no in-room dining outlet at all.
          outletId: session.outletId,
          fulfilment: visit.fulfilment,
          // Built from the visit as `setVisitDetails` just left it, so the
          // ticket says "Table 4" or "Delivery · 12 MG Road" rather than being
          // assembled from whatever the form posted.
          destinationLabel: destinationLabelFor(visit),
          idempotencyKey: parsed.data.idempotencyKey,
          guestSessionId: session.id,
          accessTier: session.accessTier,
        });
      },
    );

    logger.info(
      { orderNumber: placed.orderNumber, replay: placed.wasAlreadyPlaced },
      'visit order placed',
    );
    revalidatePath(`/p/${parsed.data.code}/menu`);
    orderId = placed.orderId;
  } catch (error) {
    return handle(error);
  }

  // Outside the try: `redirect()` works by throwing, and catching it here would
  // turn a successful order into an error message.
  redirect(`/p/${parsed.data.code}/order/${orderId}`);
}

function handle(error: unknown): CartEditState {
  if (error instanceof AppError) {
    logger.info({ code: error.code, ...error.context }, 'visit cart refused');
    const message = publicPayloadFor(error).message;
    // Put the message under the field it is about, where there is one.
    const field = /address/i.test(message) ? 'address' as const
      : /phone|number/i.test(message) ? 'phone' as const
      : /name/i.test(message) ? 'name' as const
      : undefined;
    return { error: message, field };
  }
  logger.error({ err: error }, 'visit cart failed');
  return { error: 'That did not go through. Try again.' };
}
