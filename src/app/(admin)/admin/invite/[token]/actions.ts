'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withTenant } from '@/db';
import {
  acceptInvite, createStaffSession, SESSION_COOKIE_OPTIONS, STAFF_SESSION_COOKIE,
} from '@/modules/identity';
import { AppError, publicPayloadFor, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { staffTenantId } from '../../login/tenant';

export interface AcceptState {
  error?: string;
}

const Accept = z.object({
  token: z.string().min(1).max(128),
  password: z.string().min(12, 'At least 12 characters.').max(1024),
  confirm: z.string().min(1),
});

/**
 * Set the password and sign them straight in.
 *
 * The session is created in the SAME transaction that accepts the invite. The
 * alternative — accept, then redirect to the login form — means somebody who has
 * just typed a password twice types it a third time, and an accept that succeeds
 * followed by a sign-in that fails for any reason leaves them holding a link
 * that no longer works.
 */
export async function acceptInviteAction(
  _previous: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const parsed = Accept.safeParse({
    token: formData.get('token') ?? '',
    password: formData.get('password') ?? '',
    confirm: formData.get('confirm') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the password.' };
  }
  if (parsed.data.password !== parsed.data.confirm) {
    return { error: 'Those two do not match.' };
  }

  const tenantId = staffTenantId();

  let cookieValue: string;
  let expiresAt: Date;

  try {
    if (!tenantId) {
      throw new ValidationError(
        'This deployment has no staff tenant configured. Set STAFF_TENANT_ID.',
      );
    }

    const store = await headers();
    const issued = await withTenant({ tenantId }, async (tx) => {
      const accepted = await acceptInvite(tx, {
        tenantId,
        token: parsed.data.token,
        password: parsed.data.password,
      });

      return createStaffSession(tx, {
        tenantId,
        staffUserId: accepted.staffUserId,
        ipAddress: store.get('x-forwarded-for')?.split(',')[0]?.trim(),
        userAgent: store.get('user-agent') ?? undefined,
      });
    });

    cookieValue = issued.cookieValue;
    expiresAt = issued.expiresAt;
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code }, 'invite acceptance refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message }, 'invite acceptance failed');
    return { error: 'Something went wrong setting that password. Try the link again.' };
  }

  const jar = await cookies();
  jar.set(STAFF_SESSION_COOKIE, cookieValue, { ...SESSION_COOKIE_OPTIONS, expires: expiresAt });

  // Outside the try: redirect() throws by design, and catching it here would
  // turn a successful acceptance into an error message.
  redirect('/admin');
}
