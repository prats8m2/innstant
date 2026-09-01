'use server';

import { z } from 'zod';
import { withTenant } from '@/db';
import { requireStaffSession } from '@/lib/auth-context';
import { acknowledgeAll } from '@/modules/notifications';
import { logger } from '@/lib/logger';

/**
 * "I have seen these."
 *
 * ─── Why there is no permission check ──────────────────────────────────────
 *
 * There is no `notification:read`, and adding one would be answering the wrong
 * question. An alert is addressed to a person, so the only thing that matters
 * is that this is YOUR alert — and the staff id comes from the session cookie,
 * never from the form. A caller cannot acknowledge somebody else's bell because
 * there is no parameter through which to try.
 *
 * The property still has to be one this account can see, so a stale tab from a
 * revoked posting cannot write.
 *
 * ─── Why it does not revalidate a path ─────────────────────────────────────
 *
 * The bell is mounted on the ops console (every page of it) and on the floor
 * board, so there is no single path to name and an allow-list here would go
 * stale the first time a screen is added. The client calls `router.refresh()`
 * when this resolves, which refreshes whatever route it is actually on.
 */
const Input = z.object({ propertyId: z.uuid() });

export async function markAlertsSeen(propertyId: string): Promise<{ error?: string }> {
  const parsed = Input.safeParse({ propertyId });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };

  const session = await requireStaffSession();
  if (!session.properties.has(parsed.data.propertyId)) {
    return { error: 'This account cannot see that property.' };
  }

  await withTenant(
    { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
    (tx) => acknowledgeAll(tx, {
      propertyId: parsed.data.propertyId,
      staffUserId: session.staffUserId,
    }),
  );

  logger.info(
    { staffUserId: session.staffUserId, propertyId: parsed.data.propertyId },
    'alerts acknowledged',
  );
  return {};
}
