import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { mediaSrcSet } from '@/modules/media/paths';
import { withTenant } from '@/db';
import { resolveStaySession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { DEMO_NAME_COOKIE, DEMO_FLAG_COOKIE } from '@/modules/demo';
import { getPropertyProfile } from '@/modules/identity';
import {
  getInRoomDiningOutletConfig, getOutletHours, outletOpenState, describeOpenState,
  type OutletOpenState,
} from '@/modules/catalog';
import {
  listOrdersForContext, orderStateFor, OPEN_TO_A_GUEST, contextForSession, trackEta,
} from '@/modules/ordering';
import {
  getRequestsForStay, getRequestTypeByKey, requestStateFor, REQUEST_OPEN_TO_A_GUEST,
  CALL_SERVICE_KEY,
} from '@/modules/requests';
import { getStayAtDesk } from '@/modules/stay';
import {
  localTimeAt, formatClock, formatCheckoutShort, dayName, toClock, stayDay,
} from '@/lib/clock';
import { guestBranding } from '../../../_brand/brand-scope';
import { ArchMark } from '../../../_brand/arch-mark';
import { TileIcon, DockNav, type TileIconName } from './tile-icon';
import styles from './room-home.module.css';

/**
 * The room home — where a scan lands once the guest has been welcomed, and the
 * only screen most guests see.
 *
 * Rebuilt to Midnight (`design/reference/midnight/Main.dc.html`): the
 * wordmark, the arch with the greeting inside it, the stay strip, what is on
 * its way, four tiles, and the dock — the order bar over a four-tab nav.
 *
 * What the board draws and this does not, because nothing stands behind it:
 * the digital key and its Unlock button, the messages and profile buttons,
 * "Today at The Kesari", and the bill's amount (the bill is behind the
 * four-digit check on Your stay, so that cell says "View" and goes there).
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

/** The four tiles, in the board's order. Call for service is the lit one. */
const TILES: readonly { key: TileIconName; path: string; title: string; sub: string }[] = [
  { key: 'dining', path: 'menu', title: 'In-room dining', sub: 'See the menu' },
  { key: 'amenities', path: 'amenities', title: 'Amenities', sub: 'Towels, pillows, laundry' },
  { key: 'nearby', path: 'nearby', title: 'Plan my day', sub: 'Places we vouch for' },
  { key: 'service', path: 'service', title: 'Call for service', sub: 'Someone comes up' },
];

/** One row under "Your requests", whichever module it came from. */
interface Asked {
  id: string;
  href: string;
  title: string;
  sub: string;
  /** Somebody has it in hand (the accent dot) or it is waiting (an outline). */
  moving: boolean;
  /** "12 min", "9:40pm", "4 min late" — only while a promise is in play. */
  when: string | null;
  late: boolean;
  at: number;
}

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

  const {
    profile, stay, kitchenState, prepMinutes, orders, requests, callWait,
  } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      // The name, the timezone, and the wifi for the strip's middle cell —
      // shown only when the hotel has one to give.
      const found = await getPropertyProfile(tx, session.propertyId);
      const outlet = await getInRoomDiningOutletConfig(tx, session.propertyId);
      const timeZone = found?.timezone ?? 'Asia/Kolkata';
      const call = await getRequestTypeByKey(tx, {
        propertyId: session.propertyId,
        key: CALL_SERVICE_KEY,
      });

      return {
        profile: found,
        // When they arrived, for "Day 2 of 4".
        stay: await getStayAtDesk(tx, { propertyId: session.propertyId, stayId: session.stayId }),
        kitchenState: outlet
          ? outletOpenState(await getOutletHours(tx, outlet.id), localTimeAt(new Date(), timeZone))
          : null,
        prepMinutes: outlet?.prepTimeMinutes ?? null,
        // Everything this room has asked for — food AND amenities (D-058).
        orders: await listOrdersForContext(tx, { context: contextForSession(session) }),
        requests: await getRequestsForStay(tx, { stayId: session.stayId }),
        // The one-tap call's own promise, so the tile can say it.
        callWait: call?.slaMinutes ?? null,
      };
    },
  );

  // D-087: the hotel's logo in place of its wordmark. Shared with the brand
  // scope's read, so no second query.
  const branding = await guestBranding();

  const timeZone = profile?.timezone ?? 'Asia/Kolkata';
  const now = new Date();
  const hour = localTimeAt(now, timeZone).minutes / 60;

  /** "9:05pm", on the property's clock. */
  const clockAt = (instant: Date) => formatClock(toClock(localTimeAt(instant, timeZone).minutes));

  /** The visitor's own name wins over the stay's — see the note at the top. */
  const callThem = demoName ?? session.guestFirstName;

  const { day, of } = stayDay(now, stay?.checkedInAt ?? now, session.scheduledCheckoutAt, timeZone);
  const hasWifi = Boolean(profile?.guestInfo.wifiNetwork);

  /**
   * "Sun, 11am" — the board's strip cell, on the property's clock.
   * `formatCheckoutShort` is the desk's "Sun 11am"; the strip has the comma.
   */
  const checkout = formatCheckoutShort(session.scheduledCheckoutAt, timeZone).replace(' ', ', ');

  /**
   * What the promise reads as at the end of a row. Minutes while it is within
   * the hour ("12 min"), the time beyond that ("9:40pm"), and how far behind
   * once it has passed — never a time that is already gone.
   */
  const promise = (deadline: Date | null): { when: string | null; late: boolean } => {
    if (!deadline) return { when: null, late: false };
    const minutes = Math.round((deadline.getTime() - now.getTime()) / 60_000);
    if (minutes < 0) return { when: `${Math.max(1, -minutes)} min late`, late: true };
    return { when: minutes <= 60 ? `${Math.max(1, minutes)} min` : clockAt(deadline), late: false };
  };

  /** Still on its way, newest first, three at most — the rest is "View all". */
  const asked: Asked[] = [
    ...orders
      .filter((order) => OPEN_TO_A_GUEST.includes(order.status))
      .map((order): Asked => {
        const eta = trackEta(order.status, order.promisedByAt);
        return {
          id: order.id,
          href: `${base}/order/${order.id}`,
          title: order.summary,
          sub: `${orderStateFor(order.status).label} · ${order.orderNumber}`,
          moving: order.status !== 'PLACED',
          ...promise(eta ? (eta.to ?? eta.from) : null),
          at: order.placedAt ? new Date(order.placedAt).getTime() : 0,
        };
      }),
    ...requests
      .filter((request) => REQUEST_OPEN_TO_A_GUEST.includes(request.status))
      .map((request): Asked => ({
        id: request.id,
        href: `${base}/service/${request.id}`,
        title: request.lines
          .map((line) => (line.quantity > 1 ? `${line.quantity}× ${line.label}` : line.label))
          .join(' · '),
        sub: [requestStateFor(request.status).label, request.assignedStaffName]
          .filter(Boolean).join(' · '),
        moving: request.status !== 'OPEN',
        ...promise(request.slaTargetAt),
        at: new Date(request.createdAt).getTime(),
      })),
  ].sort((a, b) => b.at - a.at).slice(0, 3);

  const anyHistory = orders.length + requests.length > 0;

  const tileSub = (key: TileIconName, fallback: string) => {
    if (key === 'service' && callWait) return `Someone in about ${callWait} min`;
    if (key === 'dining' && kitchenState) return diningHours(kitchenState);
    return fallback;
  };

  const isOpen = kitchenState?.isOpen ?? false;
  const kitchenLine = kitchenState
    ? [
      describeOpenState(kitchenState, formatClock),
      isOpen && prepMinutes ? `~${prepMinutes} min` : null,
    ].filter(Boolean).join(' · ')
    : null;

  const name = profile?.name ?? 'Your stay';

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
            {/* eslint-disable-next-line @next/next/no-img-element -- an upload, or a URL pasted before uploads (D-093) */}
            <img
              src={branding.logoUrl}
              srcSet={mediaSrcSet(branding.logoUrl)}
              sizes="200px"
              alt={name}
              className={styles.logo}
            />
          </p>
        ) : (
          <p className={styles.brand}>
            <ArchMark className={styles.brandMark} double />
            <span className={styles.wordmark}>{name}</span>
          </p>
        )}
      </header>

      <section className={styles.heroWrap}>
        <div className={styles.hero}>
          {/* D-087: the hotel's own photograph, quietly, behind the lamplight. */}
          {branding.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- an upload, or a URL pasted before uploads (D-093)
            <img
              src={branding.coverUrl}
              srcSet={mediaSrcSet(branding.coverUrl)}
              sizes="390px"
              alt=""
              className={styles.heroCover}
            />
          ) : null}
          <span className={styles.heroInner} aria-hidden="true" />
          {/* The rising sun in the doorway — the board's ornament, drawn as it is. */}
          <svg className={styles.heroSun} width="120" height="60" viewBox="0 0 120 60" fill="none" aria-hidden="true" focusable="false">
            <path d="M10 60a50 50 0 0 1 100 0" strokeWidth="1" opacity="0.35" />
            <path d="M26 60a34 34 0 0 1 68 0" strokeWidth="1" opacity="0.6" />
            <circle cx="60" cy="60" r="16" opacity="0.9" />
          </svg>

          <p className={styles.eyebrow}>
            Day {day} of {of} · Room {session.roomNumber}
          </p>
          {/*
            By name, when the stay has one (D-059). Falls back to the bare
            greeting — "Good evening," with a dangling comma is worse.
          */}
          <h1 className={styles.greeting}>
            {callThem ? (
              <>
                {greetingFor(hour)},<br />
                <em className={styles.greetingName}>{callThem}</em>
              </>
            ) : greetingFor(hour)}
          </h1>
          <p className={styles.heroLine}>{subtitleFor(hour)}</p>
        </div>
      </section>

      <section className={styles.section} aria-label="Your stay">
        <div className={styles.strip} data-cells={hasWifi ? 3 : 2}>
          <Link href={`${base}/stay`} className={styles.cell}>
            <span className={styles.cellLabel}>Check-out</span>
            <span className={styles.cellValue}>{checkout}</span>
          </Link>
          {hasWifi ? (
            <Link href={`${base}/stay`} className={styles.cell}>
              <span className={styles.cellLabel}>Wi-Fi</span>
              <span className={styles.cellValue}>Tap to join</span>
            </Link>
          ) : null}
          {/* The amount is behind the four digits on Your stay — not here. */}
          <Link href={`${base}/stay`} className={styles.cell}>
            <span className={styles.cellLabel}>Bill</span>
            <span className={styles.cellValue}>View</span>
          </Link>
        </div>
      </section>

      <section className={styles.sectionWide} aria-labelledby="home-requests">
        <div className={styles.sectionHead}>
          <h2 id="home-requests" className={styles.h2}>Your requests</h2>
          {anyHistory ? (
            <Link href={`${base}/activity`} className={styles.viewAll}>View all</Link>
          ) : null}
        </div>
        {asked.length ? (
          <ul className={styles.requests}>
            {asked.map((row) => (
              <li key={row.id}>
                <Link href={row.href} className={styles.request}>
                  <span className={styles.requestDot} data-moving={row.moving} aria-hidden="true" />
                  <span className={styles.requestBody}>
                    <span className={styles.requestTitle}>{row.title}</span>
                    <span className={styles.requestSub}>{row.sub}</span>
                  </span>
                  {row.when ? (
                    <span
                      className={styles.requestWhen}
                      data-moving={row.moving}
                      data-late={row.late}
                    >
                      {row.when}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.quiet}>Nothing on its way. Anything you ask for shows up here.</p>
        )}
      </section>

      <section className={styles.sectionWide} aria-labelledby="home-services">
        <h2 id="home-services" className={`${styles.h2} ${styles.h2Alone}`}>At your service</h2>
        <nav className={styles.tiles} aria-label="Services">
          {TILES.map((tile) => (
            <Link
              key={tile.key}
              href={`${base}/${tile.path}`}
              className={styles.tile}
              data-lit={tile.key === 'service'}
            >
              <span className={styles.tileIcon}>
                <TileIcon name={tile.key} />
              </span>
              <span className={styles.tileBody}>
                <span className={styles.tileTitle}>{tile.title}</span>
                <span className={styles.tileSub}>{tileSub(tile.key, tile.sub)}</span>
              </span>
            </Link>
          ))}
        </nav>
      </section>

      {/*
        The dock: the one button, pinned, over the four tabs. The button stays a
        link when the kitchen is shut: the menu, the prices and the hours are
        all readable with the kitchen closed (#9 — never gate browsing), and the
        line under it says so rather than the button refusing.
      */}
      <div className={styles.dock}>
        <Link href={`${base}/menu`} className={styles.orderBar} data-open={isOpen}>
          <span className={styles.orderText}>
            <span className={styles.orderTitle}>
              Order {mealFor(hour)} to Room {session.roomNumber}
            </span>
            {kitchenLine ? <span className={styles.orderSub}>{kitchenLine}</span> : null}
          </span>
          <span className={styles.orderArrow} aria-hidden="true">
            <ArrowRight size={18} strokeWidth={1.8} />
          </span>
        </Link>
        <DockNav base={base} />
      </div>
    </main>
  );
}

/**
 * The In-room dining tile's line — "Until 1am" while the kitchen is open,
 * when it next opens while it is not. The same state the order bar reads.
 */
function diningHours(state: OutletOpenState): string {
  if (state.isOpen && state.closesAt) return `Until ${formatClock(state.closesAt)}`;
  if (!state.nextOpen) return 'Kitchen closed';
  return state.nextOpen.today
    ? `Opens at ${formatClock(state.nextOpen.opensAt)}`
    : `Opens ${dayName(state.nextOpen.dayOfWeek)} at ${formatClock(state.nextOpen.opensAt)}`;
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
 * The line under the greeting. The board's "We hope you slept well" is a
 * morning sentence, so it is only said in the greeting's morning band.
 */
function subtitleFor(hour: number): string {
  if (hour < 5) return 'Whatever you need tonight, it is a tap away.';
  if (hour < 12) return 'We hope you slept well. Everything is ready when you are.';
  if (hour < 17) return 'Everything is ready when you are.';
  return 'Settle in. Everything is ready when you are.';
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
