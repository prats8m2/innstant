import pg from 'pg';
import { dbSsl } from '@/db/ssl';
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
  return new pg.Client({ connectionString: url, ssl: dbSsl(url) });
}

export function appPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required for integration tests');
  // max: 1 makes connection reuse deterministic — the leak test in this suite
  // depends on the second request landing on the same connection as the first.
  return new pg.Pool({ connectionString: url, ssl: dbSsl(url), max: 1 });
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

/**
 * Wipe both test tenants.
 *
 * FK-order-independent on purpose. An explicit children-first list has to track
 * every foreign key in a 51-table schema, and getting it wrong surfaces as a
 * constraint violation in whichever unrelated test happens to run next — which
 * already happened twice. `session_replication_role = replica` suspends FK
 * triggers for this session only; the owner role may set it, the app role
 * cannot, and it is restored immediately.
 *
 * This is a TEST fixture. Nothing in the application may do this.
 */
const TENANT_SCOPED_TABLES = [
  'event_log', 'order_item_modifiers', 'order_items', 'orders',
  'cart_item_modifiers', 'cart_items', 'carts',
  'service_request_items', 'service_requests',
  'folio_lines', 'folios', 'payments',
  'checkout_requests',
  'access_escalations', 'staff_vouches', 'verification_challenges',
  'guest_sessions', 'access_policies',
  'itinerary_stops', 'itineraries', 'pois', 'notifications',
  'collection_items', 'collections', 'menu_item_availability_windows',
  'menu_item_modifier_groups', 'modifier_options', 'modifier_groups',
  'menu_items', 'menu_categories', 'outlet_hours', 'outlets',
  'request_types', 'shift_zones', 'shifts',
  'stays', 'guest_property_profiles', 'guests',
  'room_qr_codes', 'rooms', 'floors', 'room_types',
  'staff_sessions', 'staff_property_roles', 'role_permissions', 'roles', 'staff_users',
  'idempotency_keys', 'integration_outbox', 'properties',
];

export async function cleanup(owner: pg.Client): Promise<void> {
  await owner.query(`SET session_replication_role = replica`);
  try {
    for (const table of TENANT_SCOPED_TABLES) {
      await owner.query(`DELETE FROM ${table} WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
    }
    await owner.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  } finally {
    await owner.query(`SET session_replication_role = origin`);
  }
}
