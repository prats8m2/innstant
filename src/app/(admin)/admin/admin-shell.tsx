import Link from 'next/link';
import {
  Activity, ArrowUpRight, BedDouble, BellRing, Building2, ChefHat, ConciergeBell,
  Footprints, LayoutGrid, Link2, LogOut, Sparkle, UtensilsCrossed, Users,
  type LucideIcon,
} from 'lucide-react';
import { can, type ConsoleChrome, type StaffSession, type Permission } from '@/modules/identity';
import { Alerts } from '@/components/alerts';
import { SessionWatch } from '@/components/session-watch';
import { signOut } from './actions';
import { ConsoleRail } from './console-rail';
import { ConsoleNavLink } from './console-nav-link';
import { ConsoleCrumbs, type CrumbTarget } from './console-crumbs';
import { ConsoleSearch, SearchField, SearchIconButton } from './console-search';
import { AppearanceToggle, ConsoleFrame } from './appearance-toggle';
import { NavPending } from './nav-pending';
import styles from './admin.module.css';

/**
 * The ops console's frame (Direction A, D-100): a sidebar of named groups, a
 * top bar with where you are, search, your light or dark, and the bell.
 *
 * Rendered by the console's `layout.tsx`, once, and kept across navigations.
 * Which item is current, and the breadcrumb, are read from the URL
 * (`ConsoleNavLink`, `ConsoleCrumbs`), because a layout is not told which
 * page it holds.
 *
 * ─── Why a sidebar and not the top bar it once replaced ────────────────────
 *
 * A single wrapping row of every link had already broken a page once: a
 * sixth item made it two lines at 412px, and because it was sticky the
 * overflow sat on top of the content and swallowed clicks. A sidebar has the
 * axis to spare, gives the groups names, and leaves the top of every page for
 * that page. Below 1024px it folds into a drawer (`console-rail.tsx`).
 *
 * ─── Why it is filtered by permission ──────────────────────────────────────
 *
 * It only lists what this account can actually open. The front desk could
 * once see Menu, Property and Staff, and got a refusal page from each — and a
 * console full of links that refuse is how staff learn not to trust it.
 *
 * This is presentation, never enforcement: every page re-checks server-side
 * and every action checks again (`adminAccess`, `requirePermission`).
 *
 * ─── What the board has that this does not ─────────────────────────────────
 *
 * Count badges on items ("Leaving 2", "Requests 1 late") are not drawn: the
 * frame renders once per visit and is not refreshed by the pages' live
 * streams, so a count here would go stale while the page under it moved.
 * The property card is not a switcher: an account sees its first property
 * (`adminAccess`), and a chevron that opens nothing would be a lie.
 */
interface NavItem {
  href: string;
  label: string;
  /** A mark the eye can find before it has read the word. */
  icon: LucideIcon;
  /** Everything here is visible without a permission. */
  needs?: Permission;
  /** Opens one of the always-on floor screens rather than a console page. */
  away?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: 'Today',
    items: [
      { href: '/admin', label: 'Overview', icon: LayoutGrid },
      /* The desk's one-room view. Above the key rack because it is where
         somebody answering a phone starts, and the rack is where somebody
         walking a floor starts. */
      { href: '/admin/desk', label: 'Front desk', icon: ConciergeBell, needs: 'stay:read' },
      { href: '/admin/rooms', label: 'Rooms', icon: BedDouble, needs: 'stay:read' },
      { href: '/admin/checkouts', label: 'Leaving', icon: LogOut, needs: 'stay:read' },
    ],
  },
  {
    title: 'Service',
    items: [
      { href: '/admin/menu', label: 'Menu', icon: UtensilsCrossed, needs: 'catalog:read' },
      { href: '/admin/requests', label: 'Requests', icon: BellRing, needs: 'request:read' },
      /* D-079. Under Service rather than Setup: a table tent is reprinted
         mid-service by whoever is running the floor, not configured once by
         whoever set the property up. */
      { href: '/admin/links', label: 'Links', icon: Link2, needs: 'catalog:read' },
    ],
  },
  {
    title: 'Setup',
    items: [
      /* `property:read`, not `room:read`: Hours & service lives here now (the
         kitchen's settings moved in, D-087) and the F&B manager who owns them
         holds no room permission. Each section asks for its own. */
      { href: '/admin/property', label: 'Property', icon: Building2, needs: 'property:read' },
      { href: '/admin/staff', label: 'Staff', icon: Users, needs: 'staff:read' },
    ],
  },
  {
    title: 'Floor screens',
    items: [
      /* The one entry here that is a console page: the floor as a manager sees
         it — every ticket's stage and age, who is on shift, what is slow. */
      { href: '/admin/floor', label: 'Live floor', icon: Activity, needs: 'order:read' },
      { href: '/kds', label: 'Kitchen display', icon: ChefHat, needs: 'order:read', away: true },
      { href: '/runner', label: 'Runner', icon: Footprints, needs: 'order:read', away: true },
      { href: '/housekeeping', label: 'Housekeeping', icon: Sparkle, needs: 'request:read', away: true },
    ],
  },
];

/** "Vikram Rathore" → "VR"; one name gives one letter. */
function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

export async function AdminShell({
  session,
  propertyId,
  chrome,
  children,
}: {
  session: StaffSession;
  propertyId: string;
  chrome: ConsoleChrome;
  children: React.ReactNode;
}) {
  const groups = GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.needs || can(session, propertyId, item.needs)),
    }))
    .filter((group) => group.items.length > 0);

  const crumbs: CrumbTarget[] = groups.flatMap((group) => group.items
    .filter((item) => !item.away)
    .map((item) => ({ href: item.href, label: item.label, group: group.title })));

  const place = [
    chrome.city,
    `${chrome.roomCount} ${chrome.roomCount === 1 ? 'room' : 'rooms'}`,
  ].filter(Boolean).join(' · ');

  const rail = (
    <>
      <Link href="/admin" className={styles.propertyCard}>
        <span className={styles.propertyMark} aria-hidden="true">
          {/* The jharokha arch, drawn: it is the brand, not an icon. */}
          <svg width="14" height="18" viewBox="0 0 200 260" focusable="false">
            <path
              d="M10 260 V110 C10 60 55 32 100 10 C145 32 190 60 190 110 V260"
              fill="none"
              stroke="currentColor"
              strokeWidth="20"
            />
          </svg>
        </span>
        <span className={styles.propertyText}>
          <span className={styles.propertyName}>{chrome.propertyName}</span>
          <span className={styles.propertyMeta}>{place}</span>
        </span>
      </Link>

      <SearchField />

      <nav className={styles.nav} aria-label="Console">
        {groups.map((group) => (
          <div key={group.title} className={styles.navGroup}>
            <p className={styles.navGroupTitle}>{group.title}</p>
            {group.items.map((item) => (
              <ConsoleNavLink key={item.href} href={item.href} exact={item.href === '/admin'}>
                <item.icon
                  className={styles.navIcon}
                  size={17}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <span className={styles.navLabel}>{item.label}</span>
                {/* Floor screens open in full; the console's own pages get
                    the "loading" mark while they arrive. */}
                {item.away ? null : <NavPending />}
                {/* An always-on floor screen, not a console page. Said in the
                    nav because arriving at a full-screen ticket rail you did
                    not expect is disorienting on a desk. */}
                {item.away ? (
                  <ArrowUpRight
                    className={styles.navAway}
                    size={14}
                    strokeWidth={1.5}
                    aria-label="opens a floor screen"
                  />
                ) : null}
              </ConsoleNavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className={styles.railFoot}>
        <span className={styles.whoAvatar} aria-hidden="true">{initials(session.fullName)}</span>
        {/* The name is the part that tells somebody which account a shared
            back-office machine is signed in to. */}
        <span className={styles.whoText}>
          <span className={styles.whoName}>{session.fullName}</span>
          {chrome.roleNames.length ? (
            <span className={styles.whoRole}>{chrome.roleNames.join(' · ')}</span>
          ) : null}
        </span>
        {/* A form, not a link: signing out is a mutation, and a GET that
            revokes a session can be fired by a prefetch. */}
        <form action={signOut}>
          <button type="submit" className={styles.signOut} aria-label="Sign out" title="Sign out">
            <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </form>
        <SessionWatch staffUserId={session.staffUserId} />
      </div>
    </>
  );

  const topBar = (
    <>
      <ConsoleCrumbs targets={crumbs} />
      <span className={styles.topSpacer} />
      <SearchIconButton />
      <AppearanceToggle />
      {/* Once, here. It holds a live stream. */}
      <div className={styles.bellSlot}>
        <Alerts session={session} propertyId={propertyId} placement="end" />
      </div>
    </>
  );

  return (
    <ConsoleFrame appearance={chrome.appearance} theme={chrome.theme} className={styles.frame}>
      <ConsoleRail rail={rail} topBar={topBar}>{children}</ConsoleRail>
      <ConsoleSearch propertyId={propertyId} />
    </ConsoleFrame>
  );
}
