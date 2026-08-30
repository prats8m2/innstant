import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, closePool } from '@/db';
import { provisionProperty } from '@/modules/identity';
import { ownerClient, cleanup, TENANT_A } from './setup';

/**
 * S6 — provisioning is ONE transaction. Half a property is worse than none:
 * rooms with no QR codes, or an outlet with no access policy, is a property
 * that looks provisioned and fails at the first scan.
 */
let owner: pg.Client;

const INPUT = {
  tenantId: TENANT_A,
  name: 'Provision Test',
  slug: 'provision-test',
  city: 'Udaipur',
  roomTypes: [{ code: 'DLX', name: 'Deluxe' }, { code: 'STD', name: 'Standard' }],
  floors: [{ level: 0, name: 'Ground' }, { level: 1, name: 'First' }],
  rooms: [
    { number: '001', floorLevel: 0, roomTypeCode: 'STD' },
    { number: '101', floorLevel: 1, roomTypeCode: 'DLX' },
    { number: '102', floorLevel: 1, roomTypeCode: 'DLX' },
  ],
  adminEmail: 'admin@provision.example',
};

beforeAll(async () => {
  owner = ownerClient();
  await owner.connect();
  await cleanup(owner);
  await owner.query(
    `INSERT INTO tenants (id, name, slug, status) VALUES ($1,'Tenant A','t-a','ACTIVE')
     ON CONFLICT (slug) DO NOTHING`, [TENANT_A]);
}, 180_000);

afterAll(async () => {
  await cleanup(owner);
  await owner.query(`DELETE FROM tenants WHERE id = $1`, [TENANT_A]);
  await owner.end();
  await closePool();
});

describe('provisionProperty', () => {
  it('creates everything a property needs in one call', async () => {
    const p = await withTenant({ tenantId: TENANT_A }, (tx) => provisionProperty(tx, INPUT));

    expect(p.roomIds.size).toBe(3);
    expect(p.qrCodes.size).toBe(3);
    expect(p.requestTypeCount).toBeGreaterThanOrEqual(20);
    expect(p.outletId).toBeTruthy();
    expect(p.accessPolicyId).toBeTruthy();
    expect(p.adminStaffUserId).toBeTruthy();

    const counts = await owner.query(`
      SELECT
        (SELECT count(*) FROM roles          WHERE tenant_id=$1 AND is_system) roles,
        (SELECT count(*) FROM rooms          WHERE property_id=$2) rooms,
        (SELECT count(*) FROM room_qr_codes  WHERE property_id=$2) qrs,
        (SELECT count(*) FROM outlet_hours   WHERE outlet_id=$3)  hours,
        (SELECT count(*) FROM access_policies WHERE property_id=$2) policies
    `, [TENANT_A, p.propertyId, p.outletId]);
    const row = counts.rows[0];
    expect(Number(row.roles)).toBe(8);
    expect(Number(row.rooms)).toBe(3);
    expect(Number(row.qrs)).toBe(3);      // one per room, no room left unscannable
    expect(Number(row.hours)).toBe(7);    // a full week
    expect(Number(row.policies)).toBe(1);
  });

  it('defaults the access policy to REQUEST / FIRST_CHARGE (D-012)', async () => {
    // The single most reversible-looking decision in the product. A property
    // shipped with base_tier BROWSE would gate the menu behind verification,
    // which is exactly what D-012 rejected.
    const r = await owner.query(
      `SELECT base_tier, escalation_trigger FROM access_policies WHERE tenant_id=$1`, [TENANT_A]);
    expect(r.rows[0].base_tier).toBe('REQUEST');
    expect(r.rows[0].escalation_trigger).toBe('FIRST_CHARGE');
  });

  it('issues QR codes at version 1, unrevoked and globally unique', async () => {
    const r = await owner.query(
      `SELECT version, revoked_at, public_code FROM room_qr_codes WHERE tenant_id=$1`, [TENANT_A]);
    expect(r.rowCount).toBe(3);
    for (const row of r.rows) {
      expect(row.version).toBe(1);
      expect(row.revoked_at).toBeNull();
    }
    expect(new Set(r.rows.map((x) => x.public_code)).size).toBe(3);
  });

  it('makes the first admin a PROPERTY_ADMIN, invited without a password', async () => {
    const r = await owner.query(`
      SELECT su.status, su.password_hash, r.key
      FROM staff_users su
      JOIN staff_property_roles spr ON spr.staff_user_id = su.id
      JOIN roles r ON r.id = spr.role_id
      WHERE su.tenant_id = $1 AND su.email = $2`, [TENANT_A, INPUT.adminEmail]);
    expect(r.rows[0].key).toBe('PROPERTY_ADMIN');
    expect(r.rows[0].status).toBe('INVITED');
    expect(r.rows[0].password_hash).toBeNull();
  });

  it('is idempotent — a second call creates nothing new', async () => {
    const before = await owner.query(
      `SELECT (SELECT count(*) FROM rooms WHERE tenant_id=$1) r,
              (SELECT count(*) FROM room_qr_codes WHERE tenant_id=$1) q,
              (SELECT count(*) FROM request_types WHERE tenant_id=$1) t`, [TENANT_A]);
    await withTenant({ tenantId: TENANT_A }, (tx) => provisionProperty(tx, INPUT));
    const after = await owner.query(
      `SELECT (SELECT count(*) FROM rooms WHERE tenant_id=$1) r,
              (SELECT count(*) FROM room_qr_codes WHERE tenant_id=$1) q,
              (SELECT count(*) FROM request_types WHERE tenant_id=$1) t`, [TENANT_A]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('rolls the WHOLE property back if any step fails', async () => {
    // The reason this is one transaction. A property with rooms but no access
    // policy looks provisioned and dies at the first scan.
    const slug = 'atomic-test';
    await expect(
      withTenant({ tenantId: TENANT_A }, (tx) =>
        provisionProperty(tx, {
          ...INPUT, slug, name: 'Atomic',
          rooms: [{ number: '900', floorLevel: 9, roomTypeCode: 'DLX' }], // floor 9 does not exist
          adminEmail: 'atomic@provision.example',
        })),
    ).rejects.toThrow(/unknown floor/);

    const left = await owner.query(`SELECT 1 FROM properties WHERE slug = $1`, [slug]);
    expect(left.rowCount).toBe(0);
  });
});
