import { ForbiddenError, NotFoundError, UnauthenticatedError } from '@/lib/errors';
import type { Permission } from './permissions';

/**
 * The ONE place a permission is checked. CLAUDE.md: never inline a permission
 * check in a route handler.
 *
 * A single choke point is not tidiness. It is the only way the 403/404
 * distinction below stays consistent, and an inconsistent one leaks tenancy.
 */

export interface StaffSession {
  staffUserId: string;
  tenantId: string;
  email: string;
  fullName: string;
  /** Every property this user holds a role at, with the permissions granted
   *  there. A group GM legitimately has several; most staff have one. */
  properties: ReadonlyMap<string, ReadonlySet<Permission>>;
  expiresAt: Date;
}

/**
 * Throws on failure, never returns a boolean — a caller cannot forget to check
 * a thrown error the way it can forget to check `if (!allowed)`.
 *
 * ─── Why the failure modes differ ──────────────────────────────────────────
 *
 * At a property the user CAN see, a missing permission is 403: they exist,
 * they are simply not allowed.
 *
 * At a property they hold no role at, it is 404 — NOT 403. A 403 would confirm
 * the property exists, and that single bit is enough to enumerate a
 * competitor's estate one uuid at a time. From outside, a real property and a
 * typo must be indistinguishable.
 *
 * RLS is still the backstop: even if this were bypassed, the policies return
 * zero rows. This exists so the mistake is a clean 404 instead of an empty
 * page that looks like a bug.
 */
export function authorize(
  session: StaffSession | null,
  propertyId: string,
  permission: Permission,
): asserts session is StaffSession {
  if (!session) throw new UnauthenticatedError('no staff session');

  if (session.expiresAt.getTime() <= Date.now()) {
    throw new UnauthenticatedError('session expired', { staffUserId: session.staffUserId });
  }

  const granted = session.properties.get(propertyId);
  if (!granted) {
    // Deliberately 404. See the note above.
    throw new NotFoundError('property not visible to this session', {
      staffUserId: session.staffUserId,
      propertyId,
    });
  }

  if (!granted.has(permission)) {
    throw new ForbiddenError(`missing ${permission}`, {
      staffUserId: session.staffUserId,
      propertyId,
      permission,
    });
  }
}

/**
 * Non-throwing form, for rendering decisions only — hiding a button the user
 * cannot use. Never use it to guard a mutation: the guard must be the thing
 * that throws, so that forgetting it is a crash and not a silent grant.
 */
export function can(
  session: StaffSession | null,
  propertyId: string,
  permission: Permission,
): boolean {
  try {
    authorize(session, propertyId, permission);
    return true;
  } catch {
    return false;
  }
}

/** Properties this session may see at all. Used to scope a property picker. */
export function visibleProperties(session: StaffSession | null): readonly string[] {
  return session ? [...session.properties.keys()] : [];
}

/**
 * Guards a whole surface before any property is chosen — the /admin, /kds and
 * /runner entry points.
 */
export function requireSession(session: StaffSession | null): StaffSession {
  if (!session) throw new UnauthenticatedError('no staff session');
  if (session.expiresAt.getTime() <= Date.now()) throw new UnauthenticatedError('session expired');
  return session;
}
