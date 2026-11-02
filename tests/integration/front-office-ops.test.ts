import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import { roomCleanStates, cleanStateOf, setRoomCleanStatus } from '@/modules/housekeeping';
import { checkOutStay, changeCheckoutAt, listUnpaidDepartures } from '@/modules/stay';
import { postFolioLine, recordPayment, recordRefund, collectionsToday } from '@/modules/billing';
import { getRequestTypeByKey, raiseServiceRequest } from '@/modules/requests';
import { ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * D-096 and D-097 against a real database: a room's housekeeping state and
 * checkout's part in it, the desk moving a stay and raising a request for a
 * caller, and the money a manager closes the day against.
 */
describe('the front office, run like a hotel', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let gm: string;
  const TZ = 'Asia/Kolkata';
  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);
  const ids = () => ({ tenantId: a.tenantId, propertyId: a.propertyId });

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
    gm = (await owner.query<{ id: string }>(
      `INSERT INTO staff_users (tenant_id, email, full_name, status)
       VALUES ($1, 'gm@a.example', 'GM', 'ACTIVE') RETURNING id`, [a.tenantId])).rows[0]!.id;
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('reads a room with no row as clean, and records every change', async () => {
    expect(cleanStateOf(await scoped((tx) => roomCleanStates(tx, { propertyId: a.propertyId })), a.roomId).status).toBe('CLEAN');

    await expect(scoped((tx) => setRoomCleanStatus(tx, { ...ids(), roomId: a.roomId, status: 'OUT_OF_ORDER', staffUserId: gm })))
      .rejects.toThrow(/what is wrong/);
    await scoped((tx) => setRoomCleanStatus(tx, { ...ids(), roomId: a.roomId, status: 'OUT_OF_ORDER', note: 'Leak', staffUserId: gm }));
    await scoped((tx) => setRoomCleanStatus(tx, { ...ids(), roomId: a.roomId, status: 'CLEAN', staffUserId: gm }));

    const events = await scoped((tx) => readEventHistory(tx, 'room', a.roomId));
    expect(events.filter((e) => e.event_type === 'room.status_changed').map((e) => `${e.from_status}>${e.to_status}`))
      .toEqual(['CLEAN>OUT_OF_ORDER', 'OUT_OF_ORDER>CLEAN']);
  });

  it('marks the room to be made up when the guest checks out', async () => {
    const stayId = await checkInGuest(a, { name: 'Leaving' });
    await scoped((tx) => checkOutStay(tx, { ...ids(), stayId, staffUserId: gm }));
    expect(cleanStateOf(await scoped((tx) => roomCleanStates(tx, { propertyId: a.propertyId })), a.roomId).status).toBe('DIRTY');
    await scoped((tx) => setRoomCleanStatus(tx, { ...ids(), roomId: a.roomId, status: 'CLEAN', staffUserId: gm }));
  });

  it('moves a checkout and keeps the guest\'s phone working until it', async () => {
    const stayId = await checkInGuest(a, { name: 'Staying On' });
    const later = new Date(Date.now() + 5 * 86_400_000);
    const moved = await scoped((tx) => changeCheckoutAt(tx, { ...ids(), stayId, checkoutAt: later, staffUserId: gm }));
    expect(moved.to.toISOString()).toBe(later.toISOString());

    const row = await owner.query<{ scheduled_checkout_at: Date }>(`SELECT scheduled_checkout_at FROM stays WHERE id = $1`, [stayId]);
    expect(new Date(row.rows[0]!.scheduled_checkout_at).toISOString()).toBe(later.toISOString());
    const history = await scoped((tx) => readEventHistory(tx, 'stay', stayId));
    expect(history.some((e) => e.event_type === 'stay.checkout_changed')).toBe(true);

    await expect(scoped((tx) => changeCheckoutAt(tx, { ...ids(), stayId, checkoutAt: new Date(Date.now() - 60_000), staffUserId: gm })))
      .rejects.toThrow(/later than now/);
  });

  it('raises a request for a guest who rang, in the desk\'s name', async () => {
    const stayId = (await owner.query<{ id: string }>(
      `SELECT id FROM stays WHERE room_id = $1 AND status = 'CHECKED_IN'`, [a.roomId])).rows[0]!.id;
    const towels = await scoped((tx) => getRequestTypeByKey(tx, { propertyId: a.propertyId, key: 'EXTRA_TOWELS' }));
    const raised = await scoped((tx) => raiseServiceRequest(tx, {
      ...ids(), stayId, roomId: a.roomId, lines: [{ requestTypeId: towels!.id, quantity: 2 }],
      guestNote: 'Taken by phone at the desk', idempotencyKey: 'phoned-1', accessTier: 'FULL', staffUserId: gm,
    }));
    const opened = await owner.query<{ actor_kind: string; actor_staff_id: string }>(
      `SELECT actor_kind, actor_staff_id FROM event_log WHERE entity_id = $1 AND event_type = 'service_request.opened'`, [raised.requestId]);
    expect(opened.rows[0]).toEqual({ actor_kind: 'STAFF', actor_staff_id: gm });
  });

  it('adds up today\'s takings by method, refunds apart', async () => {
    const stayId = (await owner.query<{ id: string }>(
      `SELECT id FROM stays WHERE room_id = $1 AND status = 'CHECKED_IN'`, [a.roomId])).rows[0]!.id;
    await scoped((tx) => postFolioLine(tx, { ...ids(), stayId, source: 'MANUAL', description: 'Room', amountMinor: 500_000, currency: 'INR' }));
    await scoped((tx) => recordPayment(tx, { ...ids(), stayId, amountMinor: 300_000, currency: 'INR', method: 'CARD', staffUserId: gm, idempotencyKey: 'c-1' }));
    await scoped((tx) => recordPayment(tx, { ...ids(), stayId, amountMinor: 250_000, currency: 'INR', method: 'CASH', staffUserId: gm, idempotencyKey: 'c-2' }));
    await scoped((tx) => recordRefund(tx, { ...ids(), stayId, amountMinor: 50_000, method: 'CASH', reason: 'Change', staffUserId: gm, idempotencyKey: 'r-1' }));

    const today = await scoped((tx) => collectionsToday(tx, { propertyId: a.propertyId, timeZone: TZ }));
    const by = Object.fromEntries(today.rows.map((r) => [r.method, r]));
    expect(by.CARD).toMatchObject({ takenMinor: 300_000, refundedMinor: 0 });
    expect(by.CASH).toMatchObject({ takenMinor: 250_000, refundedMinor: 50_000 });

    const theirs = await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => collectionsToday(tx, { propertyId: a.propertyId, timeZone: TZ }));
    expect(theirs.rows).toEqual([]);
  });

  it('lists who left owing, with the reason they were let go', async () => {
    const stayId = (await owner.query<{ id: string }>(
      `SELECT id FROM stays WHERE room_id = $1 AND status = 'CHECKED_IN'`, [a.roomId])).rows[0]!.id;
    await scoped((tx) => postFolioLine(tx, { ...ids(), stayId, source: 'MANUAL', description: 'Minibar', amountMinor: 120_000, currency: 'INR' }));
    await scoped((tx) => checkOutStay(tx, { ...ids(), stayId, staffUserId: gm, unpaidReason: 'Billed to the company' }));

    const owing = await scoped((tx) => listUnpaidDepartures(tx, { propertyId: a.propertyId }));
    const mine = owing.find((o) => o.stayId === stayId)!;
    expect(mine).toMatchObject({ balanceMinor: 120_000, reason: 'Billed to the company' });

    const theirs = await withTenant({ tenantId: b.tenantId, propertyId: b.propertyId },
      (tx) => listUnpaidDepartures(tx, { propertyId: a.propertyId }));
    expect(theirs).toEqual([]);
  });
});
