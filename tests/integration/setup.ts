import pg from 'pg';
import { withTenant } from '@/db';
import { provisionProperty } from '@/modules/identity';

/**
 * Integration-test fixtures. These run against a REAL Postgres — the whole
 * point of S4 is that the isolation is proven by the database, not by a mock.
 * A mocked RLS policy proves nothing at all.
 *
 * The owner client exists to set up and tear down fixtures. Everything under
 * test goes through the app connection, as app_user, subject to RLS.
 */
export const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
export const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002';

export function ownerClient(): pg.Client {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error('DATABASE_MIGRATION_URL required for integration tests');
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
}

export function appPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for integration tests');
  // max: 1 makes connection reuse deterministic — the leak test in this suite
  // depends on the second request landing on the same connection as the first.
  return new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
}

export interface Fixture {
  tenantId: string;
  propertyId: string;
  floorId: string;
  roomTypeId: string;
  roomId: string;
  guestId: string;
  outletId: string;
  qrCode: string;
}

/**
 * Builds a tenant through `provisionProperty()` — the SAME function the front
 * desk and the seeder call (S6).
 *
 * These fixtures used to hand-roll rows, which meant the tests exercised a
 * shape nothing in production ever creates. Now a change that breaks
 * provisioning breaks the test suite, which is the point.
 */
export async function seedTenant(
  owner: pg.Client,
  tenantId: string,
  label: string,
): Promise<Fixture> {
  await owner.query(
    `INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'ACTIVE')
     ON CONFLICT (slug) DO NOTHING`,
    [tenantId, `Tenant ${label}`, `t-${label.toLowerCase()}`]);

  const provisioned = await withTenant({ tenantId }, (tx) =>
    provisionProperty(tx, {
      tenantId,
      name: `Hotel ${label}`,
      slug: `h-${label.toLowerCase()}`,
      city: 'Udaipur',
      roomTypes: [{ code: 'DLX', name: 'Deluxe' }],
      floors: [{ level: 0, name: 'Ground' }],
      rooms: [{ number: '214', floorLevel: 0, roomTypeCode: 'DLX' }],
      adminEmail: `admin@${label.toLowerCase()}.example`,
    }));

  const details = await owner.query<{ floor_id: string; room_type_id: string }>(
    `SELECT floor_id, room_type_id FROM rooms WHERE id = $1`,
    [provisioned.roomIds.get('214')]);

  const guest = await owner.query<{ id: string }>(
    `INSERT INTO guests (tenant_id, full_name, phone) VALUES ($1,$2,$3) RETURNING id`,
    [tenantId, `Guest ${label}`, `+9190000000${label === 'A' ? '1' : '2'}`]);

  return {
    tenantId,
    propertyId: provisioned.propertyId,
    floorId: details.rows[0]!.floor_id,
    roomTypeId: details.rows[0]!.room_type_id,
    roomId: provisioned.roomIds.get('214')!,
    guestId: guest.rows[0]!.id,
    outletId: provisioned.outletId,
    qrCode: provisioned.qrCodes.get('214')!,
  };
}

export async function cleanup(owner: pg.Client): Promise<void> {
  // One statement per call: pg refuses multiple commands in a parameterised
  // query. Order matters — children before parents.
  //
  // event_log has DELETE revoked from app_user, but the owner may clear it.
  // Children before parents. Provisioning creates far more than the tests do,
  // so this list must track provisionProperty() — a stale entry here shows up
  // as a foreign-key error in an unrelated test.
  const tables = [
    'event_log',
    'order_item_modifiers', 'order_items', 'orders',
    'service_request_items', 'service_requests',
    'folio_lines', 'folios',
    'guest_sessions', 'access_escalations', 'verification_challenges',
    'staff_vouches', 'access_policies',
    'collection_items', 'collections', 'menu_items', 'menu_categories',
    'outlet_hours', 'outlets', 'request_types',
    'stays', 'guest_property_profiles', 'guests',
    'room_qr_codes', 'rooms', 'floors', 'room_types',
    'staff_sessions', 'staff_property_roles', 'role_permissions', 'roles', 'staff_users',
    'properties',
  ];
  for (const table of tables) {
    await owner.query(`DELETE FROM ${table} WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  }
  await owner.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [TENANT_A, TENANT_B]);
}
