import { and, eq } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { stays, guests, checkoutRequests } from '@/db/schema/stay';
import { listRoomsAtProperty, type RoomListing } from '@/modules/identity';
import { folioBalancesForStays } from '@/modules/billing';
import { revokeSessionsForStay } from '@/modules/access';
import { ConflictError, NotFoundError } from '@/lib/errors';
import type { CurrencyCode } from '@/lib/money';

/**
 * The front desk's view of the property, and the end of a stay.
 *
 * Check-IN is not here: it is `createStay()`, which is the only place a stay is
 * born (#4) and already takes a staff actor. The desk is its second caller after
 * the seeder, which is exactly what that function was written for.
 *
 * Check-OUT is here, and it did not exist at all until now — `stay_status` has
 * had CHECKED_OUT since 0000 and nothing ever set it. Which means
 * `revokeSessionsForStay()` had one caller, a test, and #10's promise that
 * "session tokens are revoked at checkout" was true only because no checkout
 * had ever happened.
 */

export interface RoomOccupancy extends RoomListing {
  stay: {
    id: string;
    guestId: string;
    guestName: string;
    guestPhone: string | null;
    checkedInAt: Date | null;
    scheduledCheckoutAt: Date;
    /** Absent when nothing has ever been charged — not the same as zero. */
    balanceMinor: number | null;
    currency: CurrencyCode;
  } | null;
}

/**
 * Every room, and who is in it.
 *
 * Three queries assembled in memory rather than one join across three modules'
 * tables. `identity` owns rooms, this module owns stays and guests, `billing`
 * owns folios, and a single SELECT touching all three would be the boundary
 * (D-001) leaking out through the one screen that happens to need everything.
 * Thirty-four rooms is three round trips either way.
 */
export async function listRoomsWithOccupancy(
  tx: Tx,
  input: { propertyId: string },
): Promise<RoomOccupancy[]> {
  const rooms = await listRoomsAtProperty(tx, { propertyId: input.propertyId });

  const active = await tx.select({
    id: stays.id,
    roomId: stays.roomId,
    guestId: stays.guestId,
    guestName: guests.fullName,
    guestPhone: guests.phone,
    checkedInAt: stays.checkedInAt,
    scheduledCheckoutAt: stays.scheduledCheckoutAt,
  }).from(stays)
    .innerJoin(guests, eq(guests.id, stays.guestId))
    .where(and(
      eq(stays.propertyId, input.propertyId),
      eq(stays.status, 'CHECKED_IN'),
    ));

  const balances = await folioBalancesForStays(tx, { stayIds: active.map((s) => s.id) });
  const byRoom = new Map(active.map((stay) => [stay.roomId, stay]));

  return rooms.map((room) => {
    const stay = byRoom.get(room.id);
    if (!stay) return { ...room, stay: null };
    const folio = balances.get(stay.id);
    return {
      ...room,
      stay: {
        id: stay.id,
        guestId: stay.guestId,
        guestName: stay.guestName,
        guestPhone: stay.guestPhone,
        checkedInAt: stay.checkedInAt,
        scheduledCheckoutAt: stay.scheduledCheckoutAt,
        balanceMinor: folio ? folio.balanceMinor : null,
        currency: (folio?.currency ?? 'INR') as CurrencyCode,
      },
    };
  });
}

export interface CheckOutResult {
  stayId: string;
  /** What was still owed when they walked. Recorded on the event. */
  balanceMinor: number;
  currency: CurrencyCode;
  sessionsRevoked: number;
  /** An approved late checkout that this completes, if there was one. */
  completedCheckoutRequests: number;
  /** A request still waiting on the desk, cancelled because nobody will now. */
  cancelledCheckoutRequests: number;
}

/**
 * The guest has gone.
 *
 * Four things, in one transaction:
 *
 *   1. The stay becomes CHECKED_OUT, which frees the room — D-007's partial
 *      unique index only counts CHECKED_IN, so the next arrival can be put in
 *      214 the moment this commits.
 *   2. Every guest session for the stay is revoked (#10). Sessions bind to
 *      `stay_id` precisely so this is possible: the QR sticker on the nightstand
 *      is unchanged and still public, and the phone that scanned it this morning
 *      stops being able to order to the room this afternoon.
 *   3. An APPROVED late checkout becomes COMPLETED, which is the only way that
 *      state was ever going to be reached, and a REQUESTED one is cancelled —
 *      nobody is going to decide it now.
 *   4. `event_log` records the BALANCE at the moment they left.
 *
 * ─── Why an unpaid balance does not block this ─────────────────────────────
 *
 * It would in a hotel that could take the money. This product cannot yet —
 * settlement is a later P3 bullet and `postFolioLine()` deliberately cannot even
 * post a PAYMENT — so the desk settles by card machine or cash and then records
 * the departure here. Refusing would make the feature unusable and teach the
 * desk to work around it, which is worse than an honest number on a screen.
 *
 * The balance goes on the EVENT rather than being silently dropped, so "they
 * left owing ₹13,180 and the desk checked them out at 11:04" is answerable
 * later. The screen shows it and makes the desk look at it; the audit trail is
 * what makes it real.
 */
export async function checkOutStay(
  tx: Tx,
  input: {
    tenantId: string;
    propertyId: string;
    stayId: string;
    staffUserId: string;
    now?: Date;
  },
): Promise<CheckOutResult> {
  const now = input.now ?? new Date();

  const rows = await tx.select({
    id: stays.id,
    status: stays.status,
    roomId: stays.roomId,
  }).from(stays)
    .where(and(eq(stays.id, input.stayId), eq(stays.propertyId, input.propertyId)))
    .limit(1);

  const stay = rows[0];
  if (!stay) throw new NotFoundError('No such stay at this property.');

  /**
   * Compare-and-set, not a plain UPDATE. Two people at the desk pressing check
   * out on the same room in the same second would otherwise both revoke the
   * sessions and both write an event, and the second one's balance would read
   * as a separate departure.
   */
  const updated = await tx.update(stays)
    .set({ status: 'CHECKED_OUT', checkedOutAt: now, updatedAt: now })
    .where(and(eq(stays.id, stay.id), eq(stays.status, 'CHECKED_IN')))
    .returning({ id: stays.id });

  if (!updated[0]) {
    throw new ConflictError(
      stay.status === 'CHECKED_OUT'
        ? 'That guest is already checked out.'
        : `A ${stay.status.toLowerCase().replace(/_/g, ' ')} stay cannot be checked out.`,
    );
  }

  const balances = await folioBalancesForStays(tx, { stayIds: [stay.id] });
  const folio = balances.get(stay.id);
  const balanceMinor = folio?.balanceMinor ?? 0;
  const currency = (folio?.currency ?? 'INR') as CurrencyCode;

  // #10. The sticker stays on the nightstand and stays public; what stops
  // working is every session that was ever issued against this stay.
  const sessionsRevoked = await revokeSessionsForStay(tx, stay.id);

  const completed = await tx.update(checkoutRequests)
    .set({ status: 'COMPLETED', updatedAt: now })
    .where(and(
      eq(checkoutRequests.stayId, stay.id),
      eq(checkoutRequests.status, 'APPROVED'),
    ))
    .returning({ id: checkoutRequests.id });

  // Nobody is going to answer these now. Left REQUESTED they would sit on the
  // desk's queue for a room that is already being cleaned.
  const cancelled = await tx.update(checkoutRequests)
    .set({ status: 'CANCELLED', updatedAt: now })
    .where(and(
      eq(checkoutRequests.stayId, stay.id),
      eq(checkoutRequests.status, 'REQUESTED'),
    ))
    .returning({ id: checkoutRequests.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'stay',
    entityId: stay.id,
    eventType: 'stay.checked_out',
    fromStatus: 'CHECKED_IN',
    toStatus: 'CHECKED_OUT',
    actor: { kind: 'STAFF', staffUserId: input.staffUserId },
    payload: {
      // The number that matters later, recorded at the moment it stopped being
      // collectable at the desk.
      balanceMinor,
      currency,
      sessionsRevoked,
      completedCheckoutRequests: completed.length,
      cancelledCheckoutRequests: cancelled.length,
    },
  });

  return {
    stayId: stay.id,
    balanceMinor,
    currency,
    sessionsRevoked,
    completedCheckoutRequests: completed.length,
    cancelledCheckoutRequests: cancelled.length,
  };
}
