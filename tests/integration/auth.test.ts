import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { eq } from 'drizzle-orm';
import { withTenant, closePool } from '@/db';
import { staffUsers, staffPropertyRoles, roles } from '@/db/schema/identity';
import {
  login, resolveStaffSession, revokeStaffSession, setStaffPassword,
  seedSystemRoles, authorize, SYSTEM_ROLES, SYSTEM_ROLE_KEYS,
} from '@/modules/identity';
import { ForbiddenError, NotFoundError, UnauthenticatedError, httpStatusFor } from '@/lib/errors';
import { ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * S5's done condition, end to end against a real database:
 *   "a FRONT_DESK user at property A gets a 403 on an admin-only action at
 *    property A, and a 404 on anything at property B."
 */
let owner: pg.Client;
let a: Fixture;
let b: Fixture;

const PASSWORD = 'a-long-enough-password-1';

async function makeStaff(
  tenantId: string, email: string, roleKey: keyof typeof SYSTEM_ROLES, propertyIds: string[],
): Promise<string> {
  return withTenant({ tenantId }, async (tx) => {
    const roleIds = await seedSystemRoles(tx, tenantId);
    const [user] = await tx.insert(staffUsers).values({
      tenantId, email, fullName: email, status: 'ACTIVE',
    }).returning({ id: staffUsers.id });
    await setStaffPassword(tx, user!.id, PASSWORD);
    for (const propertyId of propertyIds) {
      await tx.insert(staffPropertyRoles).values({
        tenantId, staffUserId: user!.id, propertyId, roleId: roleIds.get(roleKey)!,
      });
    }
    return user!.id;
  });
}

beforeAll(async () => {
  owner = ownerClient();
  await owner.connect();
  await owner.query(`DELETE FROM staff_sessions WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  await owner.query(`DELETE FROM staff_property_roles WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  await owner.query(`DELETE FROM role_permissions WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  await owner.query(`DELETE FROM roles WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  await owner.query(`DELETE FROM staff_users WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  await cleanup(owner);
  a = await seedTenant(owner, TENANT_A, 'A');
  b = await seedTenant(owner, TENANT_B, 'B');
}, 120_000);

afterAll(async () => {
  for (const t of ['staff_sessions', 'staff_property_roles', 'role_permissions', 'roles', 'staff_users']) {
    await owner.query(`DELETE FROM ${t} WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  }
  await cleanup(owner);
  await owner.end();
  await closePool();
});

describe('S5 · seeding the 8 system roles', () => {
  it('creates exactly 8 system roles, tenant-wide', async () => {
    await withTenant({ tenantId: TENANT_A }, (tx) => seedSystemRoles(tx, TENANT_A));
    const r = await owner.query(
      `SELECT key FROM roles WHERE tenant_id=$1 AND is_system`, [TENANT_A]);
    expect(r.rowCount).toBe(8);
    // Sorted in JS, not SQL: Postgres collation orders F_AND_B_MANAGER before
    // FRONT_DESK, and the test should not depend on the database's collation.
    expect(r.rows.map((x) => x.key).sort()).toEqual([...SYSTEM_ROLE_KEYS].sort());
  });

  it('is idempotent — re-running does not duplicate roles or grants', async () => {
    const before = await owner.query(
      `SELECT count(*)::int n FROM role_permissions WHERE tenant_id=$1`, [TENANT_A]);
    await withTenant({ tenantId: TENANT_A }, (tx) => seedSystemRoles(tx, TENANT_A));
    await withTenant({ tenantId: TENANT_A }, (tx) => seedSystemRoles(tx, TENANT_A));
    const after = await owner.query(
      `SELECT count(*)::int n FROM role_permissions WHERE tenant_id=$1`, [TENANT_A]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('converges — a grant added by hand is removed on reseed', async () => {
    // permissions.ts will grow. A tenant provisioned in P1 must pick up a
    // permission added in P2, and must not keep one that was retired.
    const role = await owner.query(
      `SELECT id FROM roles WHERE tenant_id=$1 AND key='KITCHEN'`, [TENANT_A]);
    await owner.query(
      `INSERT INTO role_permissions (tenant_id, role_id, permission) VALUES ($1,$2,'payment:refund')`,
      [TENANT_A, role.rows[0].id]);

    await withTenant({ tenantId: TENANT_A }, (tx) => seedSystemRoles(tx, TENANT_A));

    const still = await owner.query(
      `SELECT 1 FROM role_permissions WHERE role_id=$1 AND permission='payment:refund'`,
      [role.rows[0].id]);
    expect(still.rowCount).toBe(0);
  });
});

describe('S5 · login', () => {
  it('issues a session for correct credentials', async () => {
    await makeStaff(TENANT_A, 'desk@a.example', 'FRONT_DESK', [a.propertyId]);
    const session = await login(
      { tenantSlug: 't-a', email: 'desk@a.example', password: PASSWORD },
      { tenantId: TENANT_A });
    expect(session.cookieValue).toContain('.');
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('stores the token as a hash, never in the clear', async () => {
    const session = await login(
      { tenantSlug: 't-a', email: 'desk@a.example', password: PASSWORD },
      { tenantId: TENANT_A });
    const rawToken = session.cookieValue.split('.').slice(1).join('.');
    const rows = await owner.query(
      `SELECT token_hash FROM staff_sessions WHERE tenant_id=$1`, [TENANT_A]);
    for (const row of rows.rows) {
      expect(row.token_hash).not.toBe(rawToken);
      expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('rejects a wrong password with the same message as a missing account', async () => {
    const wrong = login({ tenantSlug: 't-a', email: 'desk@a.example', password: 'wrong-password-1' },
      { tenantId: TENANT_A });
    const missing = login({ tenantSlug: 't-a', email: 'nobody@a.example', password: PASSWORD },
      { tenantId: TENANT_A });
    await expect(wrong).rejects.toThrow(UnauthenticatedError);
    await expect(missing).rejects.toThrow(UnauthenticatedError);
    const [w, m] = await Promise.all([wrong.catch((e) => e), missing.catch((e) => e)]);
    // Identical public message — otherwise login is a staff-list enumerator.
    expect(w.publicMessage).toBe(m.publicMessage);
  });

  it('writes a staff.logged_in event (#7)', async () => {
    const r = await owner.query(
      `SELECT count(*)::int n FROM event_log WHERE tenant_id=$1 AND event_type='staff.logged_in'`,
      [TENANT_A]);
    expect(r.rows[0].n).toBeGreaterThan(0);
  });
});

describe('S5 · session resolution', () => {
  it('resolves a cookie to a session carrying tenant and properties', async () => {
    const issued = await login({ tenantSlug: 't-a', email: 'desk@a.example', password: PASSWORD },
      { tenantId: TENANT_A });
    const session = await resolveStaffSession(issued.cookieValue);
    expect(session).not.toBeNull();
    expect(session!.tenantId).toBe(TENANT_A);
    expect([...session!.properties.keys()]).toEqual([a.propertyId]);
    expect(session!.properties.get(a.propertyId)!.has('stay:check_in')).toBe(true);
  });

  it('returns null once revoked — the row IS the session', async () => {
    const issued = await login({ tenantSlug: 't-a', email: 'desk@a.example', password: PASSWORD },
      { tenantId: TENANT_A });
    expect(await resolveStaffSession(issued.cookieValue)).not.toBeNull();
    await revokeStaffSession(issued.cookieValue);
    expect(await resolveStaffSession(issued.cookieValue)).toBeNull();
  });

  it('a swapped tenant id in the cookie resolves to nothing', async () => {
    // The tenant id is routing information, not a credential. RLS confines the
    // token lookup to that tenant, and the hash exists in exactly one.
    const issued = await login({ tenantSlug: 't-a', email: 'desk@a.example', password: PASSWORD },
      { tenantId: TENANT_A });
    const token = issued.cookieValue.split('.').slice(1).join('.');
    expect(await resolveStaffSession(`${TENANT_B}.${token}`)).toBeNull();
  });

  it('ignores a malformed cookie rather than throwing', async () => {
    for (const bad of ['', 'garbage', 'not-a-uuid.token', `${TENANT_A}.`, TENANT_A]) {
      await expect(resolveStaffSession(bad)).resolves.toBeNull();
    }
  });

  it('stops working the moment the user is deactivated', async () => {
    const issued = await login({ tenantSlug: 't-a', email: 'desk@a.example', password: PASSWORD },
      { tenantId: TENANT_A });
    await withTenant({ tenantId: TENANT_A }, (tx) =>
      tx.update(staffUsers).set({ status: 'DISABLED' }).where(eq(staffUsers.email, 'desk@a.example')));
    expect(await resolveStaffSession(issued.cookieValue)).toBeNull();
    await withTenant({ tenantId: TENANT_A }, (tx) =>
      tx.update(staffUsers).set({ status: 'ACTIVE' }).where(eq(staffUsers.email, 'desk@a.example')));
  });
});

describe('S5 · DONE CONDITION', () => {
  it('FRONT_DESK at property A: 403 on an admin-only action AT property A', async () => {
    const issued = await login({ tenantSlug: 't-a', email: 'desk@a.example', password: PASSWORD },
      { tenantId: TENANT_A });
    const session = await resolveStaffSession(issued.cookieValue);
    try {
      authorize(session, a.propertyId, 'role:manage');
      expect.unreachable('front desk must not manage roles');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError);
      expect(httpStatusFor(e)).toBe(403);
    }
  });

  it('FRONT_DESK at property A: 404 on ANYTHING at property B', async () => {
    const issued = await login({ tenantSlug: 't-a', email: 'desk@a.example', password: PASSWORD },
      { tenantId: TENANT_A });
    const session = await resolveStaffSession(issued.cookieValue);
    for (const perm of ['stay:read', 'role:manage', 'property:read'] as const) {
      try {
        authorize(session, b.propertyId, perm);
        expect.unreachable(`must not reach property B via ${perm}`);
      } catch (e) {
        expect(e, perm).toBeInstanceOf(NotFoundError);
        expect(httpStatusFor(e)).toBe(404);
      }
    }
  });

  it('and the database agrees — B\'s rows are invisible under A\'s tenant', async () => {
    const rows = await withTenant({ tenantId: TENANT_A }, (tx) =>
      tx.select().from(roles).where(eq(roles.tenantId, TENANT_B)));
    expect(rows).toHaveLength(0);
  });
});
