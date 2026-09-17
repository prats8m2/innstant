import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import {
  can, findProperty, listFloors, listRoomsAtProperty, listRoomTypesWithUse,
  currencyIsStillOpen,
} from '@/modules/identity';
import { offeredTimezones } from '@/lib/timezones';
import { AdminShell } from '../admin-shell';
import {
  PropertyEditor,
  type FloorView, type RoomSetupView, type RoomTypeSetupView, type SettingsView,
} from './property-editor';
import styles from '../admin.module.css';

/**
 * The property — what the hotel is called, what it is made of, and what a room
 * can be.
 *
 * `provisionProperty()` has created these in one transaction since P0 and was
 * the only thing that ever did, so a hotel that opened a floor had a seeder run
 * and a wiped property as its only route. `room:manage` has been a declared
 * permission with no caller since S5 (P3.5).
 *
 * ─── Why this is not the front desk's Rooms screen ─────────────────────────
 *
 * `/admin/rooms` is about the DAY: who is in 214, what they owe, check them out.
 * This is about the building, which changes a few times a year. The menu editor
 * folds sections and dishes into one screen because an F&B manager arrives
 * asking "where is this dish and what does it cost" — a front desk never arrives
 * asking "how many floors are there", and putting a delete-floor control in
 * their way all day would be the wrong trade.
 */
export const dynamic = 'force-dynamic';

export default async function PropertyAdmin() {
  // `room:read` to look; every control below needs `room:manage`, which the
  // front desk does not hold.
  const access = await adminAccess('room:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const { property, floors, rooms, roomTypes, currencyOpen } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      floors: await listFloors(tx, propertyId),
      // Archived ones too: this is the only screen a room comes back from, and
      // a room you cannot see is a room you cannot restore.
      rooms: await listRoomsAtProperty(tx, { propertyId, includeArchived: true }),
      // Retired ones too, and how many rooms are each: this is the only screen
      // a type comes back from, and Retire refuses on exactly that count.
      roomTypes: await listRoomTypesWithUse(tx, { propertyId }),
      // The same query the save guard runs, so the hint and the refusal cannot
      // disagree.
      currencyOpen: await currencyIsStillOpen(tx, propertyId),
    }),
  );

  const roomViews: RoomSetupView[] = rooms.map((room) => ({
    id: room.id,
    number: room.number,
    floorId: room.floorId,
    roomTypeId: room.roomTypeId,
    roomTypeName: room.roomTypeName,
    archived: room.archivedAt != null,
  }));

  const floorViews: FloorView[] = floors.map((floor) => ({
    id: floor.id,
    name: floor.name,
    level: floor.level,
    // Including out-of-service ones: they still hold the floor by FK, and the
    // delete control refuses on exactly this count.
    roomCount: roomViews.filter((room) => room.floorId === floor.id).length,
  }));

  const typeViews: RoomTypeSetupView[] = roomTypes.map((type) => ({
    id: type.id,
    name: type.name,
    code: type.code,
    maxOccupancy: type.maxOccupancy,
    roomCount: type.roomCount,
    archived: type.archivedAt != null,
  }));

  const inService = roomViews.filter((room) => !room.archived).length;
  const offeredTypes = typeViews.filter((type) => !type.archived).length;

  const settings: SettingsView = {
    name: property?.name ?? '',
    timezone: property?.timezone ?? 'Asia/Kolkata',
    currency: property?.currency ?? 'INR',
    currencyStillOpen: currencyOpen,
  };

  /**
   * Every zone the runtime knows, PLUS the one this property is already on —
   * which is not always in that list, and whose absence silently rewrote the
   * hotel's clock. See `offeredTimezones()`; it is the whole story.
   */
  const timezones = offeredTimezones(settings.timezone);

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
      current="property"
    >
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>The property</h1>
          <p className={styles.lede}>
            {floorViews.length} {floorViews.length === 1 ? 'floor' : 'floors'} ·{' '}
            {inService} {inService === 1 ? 'room' : 'rooms'} in service
            {roomViews.length > inService
              ? ` · ${roomViews.length - inService} out of service`
              : ''}
            {' · '}
            {offeredTypes} {offeredTypes === 1 ? 'room type' : 'room types'}
          </p>
        </div>
      </header>

      <PropertyEditor
        propertyId={propertyId}
        settings={settings}
        timezones={timezones}
        mayEditSettings={can(session, propertyId, 'property:update')}
        floors={floorViews}
        rooms={roomViews}
        roomTypes={typeViews}
        mayManage={can(session, propertyId, 'room:manage')}
      />

      <p className={styles.footnote}>
        A room added here gets its own QR code straight away — the link is on the
        Rooms screen, next to the room. Taking one out of service kills its
        sticker; bringing it back issues a new one, because the old sticker has
        been out of a guest&rsquo;s hands in the meantime.
      </p>
    </AdminShell>
  );
}
