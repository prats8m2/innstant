import { describe, it, expect } from 'vitest';
import { buildDeskBill, type OrderBreakdown } from '@/modules/billing/desk-bill';
import { formatRate } from '@/modules/billing/desk-billing';

/**
 * D-095: the bill the checkout screen and the invoice print, from a folio's
 * lines. Pure, so every grouping and total is pinned here.
 */
const at = new Date('2026-11-02T06:00:00Z');
let n = 0;
const line = (over: Partial<{
  source: string; category: string | null; sourceRefId: string | null; description: string; amountMinor: number;
}>) => ({
  id: `l${++n}`,
  source: 'MANUAL',
  category: null,
  sourceRefId: null,
  description: 'Something',
  amountMinor: 0,
  createdAt: at,
  postedByStaffId: null,
  ...over,
});

describe('the bill at checkout', () => {
  const order: OrderBreakdown = {
    orderNumber: 'KE-1184', items: 'Laal maas, 2× Butter roti',
    subtotalMinor: 130_000, serviceChargeMinor: 6_500, taxMinor: 6_825, deliveryFeeMinor: 0, tipMinor: 0, totalMinor: 143_325,
  };
  const room = line({ category: 'ROOM', description: 'Room · Lake view · 3 × ₹6,500', amountMinor: 1_950_000 });
  const lines = [
    room,
    line({ category: 'TAX', sourceRefId: room.id, description: 'GST 12% on Room', amountMinor: 234_000 }),
    line({ source: 'ORDER', sourceRefId: 'order-1', description: 'In-room dining', amountMinor: 143_325 }),
    line({ source: 'SERVICE_REQUEST', description: 'Laundry service', amountMinor: 45_000 }),
    line({ source: 'CHECKOUT_FEE', description: 'Late checkout · 2pm', amountMinor: 250_000 }),
    line({ category: 'MINIBAR', description: 'Minibar · Two sodas', amountMinor: 30_000 }),
    line({ source: 'ADJUSTMENT', sourceRefId: room.id, description: 'Correction · Room — noisy', amountMinor: -650_000 }),
    line({ source: 'PAYMENT', description: 'Card · 4242', amountMinor: 1_000_000 }),
    line({ source: 'PAYMENT', description: 'Refund · Cash — overpaid', amountMinor: -20_000 }),
  ];
  const bill = buildDeskBill({ lines }, new Map([['order-1', order]]));

  it('groups lines the way a guest reads a hotel bill, in a fixed order', () => {
    expect(bill.sections.map((s) => s.key)).toEqual(['room', 'food', 'services', 'late', 'other', 'taxes', 'credits']);
    expect(bill.sections.find((s) => s.key === 'food')!.lines[0]).toMatchObject({
      description: 'Order KE-1184', detail: 'Laal maas, 2× Butter roti', amountMinor: 143_325,
    });
  });

  it('counts the GST in food orders and on desk charges, and the service charge', () => {
    expect(bill.taxMinor).toBe(6_825 + 234_000);
    expect(bill.serviceChargeMinor).toBe(6_500);
  });

  it('nets corrections into the charges and refunds into what was paid', () => {
    const charges = 1_950_000 + 234_000 + 143_325 + 45_000 + 250_000 + 30_000 - 650_000;
    expect(bill.chargesMinor).toBe(charges);
    expect(bill.paidMinor).toBe(1_000_000 - 20_000);
    expect(bill.balanceMinor).toBe(charges - 980_000);
    expect(bill.payments.map((p) => p.isRefund)).toEqual([false, true]);
  });

  it('offers a correction only on a charge with something left on it', () => {
    const roomLine = bill.sections.find((s) => s.key === 'room')!.lines[0]!;
    expect(roomLine.correctable).toBe(true);
    const credit = bill.sections.find((s) => s.key === 'credits')!.lines[0]!;
    expect(credit.correctable).toBe(false);

    const fullyCorrected = buildDeskBill({ lines: [
      room, line({ source: 'ADJUSTMENT', sourceRefId: room.id, amountMinor: -1_950_000 }),
    ] }, new Map());
    expect(fullyCorrected.sections[0]!.lines[0]!.correctable).toBe(false);
  });

  it('is empty, and square, for a stay that has bought nothing', () => {
    expect(buildDeskBill({ lines: [] }, new Map())).toMatchObject({ sections: [], chargesMinor: 0, balanceMinor: 0 });
  });
});

describe('formatRate', () => {
  it('prints a GST slab the way a bill does', () => {
    expect(formatRate(1200)).toBe('12%');
    expect(formatRate(250)).toBe('2.5%');
    expect(formatRate(0)).toBe('0%');
  });
});
