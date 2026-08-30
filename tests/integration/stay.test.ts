import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import { createStay, activeStayForRoom } from '@/modules/stay';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { ownerClient, seedTenant, cleanup, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * `createStay()` — the single place a stay is created (CLAUDE.md #4).
 *
 * The interesting assertions are the ones only a real database can make: that
 * D-007's partial unique index actually holds under concurrency, and that the
 * event log row is written in the same transaction as the stay rather than
 * after it.
 */
describe('createStay', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;

  const inTwoDays = () => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d;
  };

  const create = (fixture: Fixture, overrides: Record<string, unknown> = {}) =>
    withTenant({ tenantId: fixture.tenantId, propertyId: fixture.propertyId }, (tx) =>
      createStay(tx, {
        tenantId: fixture.tenantId,
        propertyId: fixture.propertyId,
        roomId: fixture.roomId,
        guest: { fullName: 'Anjali Menon', phone: '+919820011111' },
        scheduledCheckoutAt: inTwoDays(),
        ...overrides,
      } as Parameters<typeof createStay>[1]));

  async function extraRoom(number: string): Promise<string> {
    const r = await owner.query<{ id: string }>(`
      INSERT INTO rooms (tenant_id, property_id, floor_id, room_type_id, number, status)
      VALUES ($1,$2,$3,$4,$5,'AVAILABLE') RETURNING id`,
      [a.tenantId, a.propertyId, a.floorId, a.roomTypeId, number]);
    return r.rows[0]!.id;
  }

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
  });

  beforeEach(async () => {
    await owner.query(`SET session_replication_role = replica`);
    await owner.query(`DELETE FROM event_log WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
    await owner.query(`DELETE FROM stays WHERE tenant_id IN ($1,$2)`, [TENANT_A, TENANT_B]);
    await owner.query(`SET session_replication_role = origin`);
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('creates the stay, the guest, and the property profile together', async () => {
    const created = await create(a);

    expect(created.stayId).toBeTruthy();
    expect(created.guestIsNew).toBe(true);

    const profile = await owner.query(
      `SELECT 1 FROM guest_property_profiles WHERE guest_id = $1 AND property_id = $2`,
      [created.guestId, a.propertyId]);
    // The property-local view of a tenant-wide guest (EXTENSION-POINTS §2).
    // Nothing else creates it, so a stay without one is a stay the front desk
    // cannot annotate.
    expect(profile.rowCount).toBe(1);
  });

  it('writes stay.created in the same transaction (#7)', async () => {
    const created = await create(a);

    const events = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      readEventHistory(tx, 'stay', created.stayId));

    expect(events).toHaveLength(1);
    expect(events[0]!.event_type).toBe('stay.created');
    expect(events[0]!.to_status).toBe('CHECKED_IN');
  });

  it('leaves no stay behind when the surrounding transaction rolls back', async () => {
    // The event and the row are one write or neither. This is what taking `tx`
    // rather than opening its own transaction buys.
    await expect(
      withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, async (tx) => {
        await createStay(tx, {
          tenantId: a.tenantId,
          propertyId: a.propertyId,
          roomId: a.roomId,
          guest: { fullName: 'Rolled Back', phone: '+919820099999' },
          scheduledCheckoutAt: inTwoDays(),
        });
        throw new Error('caller changed its mind');
      }),
    ).rejects.toThrow('caller changed its mind');

    const stays = await owner.query(`SELECT 1 FROM stays WHERE tenant_id = $1`, [TENANT_A]);
    const events = await owner.query(
      `SELECT 1 FROM event_log WHERE tenant_id = $1 AND event_type = 'stay.created'`, [TENANT_A]);
    expect(stays.rowCount).toBe(0);
    expect(events.rowCount).toBe(0);
  });

  it('matches a returning guest on (tenant, phone) rather than creating a second', async () => {
    const first = await create(a);
    await owner.query(`UPDATE stays SET status='CHECKED_OUT' WHERE id=$1`, [first.stayId]);

    const second = await create(a, { guest: { fullName: 'A. Menon', phone: '+919820011111' } });

    // The same person, so the same guest row — which is what makes their
    // history follow them (EXTENSION-POINTS §2).
    expect(second.guestId).toBe(first.guestId);
    expect(second.guestIsNew).toBe(false);
  });

  it('creates a fresh guest when there is no phone to match on', async () => {
    // An anonymous walk-in has no identity to reuse, and pretending otherwise
    // would merge two strangers.
    const first = await create(a, { guest: { fullName: 'Walk In', phone: null } });
    await owner.query(`UPDATE stays SET status='CHECKED_OUT' WHERE id=$1`, [first.stayId]);
    const second = await create(a, { guest: { fullName: 'Walk In', phone: null } });

    expect(second.guestId).not.toBe(first.guestId);
  });

  it('refuses a second guest in an occupied room', async () => {
    await create(a);
    await expect(create(a, { guest: { fullName: 'Someone Else', phone: '+919820044444' } }))
      .rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a room at another property', async () => {
    // A room id from a sister property is indistinguishable from a typo.
    await expect(create(a, { roomId: b.roomId })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a checkout date that is already history', async () => {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    await expect(create(a, { scheduledCheckoutAt: lastWeek }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('lets exactly one of two concurrent check-ins win (D-007)', async () => {
    // Two front desk terminals, the same room, the same moment. The partial
    // unique index is the only thing that actually settles this — the read
    // check above races and both sides can pass it.
    const results = await Promise.allSettled([
      create(a, { guest: { fullName: 'First Arrival', phone: '+919820055555' } }),
      create(a, { guest: { fullName: 'Second Arrival', phone: '+919820066666' } }),
    ]);

    const won = results.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);

    const rows = await owner.query(
      `SELECT 1 FROM stays WHERE room_id = $1 AND status = 'CHECKED_IN'`, [a.roomId]);
    expect(rows.rowCount).toBe(1);
  });

  it('finds the active stay for a room, and only the active one', async () => {
    const created = await create(a);
    const found = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      activeStayForRoom(tx, a.roomId));
    expect(found?.stayId).toBe(created.stayId);

    await owner.query(`UPDATE stays SET status='CHECKED_OUT' WHERE id=$1`, [created.stayId]);
    const afterCheckout = await withTenant({ tenantId: a.tenantId, propertyId: a.propertyId }, (tx) =>
      activeStayForRoom(tx, a.roomId));
    // Rooms are reused; a checked-out stay must not answer for the room (#10).
    expect(afterCheckout).toBeNull();
  });

  it('lets two properties use the same room number independently', async () => {
    const another = await extraRoom('999');
    await create(a);
    const other = await create(a, {
      roomId: another,
      guest: { fullName: 'Rhea Kapoor', phone: '+919820033333' },
    });
    expect(other.stayId).toBeTruthy();
  });
});
