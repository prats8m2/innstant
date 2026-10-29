import Link from 'next/link';
import {
  BedDouble, Building2, Clock, Info, Layers, Palette, type LucideIcon,
} from 'lucide-react';
import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import {
  can, findProperty, listFloors, listRoomsAtProperty, listRoomTypesWithUse,
  currencyIsStillOpen, getPropertyProfile, type Permission, type StaffSession,
} from '@/modules/identity';
import {
  getInRoomDiningOutlet, getOutletSettings, outletOpenState, describeOpenState,
} from '@/modules/catalog';
import { localTimeAt, formatClock } from '@/lib/clock';
import { offeredTimezones } from '@/lib/timezones';
import {
  PropertyEditor,
  type FloorView, type RoomSetupView, type RoomTypeSetupView, type SettingsView,
} from './property-editor';
import { BrandingEditor } from './branding-editor';
import { GuestInfoForm } from './guest-info-form';
import { OutletSettingsForm } from './service-forms';
import { HoursEditor } from './hours-editor';
import { SettingsNavFocus } from './settings-nav-focus';
import styles from '../admin.module.css';
import s from './settings.module.css';

/**
 * The property — everything about the hotel that changes a few times a year:
 * what it is called, how it looks to a guest, what a guest is told, when the
 * kitchen is open, and what the building is made of.
 *
 * ─── D-087: tabs became a settings page ────────────────────────────────────
 *
 * Three tabs across the top held the hotel's name, its room types and its
 * floors. Branding, the guest's contact card and the kitchen's hours (which
 * lived on their own page, "The kitchen") made six, and six tabs across a
 * 1,100px column is a row of words nobody reads. So: a list down the side,
 * each entry saying what it holds, and on a phone the same list as a strip
 * that scrolls.
 *
 * The switch is still `?tab=` — rendered as links, so it survives a reload and
 * can be sent to somebody (D-061) — and each section asks for its OWN
 * permission. The page asks only for `property:read`, which every office role
 * holds; a front desk sees floors and rooms, an F&B manager sees the kitchen's
 * hours, and neither sees a section that would only refuse them.
 *
 * ─── Why this is not the front desk's Rooms screen ─────────────────────────
 *
 * `/admin/rooms` is about the DAY: who is in 214, what they owe. This is about
 * the building, which changes a few times a year, and putting a delete-floor
 * control in a desk's way all day would be the wrong trade.
 */
export const dynamic = 'force-dynamic';

interface SectionDef {
  key: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
  /** To SEE the section. Each form inside asks again for what it changes. */
  needs: Permission;
}

/** In the order a hotel sets itself up. */
const SECTIONS: readonly SectionDef[] = [
  { key: 'hotel', label: 'General', blurb: 'Name, clock and currency', icon: Building2, needs: 'property:read' },
  { key: 'branding', label: 'Branding', blurb: 'Accent, logo and cover', icon: Palette, needs: 'property:read' },
  { key: 'guest', label: 'Guest info', blurb: 'Contact, times and Wi-Fi', icon: Info, needs: 'property:read' },
  { key: 'service', label: 'Hours & service', blurb: 'Kitchen hours and charges', icon: Clock, needs: 'catalog:manage' },
  { key: 'types', label: 'Room types', blurb: 'What a room can be', icon: BedDouble, needs: 'room:read' },
  { key: 'rooms', label: 'Floors & rooms', blurb: 'The building', icon: Layers, needs: 'room:read' },
];

export default async function PropertyAdmin({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await adminAccess('property:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const visible = SECTIONS.filter((section) => can(session, propertyId, section.needs));
  const requested = (await searchParams).tab;
  const section = visible.find((v) => v.key === requested) ?? visible[0]!;

  const { property, roomsInService, floorCount } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const rooms = can(session, propertyId, 'room:read')
        ? await listRoomsAtProperty(tx, { propertyId })
        : [];
      return {
        property: await findProperty(tx, propertyId),
        roomsInService: rooms.length,
        floorCount: can(session, propertyId, 'room:read') ? (await listFloors(tx, propertyId)).length : 0,
      };
    },
  );

  const lede = [
    property?.city,
    floorCount ? `${floorCount} ${floorCount === 1 ? 'floor' : 'floors'}` : null,
    roomsInService ? `${roomsInService} ${roomsInService === 1 ? 'room' : 'rooms'} in service` : null,
  ].filter(Boolean).join(' · ');

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>{property?.name ?? 'The property'}</h1>
          {lede ? <p className={styles.lede}>{lede}</p> : null}
        </div>
      </header>

      <div className={s.layout}>
        <nav className={s.nav} aria-label="Property settings">
          <ul className={s.navList} id="property-sections">
            {visible.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.key}>
                  <Link
                    href={item.key === 'hotel' ? '/admin/property' : `/admin/property?tab=${item.key}`}
                    className={s.navItem}
                    aria-current={item.key === section.key ? 'page' : undefined}
                    scroll={false}
                  >
                    <Icon className={s.navIcon} size={18} strokeWidth={1.75} aria-hidden="true" />
                    <span className={s.navText}>
                      <span className={s.navLabel}>{item.label}</span>
                      <span className={s.navBlurb}>{item.blurb}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <SettingsNavFocus listId="property-sections" />
        </nav>

        <div className={s.content}>
          <Section session={session} propertyId={propertyId} tab={section.key} />
        </div>
      </div>
    </>
  );
}

async function Section({
  session,
  propertyId,
  tab,
}: {
  session: StaffSession;
  propertyId: string;
  tab: string;
}) {
  if (tab === 'branding') return <BrandingSection session={session} propertyId={propertyId} />;
  if (tab === 'guest') return <GuestSection session={session} propertyId={propertyId} />;
  if (tab === 'service') return <ServiceSection session={session} propertyId={propertyId} />;
  return <BuildingSection session={session} propertyId={propertyId} tab={tab as 'hotel' | 'types' | 'rooms'} />;
}

async function BrandingSection({ session, propertyId }: { session: StaffSession; propertyId: string }) {
  const profile = await withTenant(
    { tenantId: session.tenantId, propertyId },
    (tx) => getPropertyProfile(tx, propertyId),
  );
  if (!profile) return null;
  return (
    <BrandingEditor
      propertyId={propertyId}
      propertyName={profile.name}
      branding={profile.branding}
      mayEdit={can(session, propertyId, 'property:branding')}
    />
  );
}

async function GuestSection({ session, propertyId }: { session: StaffSession; propertyId: string }) {
  const profile = await withTenant(
    { tenantId: session.tenantId, propertyId },
    (tx) => getPropertyProfile(tx, propertyId),
  );
  if (!profile) return null;
  return (
    <GuestInfoForm
      propertyId={propertyId}
      info={profile.guestInfo}
      branding={profile.branding}
      mayEdit={can(session, propertyId, 'property:update')}
    />
  );
}

async function ServiceSection({ session, propertyId }: { session: StaffSession; propertyId: string }) {
  const { property, outlet } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const found = await getInRoomDiningOutlet(tx, propertyId);
      return {
        property: await findProperty(tx, propertyId),
        outlet: found ? await getOutletSettings(tx, { propertyId, outletId: found.id }) : null,
      };
    },
  );

  if (!outlet) {
    return <p className={styles.empty}>No in-room dining outlet is configured here.</p>;
  }

  // Exactly what a guest would read right now, on the same logic they get.
  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const state = outletOpenState(outlet.hours, localTimeAt(new Date(), timeZone));
  const guestLine = describeOpenState(state, formatClock);
  const mayPrice = can(session, propertyId, 'catalog:pricing');

  return (
    <>
      <div className={s.statusStrip}>
        <span className={s.statusDot} data-on={state.isOpen && outlet.isAcceptingOrders} aria-hidden="true" />
        <p className={s.statusText}>
          A guest looking at the menu right now reads: <strong>{guestLine}</strong>
          {outlet.isAcceptingOrders ? null : (
            <>
              {' '}The kitchen is <strong>closed to orders</strong> by hand —{' '}
              <Link href="/admin/menu">open it from the menu</Link>.
            </>
          )}
        </p>
      </div>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>When the kitchen is open</h2>
          <p className={styles.sectionBlurb}>
            {outlet.name}, in the property&rsquo;s own clock. A day switched off is a day it does not open.
          </p>
        </header>
        <HoursEditor propertyId={propertyId} outletId={outlet.id} hours={outlet.hours} />
      </section>

      {mayPrice ? (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>What it charges</h2>
            <p className={styles.sectionBlurb}>
              Tax, service and delivery, and the promise a guest reads while they
              wait. A rate changed here never touches an order already placed.
            </p>
          </header>
          <OutletSettingsForm propertyId={propertyId} outlet={outlet} />
        </section>
      ) : null}
    </>
  );
}

async function BuildingSection({
  session,
  propertyId,
  tab,
}: {
  session: StaffSession;
  propertyId: string;
  tab: 'hotel' | 'types' | 'rooms';
}) {
  const mayReadRooms = can(session, propertyId, 'room:read');
  const { property, floors, rooms, roomTypes, currencyOpen } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      floors: mayReadRooms ? await listFloors(tx, propertyId) : [],
      // Archived ones too: this is the only screen a room comes back from, and
      // a room you cannot see is a room you cannot restore.
      rooms: mayReadRooms ? await listRoomsAtProperty(tx, { propertyId, includeArchived: true }) : [],
      // Retired ones too, and how many rooms are each: Retire refuses on that count.
      roomTypes: mayReadRooms ? await listRoomTypesWithUse(tx, { propertyId }) : [],
      // The same query the save guard runs, so the hint and the refusal agree.
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
    // Including out-of-service rooms: they still hold the floor by FK, and the
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

  const settings: SettingsView = {
    name: property?.name ?? '',
    timezone: property?.timezone ?? 'Asia/Kolkata',
    currency: property?.currency ?? 'INR',
    currencyStillOpen: currencyOpen,
  };

  return (
    <>
      <PropertyEditor
        propertyId={propertyId}
        settings={settings}
        /* Every zone the runtime knows, PLUS the one this property is already
           on — see `offeredTimezones()`; it is the whole story. */
        timezones={offeredTimezones(settings.timezone)}
        tab={tab}
        mayEditSettings={can(session, propertyId, 'property:update')}
        floors={floorViews}
        rooms={roomViews}
        roomTypes={typeViews}
        mayManage={can(session, propertyId, 'room:manage')}
      />
      {tab === 'rooms' ? (
        <p className={styles.footnote}>
          A room added here gets its own QR code straight away — the link is on the
          Rooms screen, next to the room. Taking one out of service kills its
          sticker; bringing it back issues a new one, because the old sticker has
          been out of a guest&rsquo;s hands in the meantime.
        </p>
      ) : null}
    </>
  );
}
