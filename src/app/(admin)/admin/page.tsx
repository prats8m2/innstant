import Link from 'next/link';
import {
  ArrowRight, BadgePercent, BedDouble, CircleSlash, Clock, DoorOpen, IndianRupee,
  ListChecks, Receipt, Sparkles, Timer, type LucideIcon,
} from 'lucide-react';
import { withTenant } from '@/db';
import { can, findProperty } from '@/modules/identity';
import { adminAccess, AdminDenied } from './guard';
import {
  getInRoomDiningOutletConfig, listOffers, scheduleState, listUnavailableItems,
  portionsLeftToday, getAdminMenu, listCollections, TODAYS_SPECIAL,
} from '@/modules/catalog';
import { listRoomsWithOccupancy, listCheckoutRequests } from '@/modules/stay';
import { getOpenRequests } from '@/modules/requests';
import { kitchenTickets, daySummary } from '@/modules/ordering';
import { localTimeAt, nightsUntil } from '@/lib/clock';
import { formatMoney, money, type CurrencyCode } from '@/lib/money';
import { LiveConsole } from './live-console';
import { OrdersByHour } from './orders-by-hour';
import styles from './admin.module.css';

/**
 * The console's front page: how the day is going, and what needs somebody.
 *
 * It was four counts and a list of links. A GM opens this at 8am and leaves it
 * open, so it answers the questions they open it with, in order: how is today
 * going (sales against yesterday at this hour, orders, on time), what is
 * happening now (the hours so far, the kitchen's rail), what needs somebody,
 * what is selling, and what the menu is doing (offers live, sold out, off).
 *
 * Every block is the same service call the screen behind it makes, and is
 * skipped entirely for an account that cannot open that screen. Sales are
 * shown to accounts that can set prices (a GM, an F&B manager), not to every
 * account that can see the kitchen's tickets.
 *
 * Live, like the rest of the console (D-060): an order or a request anywhere
 * re-reads this page.
 */
export const dynamic = 'force-dynamic';

const STAGES = [
  { status: 'PLACED', label: 'New' },
  { status: 'ACCEPTED', label: 'Accepted' },
  { status: 'PREPARING', label: 'Cooking' },
  { status: 'READY', label: 'Ready' },
  { status: 'OUT_FOR_DELIVERY', label: 'On its way' },
] as const;

export default async function AdminHome() {
  // No permission is needed to see the console's front page: it shows what
  // this account can reach, and an account that can reach nothing is told so.
  const access = await adminAccess();
  if (!access.ok) return <AdminDenied reason={access.reason} />;
  const { session, propertyId } = access;

  const maySeeStays = can(session, propertyId, 'stay:read');
  const maySeeRequests = can(session, propertyId, 'request:read');
  const maySeeOrders = can(session, propertyId, 'order:read');
  const maySeeSales = maySeeOrders && can(session, propertyId, 'catalog:pricing');
  const maySeeMenu = can(session, propertyId, 'catalog:read');
  const maySeeBuilding = can(session, propertyId, 'room:read');
  const maySeeStaff = can(session, propertyId, 'staff:read');

  const data = await withTenant(
    { tenantId: session.tenantId, propertyId },
    async (tx) => {
      const property = await findProperty(tx, propertyId);
      const outlet = await getInRoomDiningOutletConfig(tx, propertyId);
      const timeZone = property?.timezone ?? 'Asia/Kolkata';
      const at = localTimeAt(new Date(), timeZone);
      const menu = maySeeMenu && outlet ? await getAdminMenu(tx, { outletId: outlet.id }) : null;
      return {
        property,
        outlet,
        at,
        rooms: maySeeStays ? await listRoomsWithOccupancy(tx, { propertyId }) : [],
        requests: maySeeRequests ? await getOpenRequests(tx, { propertyId }) : [],
        checkouts: maySeeStays ? await listCheckoutRequests(tx, { propertyId }) : [],
        tickets: maySeeOrders && outlet ? await kitchenTickets(tx, { outletId: outlet.id }) : [],
        day: maySeeOrders && outlet
          ? await daySummary(tx, { propertyId, timeZone, currency: outlet.currency })
          : null,
        // The menu's state, for the "menu right now" strip.
        offers: menu ? await listOffers(tx, { outletId: menu.outlet.id }) : [],
        unavailable: menu ? await listUnavailableItems(tx, { outletId: menu.outlet.id }) : [],
        portions: menu
          ? await portionsLeftToday(tx, {
              itemIds: menu.categories.flatMap((c) => c.items.map((i) => i.id)),
              businessDate: at.date!,
            })
          : new Map<string, { limit: number; left: number }>(),
        collections: menu && can(session, propertyId, 'catalog:manage')
          ? await listCollections(tx, { outletId: menu.outlet.id })
          : [],
      };
    },
  );

  const { property, outlet, at, rooms, requests, checkouts, tickets, day } = data;
  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const now = new Date();
  const hour = Math.floor(at.minutes / 60);
  const currency = (day?.currency ?? 'INR') as CurrencyCode;
  // Whole rupees: a day's takings to the paisa is noise on a dashboard
  // ("₹3,160.50" also overflowed its tile). Bills and receipts keep paise.
  const rupees = (minor: number) => formatMoney(money(minor, currency), { showDecimals: false });

  const occupied = rooms.filter((room) => room.stay).length;
  const dueOutToday = rooms.filter(
    (room) => room.stay && nightsUntil(now, room.stay.scheduledCheckoutAt, timeZone) === 0,
  ).length;
  const late = requests.filter((request) => request.breached);

  const offersLive = data.offers.filter((o) => o.isActive && scheduleState(o, at).kind === 'live');
  const soldOut = [...data.portions.values()].filter((p) => p.left === 0).length;
  const special = data.collections.find((c) => c.name === TODAYS_SPECIAL
    && c.isActive && c.startsOn === at.date && c.endsOn === at.date);

  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLine = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone,
  }).format(now);

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <p className={styles.overviewDate}>{dateLine}</p>
          <h1 className={styles.title}>{greeting}</h1>
          <p className={styles.lede}>
            {outlet
              ? outlet.isAcceptingOrders
                ? `${outlet.name} is taking orders.`
                : `${outlet.name} is closed to orders.`
              : 'No in-room dining outlet is configured here.'}
          </p>
        </div>
        <LiveConsole propertyId={propertyId} orders={maySeeOrders} requests={maySeeRequests} />
      </header>

      {/* ── How the day is going ─────────────────────────────────────────── */}
      <ul className={styles.stats}>
        {maySeeSales && day ? (
          <Stat
            href="/admin/menu"
            icon={IndianRupee}
            label="Sales today"
            value={rupees(day.today.salesMinor)}
            note={compare(day.today.salesMinor, day.yesterdaySoFar.salesMinor, rupees)}
            hero
          />
        ) : null}
        {maySeeOrders && day ? (
          <Stat
            href="/kds"
            icon={Receipt}
            label="Orders today"
            value={`${day.today.orders}`}
            note={day.today.orders
              ? `about ${rupees(day.today.averageOrderMinor)} each${day.today.rejected ? ` · ${day.today.rejected} not made` : ''}`
              : 'none yet'}
          />
        ) : null}
        {maySeeOrders && day ? (
          <Stat
            href="/runner"
            icon={Timer}
            label="On time"
            value={day.today.delivered ? `${Math.round((day.today.deliveredOnTime / day.today.delivered) * 100)}%` : '—'}
            note={day.today.delivered
              ? `${day.today.deliveredOnTime} of ${day.today.delivered} by the promise${day.today.averageMinutesToDoor !== null ? ` · ${day.today.averageMinutesToDoor} min to the door` : ''}`
              : 'nothing delivered yet'}
            attention={day.today.delivered > 0 && day.today.deliveredOnTime / day.today.delivered < 0.8}
          />
        ) : null}
        {maySeeStays ? (
          <Stat
            href="/admin/rooms?show=in"
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
            note={late.length ? `${late.length} past their promise` : 'all within their promise'}
            attention={late.length > 0}
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

      {/* ── What is happening now ────────────────────────────────────────── */}
      {maySeeOrders && day ? (
        <div className={styles.overviewRow}>
          <section className={`${styles.section} ${styles.overviewWide}`}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Orders by the hour</h2>
              <p className={styles.sectionBlurb}>Today against yesterday, in the hotel&rsquo;s time.</p>
            </header>
            <OrdersByHour today={day.byHour} yesterday={day.byHourYesterday} nowHour={hour} />
          </section>

          <section className={styles.section}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>The kitchen now</h2>
              <Link href="/kds" className={styles.sectionLink}>
                Kitchen display <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
              </Link>
            </header>
            <ul className={styles.stageList}>
              {STAGES.map((stage) => {
                const n = tickets.filter((t) => t.status === stage.status).length;
                return (
                  <li key={stage.status} className={styles.stage} data-empty={n === 0 || undefined}>
                    <span>{stage.label}</span>
                    <span className={`${styles.stageCount} tabular`}>{n}</span>
                  </li>
                );
              })}
            </ul>
            {tickets.length === 0 ? (
              <p className={styles.sectionEmpty}>Nothing on the rail. The kitchen is clear.</p>
            ) : null}
          </section>
        </div>
      ) : null}

      <div className={styles.overviewRow}>
        {/* ── What needs somebody ──────────────────────────────────────────── */}
        {/* Only for an account that can see what it lists: "nothing is
            waiting" said to the kitchen, which cannot see requests, would be
            a claim it has no grounds for. */}
        {maySeeRequests || maySeeStays ? (
        <section className={`${styles.section} ${styles.overviewWide}`}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Needs somebody</h2>
            <p className={styles.sectionBlurb}>The things with a clock on them.</p>
          </header>
          {late.length || checkouts.length ? (
            <ul className={styles.dishes}>
              {late.slice(0, 6).map((request) => (
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
        ) : null}

        {/* ── What is selling ──────────────────────────────────────────────── */}
        {maySeeOrders && day ? (
          <section className={styles.section}>
            <header className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Selling today</h2>
            </header>
            {day.topDishes.length ? (
              <ol className={styles.topDishes}>
                {day.topDishes.map((dish) => (
                  <li key={dish.name}>
                    <span className={styles.topDishName}>{dish.name}</span>
                    <span className={`${styles.topDishQty} tabular`}>×{dish.quantity}</span>
                    {maySeeSales ? (
                      <span className={`${styles.topDishSales} tabular`}>{rupees(dish.salesMinor)}</span>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.sectionEmpty}>Nothing sold yet today.</p>
            )}
          </section>
        ) : null}
      </div>

      {/* ── What the menu is doing ───────────────────────────────────────── */}
      {maySeeMenu && outlet ? (
        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>The menu right now</h2>
            <Link href="/admin/menu" className={styles.sectionLink}>
              Menu <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </header>
          <ul className={styles.menuNow}>
            <MenuFact
              icon={BadgePercent}
              href="/admin/menu/offers"
              text={offersLive.length
                ? `${offersLive.length} ${offersLive.length === 1 ? 'offer' : 'offers'} live: ${offersLive.map((o) => o.name).join(', ')}`
                : 'No offer is live'}
              tone={offersLive.length ? 'on' : undefined}
            />
            {maySeeSales && day && day.today.givenByOffersMinor > 0 ? (
              <MenuFact icon={IndianRupee} href="/admin/menu/offers" text={`${rupees(day.today.givenByOffersMinor)} given in offers today`} />
            ) : null}
            {data.collections.length ? (
              <MenuFact
                icon={Sparkles}
                href="/admin/menu"
                text={special
                  ? `Today’s special is on, with ${special.items.length} ${special.items.length === 1 ? 'dish' : 'dishes'}`
                  : 'No special today'}
                tone={special ? 'on' : undefined}
              />
            ) : null}
            <MenuFact
              icon={CircleSlash}
              href="/admin/menu"
              text={data.unavailable.length
                ? `${data.unavailable.length} off tonight: ${data.unavailable.slice(0, 3).map((d) => d.name).join(', ')}${data.unavailable.length > 3 ? '…' : ''}`
                : 'Everything is on'}
              tone={data.unavailable.length ? 'attention' : undefined}
            />
            {soldOut ? (
              <MenuFact icon={Clock} href="/admin/menu" text={`${soldOut} sold out today`} tone="attention" />
            ) : null}
          </ul>
        </section>
      ) : null}

      {/* ── Set up: the screens that change a few times a year ───────────── */}
      <section className={styles.section}>
        <header className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>Set up</h2>
          <p className={styles.sectionBlurb}>The things that change a few times a year.</p>
        </header>
        <ul className={styles.cards}>
          {maySeeMenu ? (
            <Card href="/admin/menu" title="Menu">Sections, dishes, prices, offers and schedules.</Card>
          ) : null}
          {maySeeMenu ? (
            <Card href="/admin/links" title="Links">A table tent, the counter, a link to send: the menu without a room.</Card>
          ) : null}
          {maySeeRequests ? (
            <Card href="/admin/requests" title="What guests can ask for">Amenities and services, their prices and promises.</Card>
          ) : null}
          {maySeeBuilding ? (
            <Card href="/admin/property" title="The property">The hotel&rsquo;s name and clock, room types, floors and rooms.</Card>
          ) : null}
          {maySeeStaff ? (
            <Card href="/admin/staff" title="Staff">Who works here and what they can do.</Card>
          ) : null}
          {maySeeStays ? (
            <Card href="/admin/desk" title="Settling up">A guest&rsquo;s bill, the payment and check-out, from the front desk.</Card>
          ) : null}
        </ul>
      </section>
    </>
  );
}

/** "+12% on yesterday by now", or why there is nothing to compare. */
function compare(today: number, yesterday: number, show: (n: number) => string): string {
  if (!yesterday) return today ? 'nothing by this time yesterday' : 'nothing yet';
  const change = Math.round(((today - yesterday) / yesterday) * 100);
  if (change === 0) return `level with yesterday by now (${show(yesterday)})`;
  return `${change > 0 ? '+' : ''}${change}% on yesterday by now (${show(yesterday)})`;
}

function Stat({
  href,
  icon: Icon,
  label,
  value,
  of,
  note,
  attention = false,
  hero = false,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  of?: string;
  note: string;
  /** The accent: somebody has to do something. */
  attention?: boolean;
  /** The one number the page leads with. */
  hero?: boolean;
}) {
  return (
    <li className={styles.stat} data-attention={attention} data-hero={hero || undefined}>
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

function MenuFact({
  icon: Icon,
  href,
  text,
  tone,
}: {
  icon: LucideIcon;
  href: string;
  text: string;
  tone?: 'on' | 'attention';
}) {
  return (
    <li>
      <Link href={href} className={styles.menuFact} data-tone={tone}>
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>{text}</span>
      </Link>
    </li>
  );
}

function Card({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <li className={styles.card}>
      <Link href={href} className={styles.cardLink}>
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardBody}>{children}</span>
      </Link>
    </li>
  );
}
