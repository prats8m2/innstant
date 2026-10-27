import Link from 'next/link';
import { withTenant } from '@/db';
import { adminAccess, AdminDenied } from '../guard';
import { can, findProperty } from '@/modules/identity';
import { listRoomsWithOccupancy } from '@/modules/stay';
import { formatMoney, money } from '@/lib/money';
import { formatCheckoutShort, nightsUntil } from '@/lib/clock';
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

/**
 * Which rooms the rack shows. Links with `?show=`, like the desk's views
 * (D-061): the choice survives a reload and can be sent to somebody. All is
 * the default, because the rack is the one screen that lists every key.
 */
const SHOWS = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'In house' },
  { key: 'empty', label: 'Empty' },
  { key: 'out', label: 'Out today' },
] as const;
type Show = (typeof SHOWS)[number]['key'];

export default async function RoomsAdmin({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const requested = (await searchParams).show;
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

  const { property, occupancy } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => ({
      property: await findProperty(tx, propertyId),
      occupancy: await listRoomsWithOccupancy(tx, { propertyId, withQrCodes: maySeeQr }),
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
    stay: room.stay
      ? {
        id: room.stay.id,
        guestId: room.stay.guestId,
        guestName: room.stay.guestName,
        guestPhone: room.stay.guestPhone,
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
  const shown = rooms.filter((room) =>
    show === 'in' ? room.stay
      : show === 'empty' ? !room.stay
        : show === 'out' ? room.stay?.nightsLeft === 0
          : true);
  const counts: Record<Show, number> = {
    all: rooms.length, in: occupied, empty: rooms.length - occupied, out: dueOutToday,
  };

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
          </p>
        </div>
      </header>

      <nav className={styles.views} aria-label="Show rooms">
        {SHOWS.map((s) => (
          <Link
            key={s.key}
            href={s.key === 'all' ? '/admin/rooms' : `/admin/rooms?show=${s.key}`}
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
          {show === 'out' ? 'Nobody is due out today.' : show === 'in' ? 'Nobody is in house.' : 'Every room is taken.'}{' '}
          <Link href="/admin/rooms">Show every room</Link>
        </p>
      ) : null}

      <RoomBoard
        propertyId={propertyId}
        rooms={shown}
        checkoutHours={checkoutHours}
        permissions={{
          checkIn: can(session, propertyId, 'stay:check_in'),
          checkOut: can(session, propertyId, 'stay:check_out'),
          vouch: can(session, propertyId, 'guest:vouch'),
          // Its own permission since S5, with nothing calling it until now.
          reprintQr: maySeeQr && can(session, propertyId, 'qr:regenerate'),
        }}
      />

      <p className={styles.footnote}>
        Checking someone out frees the room, ends every session on their phone
        (#10) and records what was still on the folio at the moment they left.
        Taking the payment is on the guest&rsquo;s page (their name, above), and
        anything unpaid stays on the bill until it is.
      </p>
    </>
  );
}
