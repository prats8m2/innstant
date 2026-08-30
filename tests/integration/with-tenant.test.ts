import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { eq } from 'drizzle-orm';
import { withTenant, recordEvent, closePool } from '@/db';
import { properties, rooms } from '@/db/schema';
import { ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * isolation.test.ts proves the POLICIES hold at the raw SQL level. This proves
 * the helper application code actually calls behaves the same way — including
 * the one thing the policies cannot enforce on their own: that a status change
 * and its event_log row share a transaction (CLAUDE.md #7).
 */
let owner: pg.Client;
let a: Fixture;
let b: Fixture;

beforeAll(async () => {
  owner = ownerClient();
  await owner.connect();
  await cleanup(owner);
  a = await seedTenant(owner, TENANT_A, 'A');
  b = await seedTenant(owner, TENANT_B, 'B');
}, 60_000);

afterAll(async () => {
  await cleanup(owner);
  await owner.end();
  await closePool();
});

describe('withTenant', () => {
  it('scopes reads to the given tenant', async () => {
    const rows = await withTenant({ tenantId: TENANT_A }, (tx) => tx.select().from(rooms));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(a.roomId);
  });

  it('cannot reach another tenant\'s row even by id', async () => {
    const rows = await withTenant({ tenantId: TENANT_A }, (tx) =>
      tx.select().from(rooms).where(eq(rooms.id, b.roomId)));
    expect(rows).toHaveLength(0);
  });

  it('sets property_id when narrowing a staff session', async () => {
    const v = await withTenant({ tenantId: TENANT_A, propertyId: a.propertyId }, async (tx) => {
      const r = await tx.execute(`select current_setting('app.property_id', true) as v`);
      return (r.rows[0] as { v: string }).v;
    });
    expect(v).toBe(a.propertyId);
  });

  it('rejects a malformed tenant id before it reaches the policy', async () => {
    // '' is the dangerous one — nullif turns it into "match nothing", so it
    // would fail silently rather than loudly (D-020).
    for (const bad of ['', 'not-a-uuid', '11111111']) {
      await expect(withTenant({ tenantId: bad }, async () => null)).rejects.toThrow(TypeError);
    }
  });

  it('rolls back the whole transaction when the callback throws', async () => {
    await expect(
      withTenant({ tenantId: TENANT_A }, async (tx) => {
        await tx.insert(properties).values({
          tenantId: TENANT_A, name: 'Should not survive', slug: 'ghost',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const rows = await withTenant({ tenantId: TENANT_A }, (tx) =>
      tx.select().from(properties).where(eq(properties.slug, 'ghost')));
    expect(rows).toHaveLength(0);
  });
});

describe('recordEvent · CLAUDE.md #7', () => {
  it('writes the event in the SAME transaction as the change it records', async () => {
    await withTenant({ tenantId: TENANT_A }, async (tx) => {
      await tx.update(rooms).set({ status: 'OCCUPIED' }).where(eq(rooms.id, a.roomId));
      await recordEvent(tx, {
        tenantId: TENANT_A, propertyId: a.propertyId,
        entityType: 'room', entityId: a.roomId,
        eventType: 'room.occupied', fromStatus: 'AVAILABLE', toStatus: 'OCCUPIED',
      });
    });
    const r = await owner.query(
      `SELECT to_status FROM event_log WHERE entity_id=$1 AND event_type='room.occupied'`, [a.roomId]);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].to_status).toBe('OCCUPIED');
  });

  it('loses the event when the surrounding transaction rolls back', async () => {
    // This is the property that makes event_log a truthful record of what
    // HAPPENED rather than of what was attempted.
    await expect(
      withTenant({ tenantId: TENANT_A }, async (tx) => {
        await tx.update(rooms).set({ status: 'DIRTY' }).where(eq(rooms.id, a.roomId));
        await recordEvent(tx, {
          tenantId: TENANT_A, entityType: 'room', entityId: a.roomId, eventType: 'room.rolled_back',
        });
        throw new Error('failed after the event was written');
      }),
    ).rejects.toThrow();

    const events = await owner.query(
      `SELECT 1 FROM event_log WHERE event_type='room.rolled_back'`);
    expect(events.rowCount).toBe(0);

    const room = await owner.query(`SELECT status FROM rooms WHERE id=$1`, [a.roomId]);
    expect(room.rows[0].status).not.toBe('DIRTY');
  });

  it('records the actor', async () => {
    await withTenant({ tenantId: TENANT_A }, (tx) =>
      recordEvent(tx, {
        tenantId: TENANT_A, entityType: 'room', entityId: a.roomId,
        eventType: 'room.inspected', actor: { kind: 'SYSTEM' },
      }));
    const r = await owner.query(
      `SELECT actor_kind FROM event_log WHERE event_type='room.inspected'`);
    expect(r.rows[0].actor_kind).toBe('SYSTEM');
  });
});
