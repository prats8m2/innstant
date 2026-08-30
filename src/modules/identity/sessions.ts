import { and, eq, gt, isNull } from 'drizzle-orm';
import { withTenant, type Tx } from '@/db';
import {
  staffSessions, staffUsers, staffPropertyRoles, roles, rolePermissions,
} from '@/db/schema/identity';
import { issueToken, hashToken } from './tokens';
import { isPermission, type Permission } from './permissions';
import type { StaffSession } from './authorize';
// Edge-safe constants live apart so middleware can import them without
// dragging node:crypto into the edge bundle. See cookie.ts.
import { SESSION_TTL_HOURS } from './cookie';

/**
 * Staff sessions. CLAUDE.md #10 applies here as much as to guests: the token is
 * stored as SHA-256 only, and the database row IS the session so it can be
 * revoked immediately.
 *
 * ─── The cookie format, and why it carries the tenant ──────────────────────
 *
 * `<tenantId>.<token>`
 *
 * There is a chicken-and-egg problem: every query must go through
 * `withTenant()` (#1), but resolving a session token is HOW we learn which
 * tenant the request belongs to. The alternatives were:
 *
 *   a) look the token up with no tenant scope — which would mean an unscoped
 *      query on the hot path of every authenticated request, exactly the thing
 *      #1 exists to prevent;
 *   b) carry the tenant id in the cookie alongside the token.
 *
 * (b), because the tenant id is routing information, not a secret, and it is
 * not trusted: it only selects which tenant's rows we search. A forged or
 * swapped tenant id finds no matching token hash — RLS confines the lookup to
 * that tenant, and the hash exists in exactly one. So tampering downgrades to
 * "session not found", which is the correct answer.
 */
const COOKIE_SEPARATOR = '.';


export interface IssuedSession {
  /** Cookie value: `<tenantId>.<token>`. */
  cookieValue: string;
  expiresAt: Date;
}

export async function createStaffSession(
  tx: Tx,
  params: { tenantId: string; staffUserId: string; ipAddress?: string; userAgent?: string },
): Promise<IssuedSession> {
  const { token, tokenHash } = issueToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000);

  await tx.insert(staffSessions).values({
    tenantId: params.tenantId,
    staffUserId: params.staffUserId,
    tokenHash,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    expiresAt,
  });

  return { cookieValue: `${params.tenantId}${COOKIE_SEPARATOR}${token}`, expiresAt };
}

function parseCookie(value: string): { tenantId: string; tokenHash: string } | null {
  const at = value.indexOf(COOKIE_SEPARATOR);
  if (at <= 0) return null;
  const tenantId = value.slice(0, at);
  const token = value.slice(at + 1);
  if (!token) return null;
  return { tenantId, tokenHash: hashToken(token) };
}

/**
 * Resolve a cookie to a session, or null. Never throws for a bad cookie — an
 * unparseable or expired cookie is simply "not signed in", not an error the
 * caller has to distinguish.
 *
 * Loads every property the user holds a role at, with the union of permissions
 * granted there. A person may hold two roles at one property; the union is the
 * intended behaviour.
 */
export async function resolveStaffSession(cookieValue: string | undefined): Promise<StaffSession | null> {
  if (!cookieValue) return null;
  const parsed = parseCookie(cookieValue);
  if (!parsed) return null;

  // A malformed tenant id would throw inside withTenant; treat it as no session.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.tenantId)) {
    return null;
  }

  return withTenant({ tenantId: parsed.tenantId }, async (tx) => {
    const rows = await tx
      .select({
        staffUserId: staffUsers.id,
        email: staffUsers.email,
        fullName: staffUsers.fullName,
        status: staffUsers.status,
        expiresAt: staffSessions.expiresAt,
      })
      .from(staffSessions)
      .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.staffUserId))
      .where(and(
        eq(staffSessions.tokenHash, parsed.tokenHash),
        isNull(staffSessions.revokedAt),
        gt(staffSessions.expiresAt, new Date()),
      ))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    // A deactivated user's existing sessions must stop working immediately.
    if (row.status !== 'ACTIVE') return null;

    const grants = await tx
      .select({
        propertyId: staffPropertyRoles.propertyId,
        permission: rolePermissions.permission,
      })
      .from(staffPropertyRoles)
      .innerJoin(roles, eq(roles.id, staffPropertyRoles.roleId))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(staffPropertyRoles.staffUserId, row.staffUserId));

    const properties = new Map<string, Set<Permission>>();
    for (const g of grants) {
      if (!isPermission(g.permission)) continue; // a permission we retired
      let set = properties.get(g.propertyId);
      if (!set) { set = new Set(); properties.set(g.propertyId, set); }
      set.add(g.permission);
    }

    // Deliberately no write on the read path. `staff_sessions` has no
    // last_seen column; adding one would put an UPDATE on every authenticated
    // request for a feature nothing needs yet.

    return {
      staffUserId: row.staffUserId,
      tenantId: parsed.tenantId,
      email: row.email,
      fullName: row.fullName,
      properties,
      expiresAt: row.expiresAt,
    } satisfies StaffSession;
  });
}

export async function revokeStaffSession(cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  const parsed = parseCookie(cookieValue);
  if (!parsed) return;
  await withTenant({ tenantId: parsed.tenantId }, (tx) =>
    tx.update(staffSessions)
      .set({ revokedAt: new Date() })
      .where(eq(staffSessions.tokenHash, parsed.tokenHash)));
}

/** Every session for a user — used on deactivate and password change. */
export async function revokeAllSessionsFor(
  tx: Tx, staffUserId: string,
): Promise<void> {
  await tx.update(staffSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(staffSessions.staffUserId, staffUserId), isNull(staffSessions.revokedAt)));
}
