import pg from 'pg';

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
}

/** Two tenants, each a full property, so cross-tenant reads have something to
 *  wrongly return. */
export async function seedTenant(
  owner: pg.Client,
  tenantId: string,
  label: string,
): Promise<Fixture> {
  await owner.query(`INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)`,
    [tenantId, `Tenant ${label}`, `t-${label.toLowerCase()}`]);
  const property = await owner.query<{ id: string }>(
    `INSERT INTO properties (tenant_id, name, slug, timezone, currency)
     VALUES ($1, $2, $3, 'Asia/Kolkata', 'INR') RETURNING id`,
    [tenantId, `Hotel ${label}`, `h-${label.toLowerCase()}`]);
  const propertyId = property.rows[0]!.id;

  const floor = await owner.query<{ id: string }>(
    `INSERT INTO floors (tenant_id, property_id, name, level) VALUES ($1,$2,'Ground',0) RETURNING id`,
    [tenantId, propertyId]);
  const roomType = await owner.query<{ id: string }>(
    `INSERT INTO room_types (tenant_id, property_id, name, code) VALUES ($1,$2,'Deluxe','DLX') RETURNING id`,
    [tenantId, propertyId]);
  const room = await owner.query<{ id: string }>(
    `INSERT INTO rooms (tenant_id, property_id, floor_id, room_type_id, number)
     VALUES ($1,$2,$3,$4,'214') RETURNING id`,
    [tenantId, propertyId, floor.rows[0]!.id, roomType.rows[0]!.id]);
  const guest = await owner.query<{ id: string }>(
    `INSERT INTO guests (tenant_id, full_name, phone) VALUES ($1,$2,$3) RETURNING id`,
    [tenantId, `Guest ${label}`, `+9190000000${label === 'A' ? '1' : '2'}`]);

  return {
    tenantId, propertyId,
    floorId: floor.rows[0]!.id,
    roomTypeId: roomType.rows[0]!.id,
    roomId: room.rows[0]!.id,
    guestId: guest.rows[0]!.id,
  };
}

export async function cleanup(owner: pg.Client): Promise<void> {
  // One statement per call: pg refuses multiple commands in a parameterised
  // query. Order matters — children before parents.
  //
  // event_log has DELETE revoked from app_user, but the owner may clear it.
  const tables = [
    'event_log', 'stays', 'rooms', 'floors', 'room_types', 'guests', 'properties',
  ];
  for (const table of tables) {
    await owner.query(`DELETE FROM ${table} WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
  }
  await owner.query(`DELETE FROM tenants WHERE id IN ($1,$2)`, [TENANT_A, TENANT_B]);
}
