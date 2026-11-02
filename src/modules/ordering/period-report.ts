import { sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { emptySeries, windowSql, type ReportWindow } from '@/lib/report-window';

/**
 * Orders over a report period, for the console overview (Today / 7 days /
 * 30 days) — the period twin of `daySummary()`.
 *
 * What counts, exactly:
 *
 *   orders     every order PLACED in the window that is not a draft, rejected
 *              or cancelled — room orders and property-link (visit) orders
 *              alike, from every outlet at the property
 *   sales      the same orders' `total_minor` (tax, service charge, delivery
 *              and tip included), in the outlet currency asked for. This is
 *              "food & drink" on the overview: a visit order never reaches a
 *              folio (D-079), so folios alone would miss the restaurant
 *   delivered  of those, the ones that reached the guest, with the minutes
 *              from placed to delivered summed so an average can be taken
 *              over any span of buckets
 *   open now   orders anywhere between PLACED and OUT_FOR_DELIVERY at this
 *              instant, whenever they were placed
 *
 * Bucketed by the hotel's hour (today) or day (7/30 days), by `placed_at`.
 * Read-only, over this module's own table (D-001).
 */
export interface OrdersPeriod {
  ordersByBucket: number[];
  salesByBucket: number[];
  deliveredByBucket: number[];
  /** Placed → delivered minutes, summed per bucket. */
  minutesToDoorByBucket: number[];
}

export interface OrdersReport {
  currency: string;
  current: OrdersPeriod;
  previous: OrdersPeriod;
  openNow: number;
  /** The period's dishes by quantity, from the receipt snapshots (#6). */
  topDishes: { name: string; quantity: number; salesMinor: number }[];
}

const SOLD = sql`status NOT IN ('DRAFT', 'REJECTED', 'CANCELLED')`;

async function period(
  tx: Tx,
  input: { propertyId: string; window: ReportWindow; currency: string },
  which: 'current' | 'previous',
): Promise<OrdersPeriod> {
  const w = windowSql(input.window, which);
  const rows = (await tx.execute<{
    bucket: number; orders: number; sales: number; delivered: number; minutes: number | null;
  }>(sql`
    SELECT ${w.bucketOf(sql`placed_at`)} AS bucket,
           count(*)::int AS orders,
           coalesce(sum(total_minor) FILTER (WHERE currency = ${input.currency}), 0)::int AS sales,
           count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
           coalesce(sum(extract(epoch FROM delivered_at - placed_at) / 60)
                    FILTER (WHERE delivered_at IS NOT NULL), 0)::float8 AS minutes
    FROM orders
    WHERE property_id = ${input.propertyId}
      AND placed_at >= ${w.start} AND placed_at < ${w.end}
      AND ${SOLD}
    GROUP BY 1
  `)).rows;

  const out: OrdersPeriod = {
    ordersByBucket: emptySeries(input.window),
    salesByBucket: emptySeries(input.window),
    deliveredByBucket: emptySeries(input.window),
    minutesToDoorByBucket: emptySeries(input.window),
  };
  for (const row of rows) {
    const i = Number(row.bucket);
    if (i < 0 || i >= input.window.buckets) continue;
    out.ordersByBucket[i] = Number(row.orders);
    out.salesByBucket[i] = Number(row.sales);
    out.deliveredByBucket[i] = Number(row.delivered);
    out.minutesToDoorByBucket[i] = Number(row.minutes ?? 0);
  }
  return out;
}

export async function ordersReport(
  tx: Tx,
  input: { propertyId: string; window: ReportWindow; currency: string },
): Promise<OrdersReport> {
  const current = await period(tx, input, 'current');
  const previous = await period(tx, input, 'previous');

  const [open] = (await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM orders
    WHERE property_id = ${input.propertyId}
      AND status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY')
  `)).rows;

  const w = windowSql(input.window, 'current');
  const dishes = (await tx.execute<{ name: string; quantity: number; sales: number }>(sql`
    SELECT oi.name_snapshot AS name, sum(oi.quantity)::int AS quantity,
           sum(oi.line_total_minor)::int AS sales
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.property_id = ${input.propertyId}
      AND o.placed_at >= ${w.start} AND o.placed_at < ${w.end}
      AND o.status NOT IN ('DRAFT', 'REJECTED', 'CANCELLED')
    GROUP BY oi.name_snapshot
    ORDER BY quantity DESC, sales DESC, name
    LIMIT 3
  `)).rows;

  return {
    currency: input.currency,
    current,
    previous,
    openNow: Number(open?.n ?? 0),
    topDishes: dishes.map((d) => ({ name: d.name, quantity: Number(d.quantity), salesMinor: Number(d.sales) })),
  };
}
