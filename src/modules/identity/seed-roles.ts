import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/db';
import { roles, rolePermissions } from '@/db/schema/identity';
import { SYSTEM_ROLES, SYSTEM_ROLE_KEYS, type SystemRoleKey } from './permissions';

/**
 * Seed the 8 system roles for a tenant. Called by provisionProperty() (S6) and
 * by the test fixtures.
 *
 * Idempotent and CONVERGENT: re-running it brings an existing tenant's system
 * roles back in line with the definitions in permissions.ts, adding and
 * removing grants as needed. That matters because permissions.ts will grow —
 * a new permission added in P2 must reach properties provisioned in P1, and
 * "seed once at creation" would silently leave older tenants behind.
 *
 * Only `is_system = true` roles are touched. A custom role someone built is
 * never rewritten.
 */
export async function seedSystemRoles(tx: Tx, tenantId: string): Promise<Map<SystemRoleKey, string>> {
  // Two reads up front rather than four per role — provisioning runs over the
  // network and 8 roles at 4 round trips each is most of a second of latency
  // for nothing.
  const existingRoles = await tx
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.isSystem, true)));
  const roleIdByKey = new Map(existingRoles.map((r) => [r.key, r.id]));

  const toCreate = SYSTEM_ROLE_KEYS.filter((k) => !roleIdByKey.has(k));
  if (toCreate.length) {
    const created = await tx.insert(roles).values(toCreate.map((key) => ({
      tenantId,
      propertyId: null, // system roles are tenant-wide
      key,
      name: SYSTEM_ROLES[key].name,
      isSystem: true,
    }))).returning({ id: roles.id, key: roles.key });
    for (const r of created) roleIdByKey.set(r.key, r.id);
  }

  const ids = new Map<SystemRoleKey, string>();
  for (const key of SYSTEM_ROLE_KEYS) ids.set(key, roleIdByKey.get(key)!);

  const allGrants = await tx
    .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.tenantId, tenantId));
  const haveByRole = new Map<string, Set<string>>();
  for (const g of allGrants) {
    let set = haveByRole.get(g.roleId);
    if (!set) { set = new Set(); haveByRole.set(g.roleId, set); }
    set.add(g.permission);
  }

  const additions: { tenantId: string; roleId: string; permission: string }[] = [];
  for (const key of SYSTEM_ROLE_KEYS) {
    const roleId = ids.get(key)!;
    const have = haveByRole.get(roleId) ?? new Set<string>();
    const want = new Set<string>(SYSTEM_ROLES[key].permissions);

    for (const p of want) if (!have.has(p)) additions.push({ tenantId, roleId, permission: p });

    const toRemove = [...have].filter((p) => !want.has(p));
    if (toRemove.length) {
      await tx.delete(rolePermissions).where(and(
        eq(rolePermissions.roleId, roleId),
        inArray(rolePermissions.permission, toRemove),
      ));
    }
  }
  if (additions.length) await tx.insert(rolePermissions).values(additions);

  return ids;
}
