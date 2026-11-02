import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { withTenant, readEventHistory } from '@/db';
import {
  postDeskCharge, adjustBill, recordRefund, recordPayment, getFolioForStay, buildDeskBill,
} from '@/modules/billing';
import { checkOutStay } from '@/modules/stay';
import { ownerClient, seedTenant, cleanup, checkInGuest, TENANT_A, TENANT_B, type Fixture } from './setup';

/**
 * D-095 against a real database: a checkout from first charge to closed
 * bill — room nights with their GST, a correction, part payments, an
 * overpayment given back — every step its own row and its own event.
 */
describe('checking a guest out with the whole bill', () => {
  let owner: pg.Client;
  let a: Fixture;
  let b: Fixture;
  let gm: string;
  let stayId: string;
  const scoped = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant<T>({ tenantId: a.tenantId, propertyId: a.propertyId }, fn);
  const common = () => ({ tenantId: a.tenantId, propertyId: a.propertyId, stayId, staffUserId: gm });
  const bill = async () => buildDeskBill((await scoped((tx) => getFolioForStay(tx, stayId)))!, new Map());

  beforeAll(async () => {
    owner = ownerClient();
    await owner.connect();
    await cleanup(owner);
    a = await seedTenant(owner, TENANT_A, 'A');
    b = await seedTenant(owner, TENANT_B, 'B');
    gm = (await owner.query<{ id: string }>(
      `INSERT INTO staff_users (tenant_id, email, full_name, status)
       VALUES ($1, 'gm@a.example', 'GM', 'ACTIVE') RETURNING id`, [a.tenantId])).rows[0]!.id;
    stayId = await checkInGuest(a, { name: 'Checking Out' });
  });

  afterAll(async () => {
    await cleanup(owner);
    await owner.end();
  });

  it('adds room nights with their GST as a line of its own', async () => {
    const posted = await scoped((tx) => postDeskCharge(tx, {
      ...common(), kind: 'ROOM', detail: 'Lake view', quantity: 3, unitMinor: 650_000, taxBps: 1200, currency: 'INR',
    }));
    expect(posted).toMatchObject({ amountMinor: 1_950_000, taxMinor: 234_000 });

    const now = await bill();
    expect(now.sections.map((s) => s.key)).toEqual(['room', 'taxes']);
    expect(now.sections[0]!.lines[0]!.description).toBe('Room · Lake view · 3 × ₹6,500');
    expect(now.sections[1]!.lines[0]!.description).toMatch(/^GST 12% on Room/);
    expect(now.balanceMinor).toBe(2_184_000);
  });

  it('corrects one line by no more than is on it, with the reason on the bill', async () => {
    const roomLine = (await bill()).sections[0]!.lines[0]!;
    await expect(scoped((tx) => adjustBill(tx, {
      ...common(), lineId: roomLine.id, amountMinor: 2_000_000, reason: 'Too much', currency: 'INR',
    }))).rejects.toThrow(/left on that line/);

    await scoped((tx) => adjustBill(tx, {
      ...common(), lineId: roomLine.id, amountMinor: 650_000, reason: 'One night comped', currency: 'INR',
    }));
    const now = await bill();
    expect(now.sections.find((s) => s.key === 'credits')!.lines[0]!.description)
      .toBe('Correction · Room · Lake view · 3 × ₹6,500 — One night comped');
    expect(now.balanceMinor).toBe(1_534_000);
  });

  it('takes the money in parts, and an overpayment is given back — once', async () => {
    await scoped((tx) => recordPayment(tx, { ...common(), amountMinor: 1_000_000, currency: 'INR', method: 'CARD', reference: '4242', idempotencyKey: 'pay-1' }));
    await scoped((tx) => recordPayment(tx, { ...common(), amountMinor: 600_000, currency: 'INR', method: 'CASH', idempotencyKey: 'pay-2' }));
    expect((await bill()).balanceMinor).toBe(-66_000);

    // Not more than was overpaid.
    await expect(scoped((tx) => recordRefund(tx, {
      ...common(), amountMinor: 100_000, method: 'CASH', reason: 'Change', idempotencyKey: 'refund-too-much',
    }))).rejects.toThrow(/owed back/);

    const first = await scoped((tx) => recordRefund(tx, {
      ...common(), amountMinor: 66_000, method: 'CASH', reason: 'Change from cash', idempotencyKey: 'refund-1',
    }));
    const again = await scoped((tx) => recordRefund(tx, {
      ...common(), amountMinor: 66_000, method: 'CASH', reason: 'Change from cash', idempotencyKey: 'refund-1',
    }));
    expect(first.balanceMinor).toBe(0);
    expect(again.wasAlreadyRefunded).toBe(true);
    expect((await bill()).payments.filter((p) => p.isRefund)).toHaveLength(1);
  });

  it('checks them out square, closing the bill, and every step is on the record', async () => {
    const result = await scoped((tx) => checkOutStay(tx, common()));
    expect(result).toMatchObject({ balanceMinor: 0, folioSettled: true });

    const folio = (await scoped((tx) => getFolioForStay(tx, stayId)))!;
    const events = await scoped((tx) => readEventHistory(tx, 'folio', folio.id));
    expect(events.map((e) => e.event_type)).toEqual(expect.arrayContaining([
      'folio.charge_added', 'folio.adjusted', 'folio.payment_taken', 'folio.refunded', 'folio.settled',
    ]));

    // A settled bill takes nothing more.
    await expect(scoped((tx) => postDeskCharge(tx, {
      ...common(), kind: 'MINIBAR', quantity: 1, unitMinor: 10_000, taxBps: 0, currency: 'INR',
    }))).rejects.toThrow(/already settled/);
  });

  it('never touches another hotel\'s bill', async () => {
    await expect(withTenant({ tenantId: b.tenantId, propertyId: b.propertyId }, (tx) => adjustBill(tx, {
      tenantId: b.tenantId, propertyId: b.propertyId, stayId, staffUserId: gm,
      amountMinor: 100, reason: 'Not mine', currency: 'INR',
    }))).rejects.toThrow();
  });
});
