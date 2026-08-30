import { cookies } from 'next/headers';
import { resolveStaffSession, STAFF_SESSION_COOKIE, authorize, requireSession } from '@/modules/identity';
import type { Permission, StaffSession } from '@/modules/identity';

/**
 * The real authorization entry point for server components, server actions and
 * route handlers. The middleware is only a turnstile — see src/middleware.ts.
 *
 * Every mutation on a staff surface should begin with `requirePermission(...)`.
 * Nothing checks a permission inline (CLAUDE.md "Conventions"), and nothing
 * trusts the middleware to have done it.
 */
export async function getStaffSession(): Promise<StaffSession | null> {
  const store = await cookies();
  return resolveStaffSession(store.get(STAFF_SESSION_COOKIE)?.value);
}

/** Signed in, at all. Throws UnauthenticatedError (401). */
export async function requireStaffSession(): Promise<StaffSession> {
  return requireSession(await getStaffSession());
}

/**
 * Signed in AND permitted at this property.
 *
 * Throws 401 with no session, 403 for a missing permission at a property the
 * user can see, and 404 at a property they cannot — never 403 for the latter,
 * because that would confirm the property exists.
 */
export async function requirePermission(
  propertyId: string,
  permission: Permission,
): Promise<StaffSession> {
  const session = await getStaffSession();
  authorize(session, propertyId, permission);
  return session;
}
