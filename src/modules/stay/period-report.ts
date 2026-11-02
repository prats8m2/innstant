import { and, eq, gte, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { stays, guests, guestPropertyProfiles } from '@/db/schema/stay';
import { listRoomsAtProperty } from '@/modules/identity';
import { emptySeries, windowSql, type ReportWindow } from '@/lib/report-window';

/**
 * Rooms in house over a report period — the console overview's Occupancy.
 *
 * In house at an instant: a stay that was checked in at or before it and had
 * not checked out by it (`checked_in_at <= t AND (checked_out_at IS NULL OR
 * checked_out_at > t)`). Each bucket is sampled at its END — the hotel's
 * hour boundary today, local midnight for a day — and the bucket "now" is in
 * at now. A day's sample is therefore the night's occupancy, which is what a
 * hotel means by the word: a guest who left at 11am and another who arrived
 * at 2pm are one room that night, not two.
 *
 * The rooms it is divided by are the caller's (identity's live room count);
 * this module does not know which rooms existed last month, so the divisor is
 * today's sellable rooms for every bucket.
 *
 * Read-only, over this module's own table (D-001).
 */
export interface OccupancyReport {
  current: number[];
  previous: number[];
}

async function inHouse(
  tx: Tx,
  input: { propertyId: string; window: ReportWindow },
  which: 'current' | 'previous',
): Promise<number[]> {
  const w = windowSql(input.window, which);
  const rows = (await tx.execute<{ bucket: number; n: number }>(sql`
    WITH samples AS (
      SELECT i AS bucket, ${w.bucketEnd(sql`i`)} AS at
      FROM generate_series(0, ${input.window.buckets - 1}::int) AS i
    )
    SELECT s.bucket, count(st.id)::int AS n
    FROM samples s
    LEFT JOIN stays st
      ON st.property_id = ${input.propertyId}
     AND st.status IN ('CHECKED_IN', 'CHECKED_OUT')
     AND st.checked_in_at IS NOT NULL
     AND st.checked_in_at <= s.at
     AND (st.checked_out_at IS NULL OR st.checked_out_at > s.at)
    GROUP BY s.bucket
  `)).rows;
  const out = emptySeries(input.window);
  for (const row of rows) {
    const i = Number(row.bucket);
    if (i >= 0 && i < out.length) out[i] = Number(row.n);
  }
  return out;
}

export async function occupancyReport(
  tx: Tx,
  input: { propertyId: string; window: ReportWindow },
): Promise<OccupancyReport> {
  return {
    current: await inHouse(tx, input, 'current'),
    previous: await inHouse(tx, input, 'previous'),
  };
}

export interface Arrival {
  stayId: string;
  roomId: string;
  /** From identity, out-of-service rooms included — a room archived since
   *  is still the room they were in. */
  roomNumber: string;
  guestName: string;
  isVip: boolean;
  checkedInAt: Date;
  /** Still in the room, or already gone again. */
  status: 'CHECKED_IN' | 'CHECKED_OUT';
}

/**
 * Who arrived today, property-local: stays checked in since the hotel's
 * midnight. There is no reservation date in this product (booking is out of
 * scope), so "arriving" can only mean "has arrived" — nobody is listed before
 * the desk checks them in. Earliest first. The room NUMBER is identity's; the
 * caller maps `roomId`.
 */
export async function listArrivalsToday(
  tx: Tx,
  input: { propertyId: string; timeZone: string },
): Promise<Arrival[]> {
  const tz = input.timeZone;
  const todayStart = sql<Date>`(date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
  const rows = await tx.select({
    stayId: stays.id,
    roomId: stays.roomId,
    guestName: guests.fullName,
    isVip: guestPropertyProfiles.isVip,
    checkedInAt: stays.checkedInAt,
    status: stays.status,
  }).from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .leftJoin(guestPropertyProfiles, and(
      eq(guestPropertyProfiles.guestId, stays.guestId),
      eq(guestPropertyProfiles.propertyId, stays.propertyId),
    ))
    .where(and(
      eq(stays.propertyId, input.propertyId),
      gte(stays.checkedInAt, todayStart),
      sql`${stays.status} IN ('CHECKED_IN', 'CHECKED_OUT')`,
    ))
    .orderBy(stays.checkedInAt);

  if (!rows.length) return [];
  const rooms = new Map(
    (await listRoomsAtProperty(tx, { propertyId: input.propertyId, includeArchived: true }))
      .map((room) => [room.id, room.number]),
  );

  return rows.map((row) => ({
    stayId: row.stayId,
    roomId: row.roomId,
    roomNumber: rooms.get(row.roomId) ?? '—',
    guestName: row.guestName,
    isVip: row.isVip ?? false,
    checkedInAt: row.checkedInAt!,
    status: row.status as Arrival['status'],
  }));
}
