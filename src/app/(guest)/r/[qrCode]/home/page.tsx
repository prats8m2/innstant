import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { withTenant } from '@/db';
import { resolveGuestSession, GUEST_SESSION_COOKIE } from '@/modules/access';
import { DEMO_NAME_COOKIE, DEMO_FLAG_COOKIE } from '@/modules/demo';
import { findProperty } from '@/modules/identity';
import {
  getInRoomDiningOutlet, getOutletHours, outletOpenState, describeOpenState,
} from '@/modules/catalog';
import { listOrdersForStay, orderStateFor, OPEN_TO_A_GUEST } from '@/modules/ordering';
import { getRequestsForStay, REQUEST_OPEN_TO_A_GUEST } from '@/modules/requests';
import { localTimeAt, formatClock, formatCheckoutDay } from '@/lib/clock';
import styles from './room-home.module.css';

/**
 * The room home — the post-scan landing, and the only screen most guests see.
 *
 * Rebuilt from the "The Kesari" design document as real components; the export
 * is a picture to match, not markup to copy (design/README.md). Every value
 * comes from `src/styles/theme.css` — there is no hex, radius or duration in
 * this file.
 *
 * CLAUDE.md #9: this renders for an anonymous REQUEST-tier session with nothing
 * in the way. No login, no verification, no onboarding.
 *
 * ─── D-051: the stack became a grid ────────────────────────────────────────
 *
 * It was a column of full-width cards — a hero card for dining, then four rows
 * with chevrons. The design is a different shape and a better one for a thumb:
 * a masthead, an arch-topped hero that says what the kitchen is doing, a
 * greeting, a 2×2 grid of tiles, and ONE fixed button at the bottom.
 *
 * The fixed button is the point. Ordering food is what this product is for, and
 * in the old layout it was a card that scrolled away. Now it is always under
 * the thumb and it always says what the kitchen can actually do right now.
 */
export const dynamic = 'force-dynamic';

/**
 * The four tiles, verbatim from the export (design/README.md — the copy is part
 * of the design, not filler).
 *
 * `built` says whether the tile goes anywhere yet — a tile that looks tappable
 * and does nothing is worse than one that says it is coming.
 *
 * All four are built now. The fourth was "Nearby · soon" until the concierge
 * list got a read path (D-069); it is "Plan my day" because that is what the
 * screen does with the list, and because "nearby" is a distance while a day is
 * a plan.
 */
const TILES = [
  { key: 'amenities', title: 'Amenities', sub: 'Towels · laundry · a charger', built: true },
  { key: 'service', title: 'Call for service', sub: 'Someone comes up', built: true },
  { key: 'stay', title: 'Your stay', sub: 'When you leave, what is owed', built: true },
  { key: 'nearby', title: 'Plan my day', sub: 'Where we send our friends', built: true },
] as const;

export default async function RoomHome({
  params,
}: {
  params: Promise<{ qrCode: string }>;
}) {
  const { qrCode } = await params;
  const store = await cookies();
  const session = await resolveGuestSession(store.get(GUEST_SESSION_COOKIE)?.value);

  /**
   * Who is actually holding the phone.
   *
   * On a real stay this is nobody — neither cookie exists — and the greeting
   * uses the name on the stay, which is the whole of D-059. A visitor who came
   * through the website has no stay of their own to be named by, so they are
   * greeted by the name they typed at `/demo` instead of by Anjali Menon's,
   * which would be a strange thing to call a stranger.
   *
   * Both cookies are cosmetic by construction: the tier that lets this session
   * order without the phone-digits prompt is on the `guest_sessions` row, set
   * server-side in /demo/enter. Forging these two changes a heading. See the
   * note on the cookie names in `modules/demo`.
   */
  const isDemo = store.get(DEMO_FLAG_COOKIE)?.value === '1';
  const demoName = isDemo ? (store.get(DEMO_NAME_COOKIE)?.value ?? null) : null;

  // Cookie missing or stale — checked out, expired, revoked. Send them back
  // through the link, which issues a fresh session or 404s (#10).
  if (!session) redirect(`/r/${encodeURIComponent(qrCode)}`);

  const base = `/r/${encodeURIComponent(qrCode)}`;

  /**
   * The property's own name and its own hours.
   *
   * Both were literals — "The Kesari" and "Kitchen open until 11:30pm" — from
   * S2, when there was no data to read. A second hotel would have been greeted
   * by the first one's name, and the closing time never matched the seeded rows
   * it was supposedly describing.
   */
  const { property, outletName, kitchen, isOpen, orders, requests } = await withTenant(
    { tenantId: session.tenantId, propertyId: session.propertyId },
    async (tx) => {
      const found = await findProperty(tx, session.propertyId);
      const outlet = await getInRoomDiningOutlet(tx, session.propertyId);
      const timeZone = found?.timezone ?? 'Asia/Kolkata';
      // Everything this room has asked for — food AND amenities. The answer
      // decides whether this screen has a way back to something in progress.
      const placed = await listOrdersForStay(tx, { stayId: session.stayId });
      const asked = await getRequestsForStay(tx, { stayId: session.stayId });

      if (!outlet) {
        return {
          property: found,
          outletName: null,
          kitchen: null,
          isOpen: false,
          orders: placed,
          requests: asked,
        };
      }

      const state = outletOpenState(
        await getOutletHours(tx, outlet.id),
        localTimeAt(new Date(), timeZone),
      );
      return {
        property: found,
        outletName: outlet.name,
        kitchen: describeOpenState(state, formatClock),
        isOpen: state.isOpen,
        orders: placed,
        requests: asked,
      };
    },
  );

  const timeZone = property?.timezone ?? 'Asia/Kolkata';
  const hour = localTimeAt(new Date(), timeZone).minutes / 60;

  /**
   * "until Thursday, 11am" — the reference's own words, from the stay rather
   * than from a literal, in the PROPERTY's timezone.
   *
   * `formatCheckoutDay` rather than an `Intl` call inlined here: the stay screen
   * prints the same sentence, and two copies of a date format is how one of them
   * quietly starts saying 11:00am.
   */
  const checkout = formatCheckoutDay(session.scheduledCheckoutAt, timeZone);

  /** The visitor's own name wins over the stay's — see the note at the top. */
  const callThem = demoName ?? session.guestFirstName;

  /**
   * The way back to something already asked for.
   *
   * This screen is where both tracking screens' back buttons land, and until
   * there was a list it was the end of the road: nothing on the room home led
   * to an order or a request, so pressing back lost the thing you had just
   * asked for.
   *
   * It counts FOOD AND AMENITIES together (D-058). A guest with a dinner
   * coming and towels coming has two things happening, not one, and a strip
   * that only knew about dinner sent them to a list where the towels were a
   * surprise.
   *
   * With exactly one thing moving it goes straight to that thing's own screen —
   * one tap, which is what somebody wants. With several, or with none moving
   * and some history, it goes to the list.
   */
  const movingOrders = orders.filter((order) => OPEN_TO_A_GUEST.includes(order.status));
  const movingRequests = requests
    .filter((request) => REQUEST_OPEN_TO_A_GUEST.includes(request.status));
  const moving = movingOrders.length + movingRequests.length;
  const everything = orders.length + requests.length;

  const only = moving === 1
    ? movingOrders[0]
      ? {
        href: `${base}/order/${movingOrders[0].id}`,
        label: orderStateFor(movingOrders[0].status).short,
        detail: movingOrders[0].summary,
      }
      : movingRequests[0]
        ? {
          href: `${base}/service/${movingRequests[0].id}`,
          label: 'Someone is on the way',
          detail: movingRequests[0].lines.map((line) => line.label).join(' · '),
        }
        : null
    : null;

  const trail = only
    ? { ...only, live: true }
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

  return (
    <main className={styles.shell}>
      {/*
        The way back out, for somebody who arrived from the website.

        A real guest never sees this: they got here from a sticker in a room
        they are standing in, and there is nowhere for them to go back to. A
        visitor has a site they were reading a moment ago, and the alternative
        to a line like this is trapping them in a hotel app with no exit and no
        explanation of whose hotel it is.

        One line, above the property's own name rather than inside it — The
        Kesari does not have a demo ribbon; this session does.
      */}
      {isDemo ? (
        <p className={styles.demoRibbon}>
          <span>Demo · seeded data</span>
          <Link href="/">Back to Innstant</Link>
        </p>
      ) : null}

      <header className={styles.masthead}>
        {/* The property's own name, not a literal. */}
        <p className={styles.wordmark}>{property?.name ?? 'Your stay'}</p>
        <p className={`${styles.roomChip} tabular`}>Room {session.roomNumber}</p>
      </header>

      {/*
        The arch. It is the one piece of ornament in the guest app and it is
        load-bearing: it is the shape of a haveli doorway, it is what makes this
        not a template, and the same curve returns on every dish thumbnail and
        on the tracking screen.

        Drawn rather than photographed because it must work before R2 exists
        (image upload is still blocked) and because it costs no request on hotel
        wifi — but drawn in SVG, not in stacked radial-gradients. The gradient
        version produced four enormous circles struck from below the box, which
        at this aspect ratio read as a vinyl record rather than as a doorway,
        and the diagonal hatch over the top of them turned the whole header into
        noise.

        These are three nested arches on a common springline: a leg, an
        elliptical head, a leg. `preserveAspectRatio="none"` on purpose: the
        card is wider than the 358 the viewBox is drawn at, and `slice` cropped
        the outer arch's crown clean off. They are abstract ellipses, so letting
        them stretch with the card keeps the composition whole at every width —
        which is the thing that matters — and an 11% horizontal stretch on a
        curve nobody is measuring is invisible.
      */}
      <section className={styles.arch} aria-labelledby="kitchen-state">
        <svg
          className={styles.archArt}
          viewBox="0 0 358 180"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            {/* Lamplight at the foot of the doorway. */}
            <radialGradient id="kesari-arch-glow" cx="50%" cy="100%" r="66%">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="55%" stopColor="var(--accent)" stopOpacity="0.05" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="358" height="180" fill="url(#kesari-arch-glow)" />
          <g fill="none" strokeLinecap="round">
            <path className={styles.archOuter} d="M26 180 V172 A153 112 0 0 1 332 172 V180" />
            <path className={styles.archMid} d="M66 180 V172 A113 86 0 0 1 292 172 V180" />
            <path className={styles.archInner} d="M106 180 V174 A73 60 0 0 1 252 174 V180" />
          </g>
        </svg>
        <div className={styles.archWash} aria-hidden="true" />
        <div className={styles.archBody}>
          {outletName ? <p className={styles.archEyebrow}>{outletName}</p> : null}
          <p className={styles.archTitle} id="kitchen-state">
            {kitchen ?? 'In-room dining is not set up here yet'}
          </p>
        </div>
      </section>

      <div className={styles.greeting}>
        {/*
          By name, when the stay has one.

          This screen shipped without it and listed the trade as an open
          question: the export greets "Good evening, Anjali", the stay behind
          the session does know who that is, and nothing guest-facing had ever
          shown the occupant's name — so a sticker photographed from a corridor
          would be greeted by it. That was decided in favour of the greeting
          (D-059): the sticker is inside the room, the same scan already opens
          the menu and the folio prompt, and a hotel that cannot say your name
          is not hosting you.

          Falls back to the bare greeting when the stay has no usable name —
          a walk-in entered as "Guest", a blank field. "Good evening," with a
          dangling comma is worse than "Good evening".
        */}
        <h1 className={styles.greetingText}>
          {callThem ? `${greetingFor(hour)}, ${callThem}` : greetingFor(hour)}
        </h1>
        <p className={styles.stayLine}>
          Room {session.roomNumber} until {checkout}.
        </p>
      </div>

      {/*
        Above the tiles rather than among them: the tiles are four doors, and
        this is news. It also keeps the export's 2×2 intact — a fifth tile would
        have made it a 2×3 with a hole in it.
      */}
      {trail ? (
        <Link href={trail.href} className={styles.trail} data-live={trail.live}>
          <span className={styles.trailBody}>
            <span className={styles.trailLabel}>
              {trail.live ? <span className={styles.trailPulse} aria-hidden="true" /> : null}
              {trail.label}
            </span>
            <span className={styles.trailDetail}>{trail.detail}</span>
          </span>
          <span className={styles.trailChevron} aria-hidden="true">→</span>
        </Link>
      ) : null}

      <nav className={styles.tiles} aria-label="Services">
        {TILES.map((tile) => {
          const body = (
            <>
              <span className={styles.tileArch} aria-hidden="true" />
              <span className={styles.tileBody}>
                <span className={styles.tileTitle}>{tile.title}</span>
                <span className={styles.tileSub}>
                  {tile.built ? tile.sub : `${tile.sub} · soon`}
                </span>
              </span>
            </>
          );

          return tile.built ? (
            <Link key={tile.key} href={`${base}/${tile.key}`} className={styles.tile}>
              {body}
            </Link>
          ) : (
            /* Not a link. A tile that looks tappable and does nothing is worse
               than a tile that says it is coming. */
            <span key={tile.key} className={styles.tile} data-soon="true">{body}</span>
          );
        })}
      </nav>

      <p className={styles.charged}>Charged to room {session.roomNumber}</p>

      {/*
        The one button, pinned. Ordering is what this product is for, and in the
        layout this replaced it was a card that scrolled off the screen.

        It stays a link when the kitchen is shut: the menu, the prices and the
        hours are all readable with the kitchen closed (#9 — never gate
        browsing), and the second line says so rather than the button refusing.
      */}
      <div className={styles.cta}>
        <Link href={`${base}/menu`} className={styles.ctaButton} data-open={isOpen}>
          <span className={styles.ctaTitle}>
            Order {mealFor(hour)} to room {session.roomNumber}
          </span>
          {kitchen ? <span className={styles.ctaSub}>{kitchen}</span> : null}
        </Link>
      </div>
    </main>
  );
}

/**
 * The greeting, on the PROPERTY's clock.
 *
 * Bands rather than a single cutoff because "Good evening" at 4pm is wrong in
 * the same way "Good afternoon" at 9pm is. The export shows the evening case,
 * which is when most people scan the sticker.
 */
function greetingFor(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Which meal the button offers.
 *
 * The export says "Order dinner to room 214", which is right at 9pm and wrong
 * at 8am — and this screen is open at both. The menu behind it is the same one
 * either way; only the word changes.
 */
function mealFor(hour: number): string {
  if (hour < 11) return 'breakfast';
  if (hour < 16) return 'lunch';
  return 'dinner';
}
