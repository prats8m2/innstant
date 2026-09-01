import { sql } from 'drizzle-orm';
import type { Tx } from '@/db';

/**
 * Which roles exist here, and how many people actually hold each one.
 *
 * `roles` and `staff_property_roles` belong to identity (D-001), so a screen
 * that needs to offer "route this to…" asks here rather than reaching across.
 *
 * ─── Why the count comes with the list ─────────────────────────────────────
 *
 * `request_types.route_to_role_key` is matched against the roles a staff member
 * holds at the property (routing.ts). Point it at a role nobody holds and every
 * request of that type sits OPEN for ever with a `NOBODY_WITH_ROLE` event
 * nobody reads — the routing was working perfectly and the rota had a hole.
 *
 * A list of role names alone lets a manager pick that silently. A list that says
 * "Concierge — nobody" does not.
 */
export interface PropertyRole {
  key: string;
  name: string;
  /** Staff holding this role AT THIS PROPERTY, disabled accounts excluded. */
  staffCount: number;
}

export async function listRolesAtProperty(
  tx: Tx,
  input: { propertyId: string },
): Promise<PropertyRole[]> {
  /**
   * Raw SQL for the LEFT JOIN and the count — the same narrow, read-only
   * projection the kitchen ticket and the escalation lookup already take. RLS
   * still applies to every row.
   *
   * Tenant-wide roles (`property_id IS NULL`) and this property's own custom
   * roles both, which is exactly what `roles_tenant_property_key_uq` allows.
   */
  const rows = await tx.execute<{ key: string; name: string; staff_count: number }>(sql`
    SELECT r.key, r.name, COUNT(DISTINCT su.id)::int AS staff_count
    FROM roles r
    LEFT JOIN staff_property_roles spr
      ON spr.role_id = r.id
     AND spr.property_id = ${input.propertyId}
    LEFT JOIN staff_users su
      ON su.id = spr.staff_user_id
     -- Anyone not disabled, rather than status = ACTIVE: an INVITED admin who
     -- has not logged in yet still holds the role, and counting them out is how
     -- the escalation lookup once decided a new property had no duty manager.
     AND su.status <> 'DISABLED'
    WHERE r.property_id IS NULL OR r.property_id = ${input.propertyId}
    GROUP BY r.key, r.name
    ORDER BY r.name
  `);

  return rows.rows.map((row) => ({
    key: row.key,
    name: row.name,
    staffCount: Number(row.staff_count),
  }));
}
