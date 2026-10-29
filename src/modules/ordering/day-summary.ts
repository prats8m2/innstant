import { sql } from 'drizzle-orm';
import type { Tx } from '@/db';

/**
 * How the day is going, for the console's overview.
 *
 * "Today" is the HOTEL's calendar day, in `properties.timezone` (CLAUDE.md
 * "Dates"), worked out in SQL with `AT TIME ZONE` so the server's own clock
 * and zone never enter it. Orders the kitchen rejected or that were
 * cancelled are not sales and are counted separately; a draft is not an
 * order at all.
 *
 * Yesterday is compared up to the SAME TIME OF DAY, not as a whole day: at
 * 10am, "₹4,200 today against ₹31,000 yesterday" reads as a disaster when
 * the honest comparison is ₹4,200 against yesterday's ₹3,900 by 10am.
 *
 * Read-only, one transaction's worth of small aggregate queries over the
 * ordering module's own tables (D-001).
 */

export interface DaySummary {
  currency: string;
  today: {
    orders: number;
    /** Order totals, including tax and service, of everything not rejected or cancelled. */
    salesMinor: number;
    averageOrderMinor: number;
    rejected: number;
    /** What offers took off the list prices today (D-085). */
    givenByOffersMinor: number;
    /** Orders that reached the guest today, and how many by their promise. */
    delivered: number;
    deliveredOnTime: number;
    /** Placed to delivered, for the orders delivered today. Null with none. */
    averageMinutesToDoor: number | null;
  };
  /** Yesterday up to this time of day. */
  yesterdaySoFar: { orders: number; salesMinor: number };
  /** Orders placed in each hotel-local hour, 0–23. */
  byHour: number[];
  byHourYesterday: number[];
  /** Today's dishes by quantity, from the receipt snapshots (#6). */
  topDishes: { name: string; quantity: number; salesMinor: number }[];
}

const SOLD = sql`status NOT IN ('DRAFT', 'REJECTED', 'CANCELLED')`;

export async function daySummary(
  tx: Tx,
  input: { propertyId: string; timeZone: string; currency: string },
): Promise<DaySummary> {
  const tz = input.timeZone;
  // Hotel-local midnight today and yesterday, as instants.
  const todayStart = sql`(date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
  const yesterdayStart = sql`(${todayStart} - interval '1 day')`;

  const [today] = (await tx.execute<{
    orders: number; sales: number; rejected: number;
    delivered: number; on_time: number; minutes: number | null;
  }>(sql`
    SELECT
      count(*) FILTER (WHERE ${SOLD})::int AS orders,
      coalesce(sum(total_minor) FILTER (WHERE ${SOLD} AND currency = ${input.currency}), 0)::int AS sales,
      count(*) FILTER (WHERE status IN ('REJECTED', 'CANCELLED'))::int AS rejected,
      count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS delivered,
      count(*) FILTER (WHERE delivered_at IS NOT NULL AND promised_by_at IS NOT NULL
                        AND delivered_at <= promised_by_at)::int AS on_time,
      round(avg(extract(epoch FROM delivered_at - placed_at) / 60)
            FILTER (WHERE delivered_at IS NOT NULL))::int AS minutes
    FROM orders
    WHERE property_id = ${input.propertyId} AND placed_at >= ${todayStart}
  `)).rows;

  const [yesterday] = (await tx.execute<{ orders: number; sales: number }>(sql`
    SELECT
      count(*) FILTER (WHERE ${SOLD})::int AS orders,
      coalesce(sum(total_minor) FILTER (WHERE ${SOLD} AND currency = ${input.currency}), 0)::int AS sales
    FROM orders
    WHERE property_id = ${input.propertyId}
      AND placed_at >= ${yesterdayStart}
      AND placed_at < now() - interval '1 day'
  `)).rows;

  const hours = (await tx.execute<{ day: string; hour: number; n: number }>(sql`
    SELECT
      CASE WHEN placed_at >= ${todayStart} THEN 'today' ELSE 'yesterday' END AS day,
      extract(hour FROM placed_at AT TIME ZONE ${tz})::int AS hour,
      count(*)::int AS n
    FROM orders
    WHERE property_id = ${input.propertyId} AND placed_at >= ${yesterdayStart} AND ${SOLD}
    GROUP BY 1, 2
  `)).rows;
  const byHour = Array.from({ length: 24 }, () => 0);
  const byHourYesterday = Array.from({ length: 24 }, () => 0);
  for (const row of hours) (row.day === 'today' ? byHour : byHourYesterday)[row.hour] = row.n;

  const dishes = (await tx.execute<{ name: string; quantity: number; sales: number }>(sql`
    SELECT oi.name_snapshot AS name, sum(oi.quantity)::int AS quantity,
           sum(oi.line_total_minor)::int AS sales
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.property_id = ${input.propertyId} AND o.placed_at >= ${todayStart}
      AND o.status NOT IN ('DRAFT', 'REJECTED', 'CANCELLED')
    GROUP BY oi.name_snapshot
    ORDER BY quantity DESC, sales DESC, name
    LIMIT 5
  `)).rows;

  const [offers] = (await tx.execute<{ given: number }>(sql`
    SELECT coalesce(sum((oi.list_price_minor - oi.unit_price_minor) * oi.quantity), 0)::int AS given
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.property_id = ${input.propertyId} AND o.placed_at >= ${todayStart}
      AND o.status NOT IN ('DRAFT', 'REJECTED', 'CANCELLED')
      AND oi.list_price_minor IS NOT NULL
  `)).rows;

  const orders = today?.orders ?? 0;
  const sales = today?.sales ?? 0;
  return {
    currency: input.currency,
    today: {
      orders,
      salesMinor: sales,
      averageOrderMinor: orders ? Math.round(sales / orders) : 0,
      rejected: today?.rejected ?? 0,
      givenByOffersMinor: offers?.given ?? 0,
      delivered: today?.delivered ?? 0,
      deliveredOnTime: today?.on_time ?? 0,
      averageMinutesToDoor: today?.minutes ?? null,
    },
    yesterdaySoFar: { orders: yesterday?.orders ?? 0, salesMinor: yesterday?.sales ?? 0 },
    byHour,
    byHourYesterday,
    topDishes: dishes.map((d) => ({ name: d.name, quantity: d.quantity, salesMinor: d.sales })),
  };
}

export interface StageTimes {
  /** Average minutes per stage, for orders that passed through it today.
   *  Null with nothing to average. */
  toAccept: number | null;
  inKitchen: number | null;
  atPass: number | null;
  toDoor: number | null;
  /** How many orders each average is over — a 40-minute average of one order
   *  is an anecdote, and the screen says so. */
  counts: { toAccept: number; inKitchen: number; atPass: number; toDoor: number };
}

/**
 * Where the time goes today, stage by stage (D-089, the console's Live floor):
 * placed → accepted (somebody noticed), accepted → ready (the kitchen),
 * ready → picked up (the pass), picked up → delivered (the corridor).
 *
 * From the stage timestamps on `orders`, which `advanceOrder()` writes in the
 * same transaction as each transition — so this is what happened, not what
 * the screen thought happened. The hotel's own day, as in `daySummary()`.
 */
export async function stageTimesToday(
  tx: Tx,
  input: { propertyId: string; timeZone: string },
): Promise<StageTimes> {
  const tz = input.timeZone;
  const todayStart = sql`(date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
  const minutes = (from: string, to: string) => sql.raw(
    `round(avg(extract(epoch FROM ${to} - ${from}) / 60) FILTER (WHERE ${from} IS NOT NULL AND ${to} IS NOT NULL AND ${to} >= ${from}))::int`,
  );
  const count = (from: string, to: string) => sql.raw(
    `count(*) FILTER (WHERE ${from} IS NOT NULL AND ${to} IS NOT NULL AND ${to} >= ${from})::int`,
  );

  const [row] = (await tx.execute<{
    to_accept: number | null; in_kitchen: number | null; at_pass: number | null; to_door: number | null;
    n_accept: number; n_kitchen: number; n_pass: number; n_door: number;
  }>(sql`
    SELECT
      ${minutes('placed_at', 'accepted_at')} AS to_accept,
      ${minutes('accepted_at', 'ready_at')} AS in_kitchen,
      ${minutes('ready_at', 'out_for_delivery_at')} AS at_pass,
      ${minutes('out_for_delivery_at', 'delivered_at')} AS to_door,
      ${count('placed_at', 'accepted_at')} AS n_accept,
      ${count('accepted_at', 'ready_at')} AS n_kitchen,
      ${count('ready_at', 'out_for_delivery_at')} AS n_pass,
      ${count('out_for_delivery_at', 'delivered_at')} AS n_door
    FROM orders
    WHERE property_id = ${input.propertyId} AND placed_at >= ${todayStart}
  `)).rows;

  return {
    toAccept: row?.to_accept ?? null,
    inKitchen: row?.in_kitchen ?? null,
    atPass: row?.at_pass ?? null,
    toDoor: row?.to_door ?? null,
    counts: {
      toAccept: row?.n_accept ?? 0,
      inKitchen: row?.n_kitchen ?? 0,
      atPass: row?.n_pass ?? 0,
      toDoor: row?.n_door ?? 0,
    },
  };
}
