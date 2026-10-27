import Link from 'next/link';
import { BedDouble, ChefHat, DoorOpen, ListChecks, type LucideIcon } from 'lucide-react';
import { withTenant } from '@/db';
import { can, findProperty } from '@/modules/identity';
import { adminAccess, AdminDenied } from './guard';
import { getInRoomDiningOutletConfig } from '@/modules/catalog';
import { listRoomsWithOccupancy, listCheckoutRequests } from '@/modules/stay';
import { getOpenRequests } from '@/modules/requests';
import { kitchenTickets } from '@/modules/ordering';
import { nightsUntil } from '@/lib/clock';
import { AdminShell } from './admin-shell';
import { LiveConsole } from './live-console';
import styles from './admin.module.css';

/**
 * The ops console's front page.
 *
 * ─── Why this stopped being a list of links ────────────────────────────────
 *
 * It was ten cards, one per destination, filtered by permission. That was the
 * right answer while the navigation was a single wrapping bar with no hierarchy
 * — the front page was doing the menu's job because the menu could not.
 *
 * The rail does that job now, and does it on every screen. A front page that
 * repeats it is a second click to reach the same place, and a GM opening the
 * console at 8am does not want a menu: they want to know whether anything needs
 * them. So it answers that, from the same service functions the screens behind
 * each number already use — nothing here is a new query shape, and every tile
 * is a link to the screen that can act on it.
 *
 * Everything is gated on the permission of the screen it points at. A cook with
 * `order:read` and nothing else sees one tile, not four refusals.
 */
export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  // No permission required to see the console's front page — it shows what this
  // account can reach, and an account that can reach nothing should be told so
  // rather than bounced.
  const access = await adminAccess();
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const maySeeStays = can(session, propertyId, 'stay:read');
  const maySeeRequests = can(session, propertyId, 'request:read');
  const maySeeOrders = can(session, propertyId, 'order:read');
  const maySeeBuilding = can(session, propertyId, 'room:read');
  const maySeeStaff = can(session, propertyId, 'staff:read');
  const mayEditMenu = can(session, propertyId, 'catalog:read');

  const { property, outlet, rooms, requests, checkouts, tickets } = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const outletConfig = await getInRoomDiningOutletConfig(tx, propertyId);
      return {
        property: await findProperty(tx, propertyId),
        outlet: outletConfig,
        // Each of these is the same call the screen behind the tile makes, and
        // is skipped entirely for an account that cannot open that screen.
        rooms: maySeeStays ? await listRoomsWithOccupancy(tx, { propertyId }) : [],
        requests: maySeeRequests ? await getOpenRequests(tx, { propertyId }) : [],
        checkouts: maySeeStays ? await listCheckoutRequests(tx, { propertyId }) : [],
        tickets: maySeeOrders && outletConfig
          ? await kitchenTickets(tx, { outletId: outletConfig.id })
          : [],
      };
    },
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const now = new Date();

  const occupied = rooms.filter((room) => room.stay).length;
  const dueOutToday = rooms.filter(
    (room) => room.stay && nightsUntil(now, room.stay.scheduledCheckoutAt, timeZone) === 0,
  ).length;
  const late = requests.filter((request) => request.breached).length;

  return (
    <AdminShell
      session={session}
      propertyId={propertyId}
      propertyName={property?.name ?? 'This property'}
      current="home"
    >
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.title}>Overview</h1>
          <p className={styles.lede}>
            {outlet
              ? outlet.isAcceptingOrders
                ? `${outlet.name} is taking orders.`
                : `${outlet.name} is closed to orders.`
              : 'No in-room dining outlet is configured here.'}
          </p>
        </div>
        {/* A GM opens this at 8am and leaves it open. Every number below comes
            from the same service functions the floor screens use, and until now
            they froze at the moment the page loaded. */}
        <LiveConsole
          propertyId={propertyId}
          orders={maySeeOrders}
          requests={maySeeRequests}
        />
      </header>

      <ul className={styles.stats}>
        {maySeeStays ? (
          <Stat
            href="/admin/rooms"
            icon={BedDouble}
            label="Rooms occupied"
            value={`${occupied}`}
            of={`of ${rooms.length}`}
            note={dueOutToday ? `${dueOutToday} out today` : 'nobody out today'}
            attention={dueOutToday > 0}
          />
        ) : null}

        {maySeeRequests ? (
          <Stat
            href="/housekeeping"
            icon={ListChecks}
            label="Requests open"
            value={`${requests.length}`}
            /* Breached, not "late-ish": `slaState()` computes it from the clock
               and the SLA sweep escalates on the same number. */
            note={late ? `${late} past their promise` : 'all within their promise'}
            attention={late > 0}
          />
        ) : null}

        {maySeeOrders && outlet ? (
          <Stat
            href="/kds"
            icon={ChefHat}
            label="In the kitchen"
            value={`${tickets.length}`}
            note={tickets.length === 1 ? 'one ticket up' : 'tickets up'}
          />
        ) : null}

        {maySeeStays ? (
          <Stat
            href="/admin/checkouts"
            icon={DoorOpen}
            label="Leaving later"
            value={`${checkouts.length}`}
            note={checkouts.length ? 'waiting on an answer' : 'nothing waiting'}
            attention={checkouts.length > 0}
          />
        ) : null}
      </ul>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Needs somebody</h2>
          <p className={styles.sectionBlurb}>
            The things with a clock on them. Everything else can wait.
          </p>
        </header>

        {late || checkouts.length ? (
          <ul className={styles.dishes}>
            {requests.filter((request) => request.breached).slice(0, 6).map((request) => (
              <li key={request.id} className={styles.dish}>
                <span className={styles.dishBody}>
                  <span className={styles.dishName}>
                    Room {request.roomNumber}
                    <span className={styles.offTag} data-tone="critical">past its promise</span>
                  </span>
                  <span className={styles.dishFlags}>
                    {request.lines.map((line) => line.label).join(', ') || request.requestNumber}
                    {' · '}
                    {request.assignedStaffName ?? 'nobody assigned'}
                  </span>
                </span>
                <span className={styles.rowEnd}>
                  <Link href="/housekeeping" className={styles.secondary}>The floors</Link>
                </span>
              </li>
            ))}

            {checkouts.slice(0, 6).map((request) => (
              <li key={request.id} className={styles.dish}>
                <span className={styles.dishBody}>
                  <span className={styles.dishName}>
                    Room {request.roomNumber}
                    <span className={styles.offTag}>wants to leave later</span>
                  </span>
                  <span className={styles.dishFlags}>{request.guestName}</span>
                </span>
                <span className={styles.rowEnd}>
                  <Link href="/admin/checkouts" className={styles.secondary}>Answer it</Link>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.sectionEmpty}>
            Nothing is waiting on anybody. Requests are inside their promise and
            no one has asked to leave later.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Set up</h2>
          <p className={styles.sectionBlurb}>
            The things that change a few times a year rather than a few times a
            shift.
          </p>
        </header>

        <ul className={styles.cards}>
          {mayEditMenu ? (
            <Card href="/admin/menu" title="Menu">
              Sections, dishes, prices, and what is on tonight.
            </Card>
          ) : null}

          {mayEditMenu ? (
            <Card href="/admin/links" title="Links">
              A code that is not on a nightstand — a table tent, the counter, a
              link to send. The menu, reachable without a room.
            </Card>
          ) : null}

          {maySeeRequests ? (
            <Card href="/admin/requests" title="What guests can ask for">
              Amenities and services, what each costs, how long it is promised
              in, and whose phone it reaches.
            </Card>
          ) : null}

          {maySeeBuilding ? (
            <Card href="/admin/property" title="The property">
              The hotel&rsquo;s name and clock, its room types, its floors and
              rooms. A room added here gets its own QR sticker.
            </Card>
          ) : null}

          {maySeeStaff ? (
            <Card href="/admin/staff" title="Staff">
              Who works here and what they can do. An invite link gives somebody
              their first password.
            </Card>
          ) : null}

          {/* This tile used to say "Settling a folio: not built yet". It was
              built in P3 (2d23757), and the tile went on saying otherwise
              for months: a promise of absence is a claim like any other. */}
          {maySeeStays ? (
            <Card href="/admin/desk" title="Settling up">
              A guest&rsquo;s bill, taking the payment, and checking out: open the
              room on the front desk.
            </Card>
          ) : null}
        </ul>
      </section>
    </AdminShell>
  );
}

function Stat({
  href,
  icon: Icon,
  label,
  value,
  of,
  note,
  attention = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  of?: string;
  note: string;
  /** Saffron: somebody has to do something. The console's one emphasis colour. */
  attention?: boolean;
}) {
  return (
    <li className={styles.stat} data-attention={attention}>
      <Link href={href} className={styles.statLink}>
        <span className={styles.statLabel}>
          <Icon size={15} strokeWidth={1.75} aria-hidden="true" className={styles.statIcon} />
          {label}
        </span>
        <span className={styles.statValue}>
          <span className="tabular">{value}</span>
          {of ? <span className={styles.statOf}>{of}</span> : null}
        </span>
        <span className={styles.statNote}>{note}</span>
      </Link>
    </li>
  );
}

function Card({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className={styles.card}>
      <Link href={href} className={styles.cardLink}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardBody}>{children}</span>
      </Link>
    </li>
  );
}
