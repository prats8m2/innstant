'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { addToCart } from '@/modules/ordering';
import { AppError, UnauthenticatedError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Adding a dish to the order.
 *
 * A Server Action, because it originates in our own UI (CLAUDE.md
 * "Conventions"). Zod parses the form at the edge; everything inward is typed.
 *
 * Note what is NOT trusted here: the price, the dish's availability, and the
 * modifier selection. All three come back out of the database inside
 * `addToCart()`. A form is a suggestion.
 */
const AddToOrder = z.object({
  qrCode: z.string().min(1).max(64),
  menuItemId: z.uuid(),
  quantity: z.coerce.number().int().min(1).max(20),
  notes: z.string().max(280).optional(),
  // One field repeated per chosen option — `formData.getAll` shape.
  modifierOptionIds: z.array(z.uuid()).default([]),
});

export interface AddToOrderState {
  /** Shown to the guest. Says what happened and what to do (CLAUDE.md). */
  error?: string;
  addedAt?: number;
}

export async function addToOrder(
  _previous: AddToOrderState,
  formData: FormData,
): Promise<AddToOrderState> {
  const parsed = AddToOrder.safeParse({
    qrCode: formData.get('qrCode'),
    menuItemId: formData.get('menuItemId'),
    quantity: formData.get('quantity'),
    notes: formData.get('notes') || undefined,
    modifierOptionIds: formData.getAll('modifierOptionIds'),
  });

  if (!parsed.success) {
    return { error: 'Something in that order did not come through. Try again.' };
  }

  const store = await cookies();

  try {
    const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);
    // Adding to a cart is not browsing (#9 covers browsing, and only browsing).
    // No session means checked out, expired or revoked — not a tier problem.
    if (!session) throw new UnauthenticatedError('no guest session');

    await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      (tx) => addToCart(tx, {
        tenantId: session.tenantId,
        propertyId: session.propertyId,
        stayId: session.stayId,
        menuItemId: parsed.data.menuItemId,
        quantity: parsed.data.quantity,
        notes: parsed.data.notes,
        modifierOptionIds: parsed.data.modifierOptionIds,
      }),
    );

    // The cart pill on the menu has to be right the moment they land back on it.
    revalidatePath(`/r/${parsed.data.qrCode}/menu`);
    /**
     * And this screen, so the review row's count and total move the moment the
     * dish is added. The route pattern rather than a built path: `itemId` is
     * not in this action's input, and `'page'` is the same form the checkout
     * action already uses for `/r/[qrCode]/stay`.
     */
    revalidatePath('/r/[qrCode]/menu/[itemId]', 'page');
    return { addedAt: Date.now() };
  } catch (error) {
    if (error instanceof AppError) {
      // A typed error is a thing the guest can act on — the dish sold out, the
      // kitchen closed. Say it plainly rather than failing the whole screen.
      logger.info({ code: error.code, ...error.context }, 'add to order refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, 'add to order failed');
    throw error;
  }
}
