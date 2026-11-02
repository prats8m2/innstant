import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty } from '@/modules/identity';
import { listRoomsWithOccupancy } from '@/modules/stay';
import { roomCleanStates, cleanStateOf } from '@/modules/housekeeping';
import { getRequestCatalog } from '@/modules/requests';
import { formatMoney, money } from '@/lib/money';
import { formatCheckoutShort, localTimeAt, nightsUntil } from '@/lib/clock';
import { SidePanel } from '../side-panel';
import { RoomGrid, RoomPanel, type RoomView } from './room-board';
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
 * Grouped by floor, in key-rack order, as a grid of tiles; a room's actions
 * open in a side panel at `?room=<number>` (D-094).
 */
export const dynamic = 'force-dynamic';

/**
 * Which rooms the rack shows. Links with `?show=`, like the desk's views
 * (D-061): the choice survives a reload and can be sent to somebody. All is
 * the default, because the rack is the one screen that lists every key.
 */
const SHOWS = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'In house' },
  { key: 'out', label: 'Out today' },
  // D-096: what the desk can sell, and what housekeeping has to do.
  { key: 'ready', label: 'Ready to sell' },
  { key: 'dirty', label: 'To make up' },
  { key: 'ooo', label: 'Out of order' },
] as const;
type Show = (typeof SHOWS)[number]['key'];

export default async function RoomsAdmin({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; room?: string }>;
}) {
  const params = await searchParams;
  const requested = params.show;
  const show: Show = SHOWS.some((s) => s.key === requested) ? (requested as Show) : 'all';
  const access = await adminAccess('stay:read');
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  /**
   * `qr:read` is its own permission (FRONT_DESK and PROPERTY_ADMIN hold it). A
   * public code is the one thing on this screen that works from outside the
   * building — anyone holding it can reach the room's guest surface — so it is
   * not fetched at all for an account that may not see it.
   */
  const maySeeQr = can(session, propertyId, 'qr:read');

  const mayUpdateStay = can(session, propertyId, 'stay:update');
  const { property, occupancy, cleanStates, catalog } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      occupancy: await listRoomsWithOccupancy(tx, { propertyId, withQrCodes: maySeeQr }),
      cleanStates: await roomCleanStates(tx, { propertyId }),
      // What a guest who rings down can be given, for the desk's form.
      catalog: mayUpdateStay ? await getRequestCatalog(tx, { propertyId }) : [],
    }),
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const now = new Date();

  /**
   * Where a guest's phone should reach us.
   *
   * `APP_URL` and NOT anything derived from this request: `output: 'standalone'`
   * binds 0.0.0.0, so a URL built from `request.url` behind Railway's proxy is
   * an internal hostname — the same trap that made redirects relative. When it
   * is unset the client falls back to its own `window.location.origin`, which is
   * the origin the admin is actually on and is right whenever the two surfaces
   * share a domain.
   */
  const guestLinkBase = process.env.APP_URL?.replace(/\/+$/, '') ?? null;

  const rooms: RoomView[] = occupancy.map((room) => ({
    id: room.id,
    number: room.number,
    floorName: room.floorName,
    roomTypeName: room.roomTypeName,
    qr: room.qr
      ? {
        publicCode: room.qr.publicCode,
        // The absolute link, built here so every row agrees and nothing has to
        // reassemble it in the browser.
        url: guestLinkBase ? `${guestLinkBase}/r/${room.qr.publicCode}` : null,
      }
      : null,
    clean: (() => {
      const state = cleanStateOf(cleanStates, room.id);
      return { status: state.status, note: state.note };
    })(),
    stay: room.stay
      ? {
        id: room.stay.id,
        guestId: room.stay.guestId,
        guestName: room.stay.guestName,
        guestPhone: room.stay.guestPhone,
        isVip: room.stay.isVip,
        notes: room.stay.staffNotes,
        // The change-checkout form starts at today's date and hour, in the
        // property's own time.
        checkoutDate: localTimeAt(room.stay.scheduledCheckoutAt, timeZone).date ?? '',
        checkoutHour: Math.floor(localTimeAt(room.stay.scheduledCheckoutAt, timeZone).minutes / 60),
        // The column form: a full weekday either truncates here or takes the
        // width the guest's name needs.
        dueOut: formatCheckoutShort(room.stay.scheduledCheckoutAt, timeZone),
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
  // Sellable: empty, made up (or inspected), and not out of order.
  const isReady = (room: RoomView) => !room.stay && (room.clean.status === 'CLEAN' || room.clean.status === 'INSPECTED');
  const matches: Record<Show, (room: RoomView) => boolean> = {
    all: () => true,
    in: (room) => !!room.stay,
    out: (room) => room.stay?.nightsLeft === 0,
    ready: isReady,
    dirty: (room) => room.clean.status === 'DIRTY',
    ooo: (room) => room.clean.status === 'OUT_OF_ORDER',
  };
  const shown = rooms.filter(matches[show]);
  const counts = Object.fromEntries(SHOWS.map((s) => [s.key, rooms.filter(matches[s.key]).length])) as Record<Show, number>;

  /**
   * The open room, by NUMBER (`?room=214`): what a desk says out loud, and a
   * URL one person can send another. It can be any room, not only one the
   * filter shows — a link to an empty room stays good after check-in.
   */
  const selected = params.room ? rooms.find((room) => room.number === params.room) ?? null : null;
  const base = show === 'all' ? '/admin/rooms' : `/admin/rooms?show=${show}`;
  const panelHref = (number: string) => `${base}${base.includes('?') ? '&' : '?'}room=${encodeURIComponent(number)}`;
  const linkFor = Object.fromEntries(shown.map((room) => [room.number, panelHref(room.number)]));
  const owing = rooms.filter((room) => room.stay?.owes).length;

  // The hours a desk actually picks between, offered rather than hardcoded into
  // the action — there is no property-level standard checkout hour in the
  // schema, and inventing one in a form would be a business value in the wrong
  // place.
  const checkoutHours = [10, 11, 12, 14];

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Rooms</h1>
          <p className={styles.lede}>
            {occupied} of {rooms.length} occupied
            {dueOutToday > 0 ? ` · ${dueOutToday} out today` : ''}
            {owing > 0 ? ` · ${owing} with something on the folio` : ''}
          </p>
        </div>
      </header>

      <nav className={styles.views} aria-label="Show rooms">
        {SHOWS.map((s) => (
          <Link
            key={s.key}
            href={s.key === 'all' ? '/admin/rooms' : `/admin/rooms?show=${s.key}`}
            scroll={false}
            className={styles.view}
            aria-current={show === s.key ? 'page' : undefined}
          >
            {s.label}
            <span className={`${styles.viewCount} tabular`}>{counts[s.key]}</span>
          </Link>
        ))}
      </nav>

      {shown.length === 0 ? (
        <p className={styles.sectionEmpty}>
          {{
            out: 'Nobody is due out today.', in: 'Nobody is in house.', ready: 'No empty room is ready to sell.',
            dirty: 'Every room is made up.', ooo: 'No room is out of order.', all: 'There are no rooms.',
          }[show]}{' '}
          <Link href="/admin/rooms">Show every room</Link>
        </p>
      ) : null}

      <RoomGrid rooms={shown} linkFor={linkFor} selected={selected?.number ?? null} />

      {selected ? (
        <SidePanel
          title={`Room ${selected.number}`}
          subtitle={selected.stay ? selected.stay.guestName : 'Empty'}
          closeHref={base}
        >
          <RoomPanel
            propertyId={propertyId}
            room={selected}
            checkoutHours={checkoutHours}
            deskHref={`/admin/desk?filter=all&room=${selected.id}`}
            permissions={{
              checkIn: can(session, propertyId, 'stay:check_in'),
              checkOut: can(session, propertyId, 'stay:check_out'),
              vouch: can(session, propertyId, 'guest:vouch'),
              // Its own permission since S5, with nothing calling it until now.
              reprintQr: maySeeQr && can(session, propertyId, 'qr:regenerate'),
              clean: can(session, propertyId, 'request:advance'),
              inspect: can(session, propertyId, 'request:verify'),
              outOfOrder: can(session, propertyId, 'room:manage'),
              updateStay: mayUpdateStay,
            }}
            catalog={catalog.map((type) => ({
              id: type.id,
              label: type.priceMinor > 0 ? `${type.name} · ${formatMoney(money(type.priceMinor, type.currency))}` : type.name,
              allowsQuantity: type.allowsQuantity,
              maxQuantity: type.maxQuantity,
            }))}
            raiseKey={randomUUID()}
          />
        </SidePanel>
      ) : null}

      <p className={styles.footnote}>
        Checking someone out frees the room, ends every session on their phone
        (#10), records what was still on the bill, and marks the room to be made
        up. A guest who owes anything is checked out from their bill, where the
        payment is taken.
      </p>
    </>
  );
}
