import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { ownerClient, appPool, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * S4 — prove the isolation. The most important session in P0.
 *
 * Every test here runs against a real Postgres as `app_user`. The point is that
 * the guarantees come from the database, not from application discipline: if
 * these can be made to pass with a mock, they are testing the wrong thing.
 *
 * P0-TASKS S4 says: "If any of them is awkward to write, that is a signal the
 * design is wrong — tell me rather than weakening the test."
 */
let owner: pg.Client;
let pool: pg.Pool;
let a: Fixture;
let b: Fixture;

/** Mirrors withTenant() at the raw-pg level so the tests exercise the policies
 *  rather than the helper. The helper is covered separately. */
async function asTenant<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  owner = ownerClient();
  await owner.connect();
  await cleanup(owner);
  a = await seedTenant(owner, TENANT_A, 'A');
  b = await seedTenant(owner, TENANT_B, 'B');
  pool = appPool();
}, 60_000);

afterAll(async () => {
  await cleanup(owner);
  await owner.end();
  await pool.end();
});

describe('S4.1 · a tenant reads only its own rows', () => {
  it('withTenant(A) sees A\'s rooms and not B\'s', async () => {
    const rows = await asTenant(TENANT_A, (c) => c.query('SELECT id, number FROM rooms'));
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].id).toBe(a.roomId);
  });

  it('withTenant(B) sees B\'s rooms and not A\'s', async () => {
    const rows = await asTenant(TENANT_B, (c) => c.query('SELECT id FROM rooms'));
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].id).toBe(b.roomId);
  });

  it('a targeted read of another tenant\'s row by id returns nothing', async () => {
    // The dangerous case: the caller already knows the uuid.
    const rows = await asTenant(TENANT_A, (c) =>
      c.query('SELECT id FROM rooms WHERE id = $1', [b.roomId]));
    expect(rows.rowCount).toBe(0);
  });
});

describe('S4.2 · a query outside withTenant returns nothing, not everything', () => {
  it('returns zero rows rather than every hotel\'s data', async () => {
    const rows = await pool.query('SELECT id FROM rooms');
    expect(rows.rowCount).toBe(0);
  });

  it('does not raise — the failure mode is empty, not a 500 (D-020)', async () => {
    // Before D-020 this threw 22P02, because the GUC reverts to '' rather than
    // to unset after a transaction commits.
    await expect(pool.query('SELECT id FROM properties')).resolves.toBeDefined();
  });
});

describe('S4.3 · WITH CHECK rejects a write stamped with another tenant', () => {
  it('refuses an INSERT carrying tenant B\'s id while scoped to A', async () => {
    await expect(
      asTenant(TENANT_A, (c) =>
        c.query(`INSERT INTO floors (tenant_id, property_id, name, level)
                 VALUES ($1, $2, 'Smuggled', 9)`, [TENANT_B, b.propertyId])),
    ).rejects.toThrow();
  });

  it('refuses an UPDATE that would move a row to another tenant', async () => {
    await expect(
      asTenant(TENANT_A, (c) =>
        c.query(`UPDATE rooms SET tenant_id = $1 WHERE id = $2`, [TENANT_B, a.roomId])),
    ).rejects.toThrow();
  });
});

describe('S4.4 · the tenant context does not leak between requests', () => {
  it('a second request on the same pooled connection sees nothing', async () => {
    // D-022: there is no PgBouncer, but node-postgres reuses connections across
    // requests, so a session-scoped SET would leak from one guest into the
    // next. The pool is max:1, so this IS the same connection.
    const first = await asTenant(TENANT_A, (c) => c.query('SELECT id FROM rooms'));
    expect(first.rowCount).toBe(1);

    const second = await pool.query('SELECT id FROM rooms');
    expect(second.rowCount).toBe(0);
  });

  it('a request for B does not inherit A\'s context', async () => {
    await asTenant(TENANT_A, (c) => c.query('SELECT 1'));
    const rows = await asTenant(TENANT_B, (c) => c.query('SELECT id FROM rooms'));
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].id).toBe(b.roomId);
  });
});

describe('S4.5 · event_log is append-only for app_user', () => {
  it('allows INSERT', async () => {
    const r = await asTenant(TENANT_A, (c) =>
      c.query(`INSERT INTO event_log (tenant_id, entity_type, entity_id, event_type)
               VALUES ($1,'room',$2,'room.created') RETURNING id`, [TENANT_A, a.roomId]));
    expect(r.rowCount).toBe(1);
  });

  it('revokes UPDATE — the audit trail cannot be rewritten', async () => {
    await expect(
      asTenant(TENANT_A, (c) => c.query(`UPDATE event_log SET event_type = 'tampered'`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it('revokes DELETE — the audit trail cannot be erased', async () => {
    await expect(
      asTenant(TENANT_A, (c) => c.query(`DELETE FROM event_log`)),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('S4.6 · one active stay per room, under concurrency (D-007)', () => {
  it('two parallel CHECKED_IN inserts resolve to exactly one winner', async () => {
    // Not sequential: the whole point is that the DATABASE decides, not a
    // read-then-write check that a second connection can race through.
    const insert = () =>
      asTenant(TENANT_A, (c) =>
        c.query(`INSERT INTO stays (tenant_id, property_id, room_id, guest_id, status,
                                    checked_in_at, scheduled_checkout_at)
                 VALUES ($1,$2,$3,$4,'CHECKED_IN', now(), now() + interval '2 days')`,
          [TENANT_A, a.propertyId, a.roomId, a.guestId]));

    const results = await Promise.allSettled([insert(), insert()]);
    const won = results.filter((r) => r.status === 'fulfilled').length;
    expect(won).toBe(1);

    const rows = await asTenant(TENANT_A, (c) =>
      c.query(`SELECT id FROM stays WHERE room_id = $1 AND status = 'CHECKED_IN'`, [a.roomId]));
    expect(rows.rowCount).toBe(1);
  });

  it('a checked-out stay frees the room for the next guest', async () => {
    await asTenant(TENANT_A, (c) =>
      c.query(`UPDATE stays SET status='CHECKED_OUT', checked_out_at=now()
               WHERE room_id=$1 AND status='CHECKED_IN'`, [a.roomId]));
    const r = await asTenant(TENANT_A, (c) =>
      c.query(`INSERT INTO stays (tenant_id, property_id, room_id, guest_id, status,
                                  checked_in_at, scheduled_checkout_at)
               VALUES ($1,$2,$3,$4,'CHECKED_IN', now(), now() + interval '1 day') RETURNING id`,
        [TENANT_A, a.propertyId, a.roomId, a.guestId]));
    expect(r.rowCount).toBe(1);
  });
});

describe('S4.7 · app_user cannot dismantle its own constraints', () => {
  it('cannot disable RLS', async () => {
    await expect(pool.query('ALTER TABLE rooms DISABLE ROW LEVEL SECURITY')).rejects.toThrow();
  });

  it('cannot create a permissive policy for itself', async () => {
    await expect(
      pool.query(`CREATE POLICY escape ON rooms USING (true)`),
    ).rejects.toThrow();
  });

  it('owns no tables — owners bypass RLS silently (CLAUDE.md #2)', async () => {
    const r = await pool.query(
      `SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tableowner = current_user`);
    expect(r.rows[0].n).toBe(0);
  });

  it('has neither SUPERUSER nor BYPASSRLS', async () => {
    const r = await pool.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    expect(r.rows[0].rolsuper).toBe(false);
    expect(r.rows[0].rolbypassrls).toBe(false);
  });
});
