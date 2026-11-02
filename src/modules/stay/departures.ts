import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { stays, guests } from '@/db/schema/stay';
import { listRoomsAtProperty } from '@/modules/identity';
import { folioBalancesForStays } from '@/modules/billing';
import type { CurrencyCode } from '@/lib/money';

export interface Departure {
  stayId: string;
  guestId: string;
  guestName: string;
  guestPhone: string | null;
  roomId: string;
  roomNumber: string;
  floorName: string;
  scheduledCheckoutAt: Date;
  /** Set once they have gone. */
  checkedOutAt: Date | null;
  /** Null when nothing was ever charged — not the same as zero. */
  balanceMinor: number | null;
  currency: CurrencyCode;
}

/**
 * Today's departures, property-local (D-094): who is due out, and who has gone.
 *
 *   due    still CHECKED_IN, with a checkout time before tomorrow — which
 *          includes anybody whose time has already passed (overdue: they are
 *          still in the room, and it is the row a desk most needs to see)
 *   left   CHECKED_OUT since midnight, with what was still on the folio
 *
 * "Today" is the property's day, not the server's (CLAUDE.md, Dates). Ordered
 * the way a desk works them: earliest checkout first, most recent departure
 * first.
 *
 * Rooms come from `identity` and balances from `billing` through their own
 * service functions — three reads assembled here rather than one join across
 * three modules' tables (D-001), as `listRoomsWithOccupancy` does.
 */
export async function listDeparturesToday(
  tx: Tx,
  input: { propertyId: string; timeZone: string },
): Promise<{ due: Departure[]; left: Departure[] }> {
  const tz = input.timeZone;
  const todayStart = sql<Date>`(date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
  const tomorrowStart = sql<Date>`((date_trunc('day', now() AT TIME ZONE ${tz}) + interval '1 day') AT TIME ZONE ${tz})`;

  const columns = {
    stayId: stays.id,
    roomId: stays.roomId,
    guestId: stays.guestId,
    guestName: guests.fullName,
    guestPhone: guests.phone,
    scheduledCheckoutAt: stays.scheduledCheckoutAt,
    checkedOutAt: stays.checkedOutAt,
  };

  const due = await tx.select(columns).from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .where(and(
      eq(stays.propertyId, input.propertyId),
      eq(stays.status, 'CHECKED_IN'),
      lt(stays.scheduledCheckoutAt, tomorrowStart),
    ))
    .orderBy(stays.scheduledCheckoutAt);

  const left = await tx.select(columns).from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .where(and(
      eq(stays.propertyId, input.propertyId),
      eq(stays.status, 'CHECKED_OUT'),
      gte(stays.checkedOutAt, todayStart),
    ))
    .orderBy(sql`${stays.checkedOutAt} DESC`);

  const rooms = new Map(
    (await listRoomsAtProperty(tx, { propertyId: input.propertyId, includeArchived: true }))
      .map((room) => [room.id, room]),
  );
  const balances = await folioBalancesForStays(tx, {
    stayIds: [...due, ...left].map((row) => row.stayId),
  });

  const shape = (row: (typeof due)[number]): Departure => {
    const room = rooms.get(row.roomId);
    const folio = balances.get(row.stayId);
    return {
      ...row,
      roomNumber: room?.number ?? '—',
      floorName: room?.floorName ?? '',
      balanceMinor: folio ? folio.balanceMinor : null,
      currency: (folio?.currency ?? 'INR') as CurrencyCode,
    };
  };

  return { due: due.map(shape), left: left.map(shape) };
}
