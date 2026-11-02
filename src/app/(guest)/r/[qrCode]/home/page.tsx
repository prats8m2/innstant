import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { DEMO_NAME_COOKIE, DEMO_FLAG_COOKIE } from '@/modules/demo';
import { TileIcon, type TileIconName } from './tile-icon';
import { findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getOutletHours, outletOpenState, describeOpenState,
} from '@/modules/catalog';
import { listOrdersForContext, orderStateFor, OPEN_TO_A_GUEST, contextForSession } from '@/modules/ordering';
import {
  getRequestsForStay, getRequestTypeByKey, REQUEST_OPEN_TO_A_GUEST, CALL_SERVICE_KEY,
} from '@/modules/requests';
import { localTimeAt, formatClock, formatCheckoutDay, toClock } from '@/lib/clock';
import { guestBranding } from '../../../_brand/brand-scope';
import styles from './room-home.module.css';

/**
 * The room home — the post-scan landing, and the only screen most guests see.
 *
 * Rebuilt against Direction A (D-100), `design/reference/direction-a/
 * GuestHome.dc.html`: a masthead, the jharokha arch with the greeting beside
 * it, a live strip when something is on its way, four tiles, and ONE pinned
 * button. `GuestHomeAlt.dc.html` is the same layout on another theme, which is
 * the test of this file: nothing here may be Kesari's — the name, the
 * greeting, the hours and the arch's colour all come from the property.
 *
 * CLAUDE.md #9: this renders for an anonymous REQUEST-tier session with nothing
 * in the way. No login, no verification, no onboarding.
 *
 * ─── D-051: the button is pinned ───────────────────────────────────────────
 *
 * Ordering food is what this product is for. The button is always under the
 * thumb and it always says what the kitchen can actually do right now.
 */
export const dynamic = 'force-dynamic';

/**
 * The four tiles. `sub` is a default; the service tile's is replaced by the
 * real wait when the property has the one-tap call set up.
 */
const TILES: readonly { key: TileIconName; title: string; sub: string }[] = [
  { key: 'amenities', title: 'Amenities', sub: 'Towels, pillows, laundry' },
  { key: 'service', title: 'Call for service', sub: 'Someone comes up' },
  { key: 'stay', title: 'Your stay', sub: 'Bill, Wi-Fi, checkout' },
  { key: 'nearby', title: 'Plan my day', sub: 'Places we vouch for' },
];

export default async function RoomHome({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveStaySession(store.get(GUEST_SESSION_COOKIE)?.value);

  /**
   * Who is actually holding the phone.
   *
   * On a real stay this is nobody — neither cookie exists — and the greeting
   * uses the name on the stay (D-059). A visitor who came through the website
   * is greeted by the name they typed at `/demo`. Both cookies are cosmetic by
   * construction: forging them changes a heading, never a tier.
   */
  const isDemo = store.get(DEMO_FLAG_COOKIE)?.value === '1';
  const demoName = isDemo ? (store.get(DEMO_NAME_COOKIE)?.value ?? null) : null;

  // Cookie missing or stale — checked out, expired, revoked. Send them back
  // through the link, which issues a fresh session or 404s (#10).
  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  const { property, kitchen, isOpen, orders, requests, callWait } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      const found = await findProperty(tx, session.propertyId);
      const outlet = await getInRoomDiningOutlet(tx, session.propertyId);
      const timeZone = found?.timezone ?? 'Asia/Kolkata';
      // Everything this room has asked for — food AND amenities (D-058).
      const placed = await listOrdersForContext(tx, { context: contextForSession(session) });
      const asked = await getRequestsForStay(tx, { stayId: session.stayId });
      // The one-tap call's own promise, so the tile can say it.
      const call = await getRequestTypeByKey(tx, {
        propertyId: session.propertyId,
        key: CALL_SERVICE_KEY,
      });

      const state = outlet
        ? outletOpenState(await getOutletHours(tx, outlet.id), localTimeAt(new Date(), timeZone))
        : null;

      return {
        property: found,
        kitchen: state ? describeOpenState(state, formatClock) : null,
        isOpen: state?.isOpen ?? false,
        orders: placed,
        requests: asked,
        callWait: call?.slaMinutes ?? null,
      };
    },
  );

  // D-087: the hotel's logo in place of its wordmark, its photograph inside
  // the arch. Shared with the brand scope's read, so no second query.
  const branding = await guestBranding();

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const now = new Date();
  const hour = localTimeAt(now, timeZone).minutes / 60;

  /** "9:05pm", on the property's clock. */
  const clockAt = (instant: Date) => formatClock(toClock(localTimeAt(instant, timeZone).minutes));

  /** "until Monday, 11am" — from the stay, in the PROPERTY's timezone. */
  const checkout = formatCheckoutDay(session.scheduledCheckoutAt, timeZone);

  /** The visitor's own name wins over the stay's — see the note at the top. */
  const callThem = demoName ?? session.guestFirstName;

  /**
   * The live strip — the way back to something already asked for.
   *
   * Counts FOOD AND AMENITIES together (D-058). With exactly one thing moving
   * it goes straight to that thing's screen; with several, or with none moving
   * and some history, it goes to the list.
   *
   * The second line is the nearest TRUE thing to the board's "At your door
   * around 9:05pm": the order's promised time while it is still ahead, the
   * request's SLA target and whoever has it — and the order's own summary
   * otherwise. Never a time that has already passed.
   */
  const movingOrders = orders.filter((order) => OPEN_TO_A_GUEST.includes(order.status));
  const movingRequests = requests
    .filter((request) => REQUEST_OPEN_TO_A_GUEST.includes(request.status));
  const moving = movingOrders.length + movingRequests.length;
  const everything = orders.length + requests.length;

  const oneOrder = moving === 1 ? movingOrders[0] : undefined;
  const oneRequest = moving === 1 ? movingRequests[0] : undefined;

  const trail = oneOrder
    ? {
      href: `${base}/order/${oneOrder.id}`,
      label: orderStateFor(oneOrder.status).short,
      detail: oneOrder.promisedByAt && oneOrder.promisedByAt > now
        ? `At your door around ${clockAt(oneOrder.promisedByAt)}`
        : oneOrder.summary,
      live: true,
    }
    : oneRequest
      ? {
        href: `${base}/service/${oneRequest.id}`,
        label: oneRequest.assignedStaffName
          ? `${oneRequest.assignedStaffName} is on the way`
          : 'Someone is on the way',
        detail: [
          oneRequest.lines.map((line) => line.label).join(' · '),
          oneRequest.slaTargetAt && oneRequest.slaTargetAt > now
            ? `by ${clockAt(oneRequest.slaTargetAt)}`
            : null,
        ].filter(Boolean).join(' · '),
        live: true,
      }
      : moving > 1
        ? {
          href: `${base}/activity`,
          label: `${moving} things happening`,
          detail: 'Tap to see where each one is',
          live: true,
        }
        : everything
          ? {
            href: `${base}/activity`,
            label: 'Your requests',
            detail: `${everything} this stay`,
            live: false,
          }
          : null;

  const tileSub = (key: TileIconName, fallback: string) =>
    key === 'service' && callWait ? `Someone in about ${callWait} min` : fallback;

  return (
    <main className={styles.shell}>
      {/*
        The way back out, for somebody who arrived from the website. A real
        guest never sees this; a visitor has a site they were reading a moment
        ago. One quiet line above the property's own name.
      */}
      {isDemo ? (
        <p className={styles.demoRibbon}>
          <span>Demo · seeded data</span>
          <Link href="/">Back to Innstant</Link>
        </p>
      ) : null}

      <header className={styles.masthead}>
        {branding.logoUrl ? (
          <p className={styles.logoMark}>
            {/* eslint-disable-next-line @next/next/no-img-element -- any host, until uploads land */}
            <img src={branding.logoUrl} alt={property?.name ?? 'The hotel'} className={styles.logo} />
          </p>
        ) : (
          <p className={styles.wordmark}>{property?.name ?? 'Your stay'}</p>
        )}
        {/* The board makes the room number the way to the stay screen. */}
        <Link href={`${base}/stay`} className={styles.roomLink}>
          Room <span className={`${styles.roomNumber} tabular`}>{session.roomNumber}</span>
        </Link>
      </header>

      <section className={styles.hero}>
        {/*
          The jharokha. The one hand-drawn shape in the guest app (CLAUDE.md
          allows it: it is the brand, no package has it), and since Direction A
          a single 1px line in the property's accent, drawn on as the page
          lands. The hotel's own photograph sits inside it when there is one
          (D-087); without one, the lamplight wash the arch always had.
        */}
        <div className={styles.archFrame} aria-hidden="true">
          <div className={styles.archPhoto}>
            {branding.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- any host, until uploads land
              <img src={branding.coverUrl} alt="" className={styles.archCover} />
            ) : null}
          </div>
          <svg
            className={styles.archLine}
            viewBox="0 0 200 260"
            focusable="false"
          >
            <path
              d="M0 260 V110 C0 60 50 30 100 0 C150 30 200 60 200 110 V260"
              pathLength={1}
            />
          </svg>
        </div>

        <div className={styles.heroText}>
          {/*
            By name, when the stay has one (D-059). Falls back to the bare
            greeting — "Good evening," with a dangling comma is worse.
          */}
          <h1 className={styles.greeting}>
            {callThem ? `${greetingFor(hour)}, ${callThem}` : greetingFor(hour)}
          </h1>
          <p className={styles.stayLine}>
            Room <span className="tabular">{session.roomNumber}</span>
            {' · until '}
            <span className={styles.checkout}>{checkout}</span>
          </p>
        </div>
      </section>

      {trail ? (
        <Link href={trail.href} className={styles.trail} data-live={trail.live}>
          {trail.live ? <span className={styles.trailDot} aria-hidden="true" /> : null}
          <span className={styles.trailBody}>
            <span className={styles.trailLabel}>{trail.label}</span>
            <span className={styles.trailDetail}>{trail.detail}</span>
          </span>
          <ChevronRight className={styles.trailChevron} size={18} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      ) : null}

      <nav className={styles.tiles} aria-label="Services">
        {TILES.map((tile) => (
          <Link key={tile.key} href={`${base}/${tile.key}`} className={styles.tile}>
            <TileIcon name={tile.key} />
            <span className={styles.tileBody}>
              <span className={styles.tileTitle}>{tile.title}</span>
              <span className={styles.tileSub}>{tileSub(tile.key, tile.sub)}</span>
            </span>
          </Link>
        ))}
      </nav>

      {/*
        The one button, pinned. It stays a link when the kitchen is shut: the
        menu, the prices and the hours are all readable with the kitchen closed
        (#9 — never gate browsing), and the line under it says so rather than
        the button refusing.
      */}
      <div className={styles.cta}>
        <Link href={`${base}/menu`} className={styles.ctaButton} data-open={isOpen}>
          <span>
            Order {mealFor(hour)} to room{' '}
            <span className="tabular">{session.roomNumber}</span>
          </span>
          <ArrowRight size={20} strokeWidth={2} aria-hidden="true" />
        </Link>
        {kitchen ? <p className={styles.ctaSub}>{kitchen}</p> : null}
      </div>
    </main>
  );
}

/**
 * The greeting, on the PROPERTY's clock. Bands rather than a single cutoff,
 * because "Good evening" at 4pm is wrong in the same way "Good afternoon" at
 * 9pm is.
 */
function greetingFor(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Which meal the button offers. The board says "Order dinner to room 214",
 * which is right at 9pm and wrong at 8am; the menu behind it is the same.
 */
function mealFor(hour: number): string {
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  return 'dinner';
}
