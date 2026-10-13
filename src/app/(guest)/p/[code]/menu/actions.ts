'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { resolveVisitSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { getMenu } from '@/modules/catalog';
import { findProperty } from '@/modules/identity';
import { quickAddDish, quickRemoveDish, contextForSession } from '@/modules/ordering';
import { localTimeAt } from '@/lib/clock';
import { AppError, UnauthenticatedError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The plus and minus on a menu card, for a property link. D-079.
 *
 * The visit-side twin of `/r/[qrCode]/menu/actions.ts`, and deliberately a
 * separate file rather than one action that branches. Read the note in that
 * file about why the menu list and the dish page do not share an action: the
 * same reasoning applies one level up. These two paths resolve a different
 * session, scope to a different context and revalidate a different URL, and
 * the only thing they would share is the shape of the form.
 *
 * What is NOT different, and must not become so: nothing about the dish is
 * trusted from the form. Not the price, not the availability, not the modifier
 * selection — all resolved from the database inside `quickAddDish()`. The form
 * carries an id and a direction, which is all it is allowed to carry.
 */
const Adjust = z.object({
  code: z.string().min(1).max(64),
  menuItemId: z.uuid(),
  direction: z.enum(['add', 'remove']),
});

export interface QuickAdjustState {
  error?: string;
}

export async function adjustDishInOrder(
  _previous: QuickAdjustState,
  formData: FormData,
): Promise<QuickAdjustState> {
  const parsed = Adjust.safeParse({
    code: formData.get('code'),
    menuItemId: formData.get('menuItemId'),
    direction: formData.get('direction'),
  });

  if (!parsed.success) return { error: 'That did not come through. Try again.' };

  const store = await cookies();

  try {
    const session = await resolveVisitSession(store.get(GUEST_SESSION_COOKIE)?.value);
    // Changing an order is not browsing, and #9 covers browsing only.
    if (!session) throw new UnauthenticatedError('no visit session');

    await withTenant(
      { tenantId: session.tenantId, propertyId: session.propertyId },
      async (tx) => {
        /**
         * The outlet comes from the SESSION, never from the form.
         *
         * It was fixed when somebody created the link, and the session carries
         * it. Letting a form name it would let a stale page put a rooftop
         * dish into a cafe's cart — the same rule as the room flow, where the
         * outlet is read rather than posted.
         */
        const property = await findProperty(tx, session.propertyId);
        const at = localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata');
        const menu = await getMenu(tx, {
          propertyId: session.propertyId,
          outletId: session.outletId,
          at,
        });
        if (!menu) throw new UnauthenticatedError('no outlet behind this link');

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

    revalidatePath(`/p/${parsed.data.code}/menu`);
    revalidatePath(`/p/${parsed.data.code}/cart`);
    return {};
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code, ...error.context }, 'quick adjust refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: error }, 'quick adjust failed');
    return { error: 'That did not go through. Try again.' };
  }
}
