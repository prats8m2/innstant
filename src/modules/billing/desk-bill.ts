import type { FolioSummary } from './folio';

/**
 * The bill as the checkout screen and the invoice print it (D-095): grouped
 * the way a guest reads a hotel bill, with what each group cost, what tax is
 * in it, what was paid and how, and one balance.
 *
 * Pure — the screen, the printed invoice and the tests all ask it the same
 * question. Every amount is integer minor units (#5); nothing here formats.
 */

export type BillSectionKey =
  | 'room' | 'food' | 'services' | 'late' | 'other' | 'taxes' | 'credits';

export const BILL_SECTION_TITLE: Record<BillSectionKey, string> = {
  room: 'Room',
  food: 'Food and drink',
  services: 'Amenities and services',
  late: 'Late checkout',
  other: 'Other charges',
  taxes: 'Taxes on desk charges',
  credits: 'Discounts and corrections',
};

const ORDER: BillSectionKey[] = ['room', 'food', 'services', 'late', 'other', 'taxes', 'credits'];

/** What an order's single folio line is made of, from the ordering module. */
export interface OrderBreakdown {
  orderNumber: string;
  /** "Laal maas, 2× Butter roti". */
  items: string;
  subtotalMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  deliveryFeeMinor: number;
  tipMinor: number;
  totalMinor: number;
}

export interface BillLine {
  id: string;
  createdAt: Date;
  description: string;
  /** For an order: what is in it and how its total is made up. */
  detail: string | null;
  amountMinor: number;
  /** A line a correction may still take something off. */
  correctable: boolean;
}

export interface BillSection {
  key: BillSectionKey;
  title: string;
  lines: BillLine[];
  totalMinor: number;
}

export interface BillPayment {
  id: string;
  createdAt: Date;
  description: string;
  /** Positive for money taken, negative for money given back. */
  amountMinor: number;
  isRefund: boolean;
}

export interface DeskBill {
  sections: BillSection[];
  payments: BillPayment[];
  /** Everything charged, net of discounts and corrections. */
  chargesMinor: number;
  /** Tax inside that: GST on food (in each order's total) and on desk charges. */
  taxMinor: number;
  /** Service charge inside that, from food orders. */
  serviceChargeMinor: number;
  /** Taken, net of refunds. */
  paidMinor: number;
  /** Positive: still owed. Negative: owed back. */
  balanceMinor: number;
}

type Line = FolioSummary['lines'][number];

function sectionOf(line: Line): BillSectionKey | 'payment' {
  switch (line.source) {
    case 'PAYMENT': return 'payment';
    case 'ORDER': return 'food';
    case 'SERVICE_REQUEST': return 'services';
    case 'CHECKOUT_FEE': return 'late';
    case 'ADJUSTMENT': return 'credits';
    default:
      if (line.category === 'ROOM') return 'room';
      if (line.category === 'TAX') return 'taxes';
      return 'other';
  }
}

export function buildDeskBill(
  folio: Pick<FolioSummary, 'lines'>,
  orders: ReadonlyMap<string, OrderBreakdown>,
): DeskBill {
  const corrected = new Map<string, number>();
  for (const line of folio.lines) {
    if (line.source === 'ADJUSTMENT' && line.sourceRefId) {
      corrected.set(line.sourceRefId, (corrected.get(line.sourceRefId) ?? 0) + line.amountMinor);
    }
  }

  const grouped = new Map<BillSectionKey, BillLine[]>();
  const payments: BillPayment[] = [];
  let taxMinor = 0;
  let serviceChargeMinor = 0;

  for (const line of folio.lines) {
    const key = sectionOf(line);
    if (key === 'payment') {
      payments.push({
        id: line.id,
        createdAt: line.createdAt,
        description: line.description,
        amountMinor: line.amountMinor,
        isRefund: line.amountMinor < 0,
      });
      continue;
    }

    let detail: string | null = null;
    const order = line.source === 'ORDER' && line.sourceRefId ? orders.get(line.sourceRefId) : undefined;
    if (order) {
      taxMinor += order.taxMinor;
      serviceChargeMinor += order.serviceChargeMinor;
      detail = order.items;
    }
    if (key === 'taxes') taxMinor += line.amountMinor;

    const left = line.amountMinor + (corrected.get(line.id) ?? 0);
    const list = grouped.get(key) ?? [];
    list.push({
      id: line.id,
      createdAt: line.createdAt,
      description: order ? `Order ${order.orderNumber}` : line.description,
      detail,
      amountMinor: line.amountMinor,
      correctable: key !== 'credits' && line.amountMinor > 0 && left > 0,
    });
    grouped.set(key, list);
  }

  const sections = ORDER
    .filter((key) => grouped.has(key))
    .map((key) => {
      const lines = grouped.get(key)!;
      return {
        key,
        title: BILL_SECTION_TITLE[key],
        lines,
        totalMinor: lines.reduce((sum, l) => sum + l.amountMinor, 0),
      };
    });

  const chargesMinor = sections.reduce((sum, s) => sum + s.totalMinor, 0);
  const paidMinor = payments.reduce((sum, p) => sum + p.amountMinor, 0);

  return {
    sections,
    payments,
    chargesMinor,
    taxMinor,
    serviceChargeMinor,
    paidMinor,
    balanceMinor: chargesMinor - paidMinor,
  };
}
