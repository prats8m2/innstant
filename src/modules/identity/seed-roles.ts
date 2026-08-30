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
  const ids = new Map<SystemRoleKey, string>();

  for (const key of SYSTEM_ROLE_KEYS) {
    const definition = SYSTEM_ROLES[key];

    const existing = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(
        eq(roles.tenantId, tenantId),
        eq(roles.key, key),
        eq(roles.isSystem, true),
      ))
      .limit(1);

    let roleId = existing[0]?.id;
    if (!roleId) {
      const inserted = await tx.insert(roles).values({
        tenantId,
        propertyId: null, // system roles are tenant-wide
        key,
        name: definition.name,
        isSystem: true,
      }).returning({ id: roles.id });
      roleId = inserted[0]!.id;
    } else {
      await tx.update(roles).set({ name: definition.name }).where(eq(roles.id, roleId));
    }
    ids.set(key, roleId);

    const current = await tx
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));

    const have = new Set(current.map((r) => r.permission));
    const want = new Set<string>(definition.permissions);

    const toAdd = [...want].filter((p) => !have.has(p));
    if (toAdd.length) {
      await tx.insert(rolePermissions).values(
        toAdd.map((permission) => ({ tenantId, roleId, permission })),
      );
    }

    const toRemove = [...have].filter((p) => !want.has(p));
    if (toRemove.length) {
      await tx.delete(rolePermissions).where(and(
        eq(rolePermissions.roleId, roleId),
        inArray(rolePermissions.permission, toRemove),
      ));
    }
  }

  return ids;
}
