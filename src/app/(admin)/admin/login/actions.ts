'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  login, LOGIN_FAILED_MESSAGE, SESSION_COOKIE_OPTIONS, STAFF_SESSION_COOKIE,
} from '@/modules/identity';
import { AppError, UnauthenticatedError, publicPayloadFor, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { staffTenantId } from './tenant';

/**
 * Staff sign-in.
 *
 * Which tenant a signed-out browser belongs to is an open question in the
 * tenancy model, and `./tenant.ts` holds the one stopgap answer both signed-out
 * pages share. Until it is settled, this refuses to guess rather than silently
 * signing someone in to the wrong hotel.
 */
const Credentials = z.object({
  email: z.email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export interface LoginState {
  error?: string;
}

function requireTenantId(): string {
  const tenantId = staffTenantId();
  if (!tenantId) {
    throw new ValidationError(
      'This deployment has no staff tenant configured. Set STAFF_TENANT_ID.',
    );
  }
  return tenantId;
}

/** Only ever an internal path. An open redirect on a login form is a gift. */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/admin';
  return next;
}

export async function signIn(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = Credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || undefined,
  });
  if (!parsed.success) return { error: 'Enter your email and password.' };

  let destination: string;
  try {
    const headerList = await headers();
    const tenantId = requireTenantId();
    const issued = await login(
      {
        // `login()` parses a tenantSlug and does not read it — S5 left the same
        // question open. Whichever resolution wins above is what will make this
        // field mean something; until then it carries the configured id so the
        // schema is satisfied honestly rather than with a placeholder.
        tenantSlug: tenantId,
        email: parsed.data.email.trim().toLowerCase(),
        password: parsed.data.password,
      },
      {
        tenantId,
        ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim(),
        userAgent: headerList.get('user-agent') ?? undefined,
      },
    );

    const store = await cookies();
    store.set(STAFF_SESSION_COOKIE, issued.cookieValue, {
      ...SESSION_COOKIE_OPTIONS,
      expires: issued.expiresAt,
    });

    destination = safeNext(parsed.data.next);
  } catch (error) {
    if (error instanceof AppError) {
      // Every failure says the same thing and takes about the same time — a
      // distinct "no such user" enumerates a hotel's staff list, and staff
      // emails are usually firstname@thehotel.com.
      //
      // LOGIN_FAILED_MESSAGE rather than the error's own public message:
      // UnauthenticatedError says "Sign in to continue", which is right for a
      // missing session and confusing to someone who just tried to. The
      // constant is exported for this and had no caller until now.
      logger.info({ code: error.code }, 'staff sign-in refused');
      return {
        error: error instanceof UnauthenticatedError
          ? LOGIN_FAILED_MESSAGE
          : publicPayloadFor(error).message,
      };
    }
    logger.error({ err: (error as Error).message }, 'staff sign-in failed');
    throw error;
  }

  redirect(destination);
}
