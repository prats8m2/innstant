import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty } from '@/modules/identity';
import { listRoomsWithOccupancy } from '@/modules/stay';
import { formatMoney, money } from '@/lib/money';
import { formatCheckoutDay, nightsUntil } from '@/lib/clock';
import { AdminShell } from '../admin-shell';
import { RoomBoard, type RoomView } from './room-board';
import styles from '../admin.module.css';

/**
 * The front desk: every room, who is in it, and the two buttons that change
 * that.
 *
 * `createStay()` has been the only door a stay can be born through since P0
 * (#4) and its only callers were the seeder and the integration tests — so
 * check-in happened wherever it happened, and `stay:check_in` was a permission
 * nothing used. Check-OUT did not exist at all: `stay_status` has had
 * CHECKED_OUT since 0000 and nothing ever set it, which meant #10's promise
 * that "session tokens are revoked at checkout" held only because no checkout
 * had ever happened.
 *
 * Grouped by floor, in key-rack order. A desk reads down a list of rooms, not
 * across a table of stays.
 */
export const dynamic = 'force-dynamic';

export default async function RoomsAdmin() {
  const access = await adminAccess('stay:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, occupancy } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      occupancy: await listRoomsWithOccupancy(tx, { propertyId }),
    }),
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const now = new Date();

  const rooms: RoomView[] = occupancy.map((room) => ({
    id: room.id,
    number: room.number,
    floorName: room.floorName,
    roomTypeName: room.roomTypeName,
    stay: room.stay
      ? {
        id: room.stay.id,
        guestId: room.stay.guestId,
        guestName: room.stay.guestName,
        guestPhone: room.stay.guestPhone,
        dueOut: formatCheckoutDay(room.stay.scheduledCheckoutAt, timeZone),
        // Zero means today, which is the number a desk is actually working from.
        nightsLeft: nightsUntil(now, room.stay.scheduledCheckoutAt, timeZone),
        // Null is "nothing has ever been charged", which is not the same as ₹0
        // and must not read as it.
        balance: room.stay.balanceMinor === null
          ? null
          : formatMoney(money(room.stay.balanceMinor, room.stay.currency)),
        owes: (room.stay.balanceMinor ?? 0) > 0,
      }
      : null,
  }));

  const occupied = rooms.filter((room) => room.stay).length;
  const dueOutToday = rooms.filter((room) => room.stay?.nightsLeft === 0).length;

  // The hours a desk actually picks between, offered rather than hardcoded into
  // the action — there is no property-level standard checkout hour in the
  // schema, and inventing one in a form would be a business value in the wrong
  // place.
  const checkoutHours = [10, 11, 12, 14];

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
      current="rooms"
    >
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Rooms</h1>
          <p className={styles.lede}>
            {occupied} of {rooms.length} occupied
            {dueOutToday > 0 ? ` · ${dueOutToday} out today` : ''}
          </p>
        </div>
      </header>

      <RoomBoard
        propertyId={propertyId}
        rooms={rooms}
        checkoutHours={checkoutHours}
        permissions={{
          checkIn: can(session, propertyId, 'stay:check_in'),
          checkOut: can(session, propertyId, 'stay:check_out'),
          vouch: can(session, propertyId, 'guest:vouch'),
        }}
      />

      <p className={styles.footnote}>
        Checking someone out frees the room, ends every session on their phone
        (#10) and records what was still on the folio at the moment they left.
        It does not take the money — settlement is still the card machine, and
        the balance stays on the bill until it is.
      </p>
    </AdminShell>
  );
}
