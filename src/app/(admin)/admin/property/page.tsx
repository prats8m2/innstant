import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import {
  can, findProperty, listFloors, listRoomsAtProperty, listRoomTypes,
} from '@/modules/identity';
import { AdminShell } from '../admin-shell';
import { PropertyEditor, type FloorView, type RoomSetupView } from './property-editor';
import styles from '../admin.module.css';

/**
 * The building — floors, and the rooms on them.
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

  const { property, floors, rooms, roomTypes } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      floors: await listFloors(tx, propertyId),
      // Archived ones too: this is the only screen a room comes back from, and
      // a room you cannot see is a room you cannot restore.
      rooms: await listRoomsAtProperty(tx, { propertyId, includeArchived: true }),
      roomTypes: await listRoomTypes(tx, { propertyId }),
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

  const inService = roomViews.filter((room) => !room.archived).length;

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
      current="property"
    >
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>The building</h1>
          <p className={styles.lede}>
            {floorViews.length} {floorViews.length === 1 ? 'floor' : 'floors'} ·{' '}
            {inService} {inService === 1 ? 'room' : 'rooms'} in service
            {roomViews.length > inService
              ? ` · ${roomViews.length - inService} out of service`
              : ''}
          </p>
        </div>
      </header>

      <PropertyEditor
        propertyId={propertyId}
        floors={floorViews}
        rooms={roomViews}
        roomTypes={roomTypes.map((type) => ({ id: type.id, name: type.name }))}
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
