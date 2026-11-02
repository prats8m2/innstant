import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { stays, guests, guestPropertyProfiles } from '@/db/schema/stay';
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

export interface StayAtDesk {
  id: string;
  status: string;
  guestId: string;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  roomId: string;
  roomNumber: string;
  floorName: string;
  roomTypeName: string | null;
  adults: number;
  children: number;
  checkedInAt: Date | null;
  scheduledCheckoutAt: Date;
  checkedOutAt: Date | null;
  /** From this property's profile of the guest — absent means not set. */
  isVip: boolean;
  staffNotes: string | null;
}

/**
 * One stay as the checkout screen and the invoice need it (D-095): who, which
 * room, when they came and are going, and what this property has noted about
 * them. Scoped to the property, so a stay id from a sister property is not
 * found rather than shown.
 */
export async function getStayAtDesk(
  tx: Tx,
  input: { propertyId: string; stayId: string },
): Promise<StayAtDesk | null> {
  const [row] = await tx.select({
    id: stays.id,
    status: stays.status,
    roomId: stays.roomId,
    guestId: stays.guestId,
    guestName: guests.fullName,
    guestPhone: guests.phone,
    guestEmail: guests.email,
    adults: stays.adults,
    children: stays.children,
    checkedInAt: stays.checkedInAt,
    scheduledCheckoutAt: stays.scheduledCheckoutAt,
    checkedOutAt: stays.checkedOutAt,
    isVip: guestPropertyProfiles.isVip,
    staffNotes: guestPropertyProfiles.staffNotes,
  }).from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .leftJoin(guestPropertyProfiles, and(
      eq(guestPropertyProfiles.guestId, stays.guestId),
      eq(guestPropertyProfiles.propertyId, stays.propertyId),
    ))
    .where(and(eq(stays.id, input.stayId), eq(stays.propertyId, input.propertyId)))
    .limit(1);
  if (!row) return null;

  const room = (await listRoomsAtProperty(tx, { propertyId: input.propertyId, includeArchived: true }))
    .find((r) => r.id === row.roomId);

  return {
    ...row,
    roomNumber: room?.number ?? '—',
    floorName: room?.floorName ?? '',
    roomTypeName: room?.roomTypeName ?? null,
    isVip: row.isVip ?? false,
    staffNotes: row.staffNotes ?? null,
  };
}

export interface UnpaidDeparture {
  stayId: string;
  guestId: string;
  guestName: string;
  guestPhone: string | null;
  roomNumber: string;
  checkedOutAt: Date;
  balanceMinor: number;
  currency: CurrencyCode;
  /** What the manager who let them go said (D-095), when they said it. */
  reason: string | null;
}

/**
 * Guests who left with money still on the bill (D-097): the follow-up list.
 *
 * Every checked-out stay in the window whose folio still has a positive
 * balance, oldest first — the longer it has been, the harder it is to
 * collect — with the reason recorded on the departure.
 */
export async function listUnpaidDepartures(
  tx: Tx,
  input: { propertyId: string; withinDays?: number },
): Promise<UnpaidDeparture[]> {
  const days = input.withinDays ?? 90;
  const gone = await tx.select({
    stayId: stays.id,
    roomId: stays.roomId,
    guestId: stays.guestId,
    guestName: guests.fullName,
    guestPhone: guests.phone,
    checkedOutAt: stays.checkedOutAt,
  }).from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .where(and(
      eq(stays.propertyId, input.propertyId),
      eq(stays.status, 'CHECKED_OUT'),
      gte(stays.checkedOutAt, sql<Date>`now() - make_interval(days => ${days})`),
    ))
    .orderBy(stays.checkedOutAt);
  if (!gone.length) return [];

  const balances = await folioBalancesForStays(tx, { stayIds: gone.map((g) => g.stayId) });
  const owing = gone.filter((g) => (balances.get(g.stayId)?.balanceMinor ?? 0) > 0);
  if (!owing.length) return [];

  // The reason is on the departure's event, beside the balance it explains.
  const reasons = await tx.execute<{ entity_id: string; reason: string | null }>(sql`
    SELECT DISTINCT ON (entity_id) entity_id, payload->>'unpaidReason' AS reason
    FROM event_log
    WHERE property_id = ${input.propertyId}
      AND entity_type = 'stay' AND event_type = 'stay.checked_out'
      AND entity_id IN (${sql.join(owing.map((o) => sql`${o.stayId}::uuid`), sql`, `)})
    ORDER BY entity_id, occurred_at DESC
  `);
  const reasonOf = new Map(reasons.rows.map((r) => [r.entity_id, r.reason]));
  const rooms = new Map(
    (await listRoomsAtProperty(tx, { propertyId: input.propertyId, includeArchived: true })).map((r) => [r.id, r.number]),
  );

  return owing.map((o) => {
    const folio = balances.get(o.stayId)!;
    return {
      stayId: o.stayId,
      guestId: o.guestId,
      guestName: o.guestName,
      guestPhone: o.guestPhone,
      roomNumber: rooms.get(o.roomId) ?? '—',
      checkedOutAt: o.checkedOutAt!,
      balanceMinor: folio.balanceMinor,
      currency: folio.currency as CurrencyCode,
      reason: reasonOf.get(o.stayId) ?? null,
    };
  });
}
