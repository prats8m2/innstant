'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getInRoomDiningMenu } from '@/modules/catalog';
import { findProperty } from '@/modules/identity';
import { quickAddDish, quickRemoveDish, contextForSession } from '@/modules/ordering';
import { localTimeAt } from '@/lib/clock';
import { AppError, UnauthenticatedError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The plus and minus on a menu card.
 *
 * A Server Action, because it originates in our own UI. Nothing about the
 * dish is trusted from the form — not the price, not the availability, and
 * not the modifier selection, which is resolved from the database inside
 * `quickAddDish()`. The form carries an id and a direction; that is all it is
 * allowed to carry.
 *
 * ─── Why this is not the dish page's action ────────────────────────────────
 *
 * `menu/[itemId]/actions.ts` takes a quantity, a note and a list of chosen
 * options, because a guest standing on the dish page has made those choices.
 * Here they have made none: the whole point of the control is that they did
 * not open it. Sharing one action would mean the menu list posting a
 * selection it invented, which is exactly the thing the note above says it
 * must not do.
 */
const Adjust = z.object({
  qrCode: z.string().min(1).max(64),
  menuItemId: z.uuid(),
  direction: z.enum(['add', 'remove']),
});

export interface QuickAdjustState {
  /** Shown on the card. Says what happened and what to do (CLAUDE.md). */
  error?: string;
}

export async function adjustDishInOrder(
  _previous: QuickAdjustState,
  formData: FormData,
): Promise<QuickAdjustState> {
  const parsed = Adjust.safeParse({
    qrCode: formData.get('qrCode'),
    menuItemId: formData.get('menuItemId'),
    direction: formData.get('direction'),
  });

  if (!parsed.success) return { error: 'That did not come through. Try again.' };

  const store = await cookies();

  try {
    const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);
    // Changing an order is not browsing, and #9 covers browsing only.
    if (!session) throw new UnauthenticatedError('no guest session');

    await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      async (tx) => {
        /**
         * The outlet is read, never posted. A cart belongs to one outlet, and
         * letting a form name it would let a stale page put a rooftop dish in
         * a room-service cart.
         */
        const property = await findProperty(tx, session.propertyId);
        const at = localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata');
        const menu = await getInRoomDiningMenu(tx, session.propertyId, at);
        if (!menu) throw new UnauthenticatedError('no in-room dining outlet');

        const input = {
          tenantId: session.tenantId,
          propertyId: session.propertyId,
          context: contextForSession(session),
          outletId: menu.outlet.id,
          menuItemId: parsed.data.menuItemId,
        };

        if (parsed.data.direction === 'add') await quickAddDish(tx, input);
        else await quickRemoveDish(tx, input);
      },
    );
  } catch (error) {
    if (error instanceof AppError) return { error: publicPayloadFor(error).message };
    logger.error({ err: String(error) }, 'quick adjust failed');
    return { error: 'That did not go through. Try again in a moment.' };
  }

  // The menu re-renders with the new counts, and the cart pill with the new
  // total — both live on this page, so one revalidate covers them.
  revalidatePath(`/r/${parsed.data.qrCode}/menu`, 'page');
  return {};
}
