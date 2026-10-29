import Link from 'next/link';
import {
  Activity, ArrowUpRight, BedDouble, Building2, ConciergeBell, DoorOpen,
  Footprints, LayoutDashboard, Link2, ListChecks, MonitorPlay, SprayCan,
  UtensilsCrossed, Users, type LucideIcon,
} from 'lucide-react';
import { can, type StaffSession, type Permission } from '@/modules/identity';
import { Alerts } from '@/components/alerts';
import { signOut } from './actions';
import { ConsoleRail } from './console-rail';
import { ConsoleNavLink } from './console-nav-link';
import { NavPending } from './nav-pending';
import styles from './admin.module.css';

/**
 * The ops console's frame.
 *
 * Rendered by the console's `layout.tsx`, once, and kept across navigations.
 * It was a component every page wrapped itself in, so that the sign-in and
 * invite pages would not get a rail; those now live in their own route group,
 * `(staff-auth)`, at the same URLs. Which item is current is read from the
 * URL (`ConsoleNavLink`), because a layout is not told which page it holds.
 *
 * ─── Why a rail and not the top bar it replaced ────────────────────────────
 *
 * The bar was a single wrapping row of every link. It had already broken a page
 * once: a sixth item made it two lines at 412px, and because it is sticky the
 * overflow sat on top of the content and swallowed clicks on a screen nobody was
 * looking at. The fix at the time was `flex-wrap` and a `min-height`, which
 * stopped the breakage without addressing the cause — a flat list of eight
 * destinations with no hierarchy, in the one axis a console has least of.
 *
 * A rail has the axis to spare, gives the groups names, and leaves the top of
 * every page for that page. Below 1024px its head becomes a sticky top bar and
 * the groups fold into a drawer under it (`console-rail.tsx` says why the
 * scrolling strip that used to be here had to go).
 *
 * ─── Why it is filtered by permission ──────────────────────────────────────
 *
 * It only lists what this account can actually open. The front desk could
 * previously see Menu, Property and Staff, and got a refusal page from each —
 * and a console full of links that refuse is how staff learn not to trust the
 * console. The overview cards have always been filtered this way; the navigation
 * was not.
 *
 * This is presentation, never enforcement: every page re-checks server-side and
 * every action checks again (`adminAccess`, `requirePermission`).
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
      { href: '/admin', label: 'Overview', icon: LayoutDashboard },
      /* The desk's one-room view. Above the key rack because it is where
         somebody answering a phone starts, and the rack is where somebody
         walking a floor starts. */
      { href: '/admin/desk', label: 'Front desk', icon: ConciergeBell, needs: 'stay:read' },
      { href: '/admin/rooms', label: 'Rooms', icon: BedDouble, needs: 'stay:read' },
      { href: '/admin/checkouts', label: 'Leaving', icon: DoorOpen, needs: 'stay:read' },
    ],
  },
  {
    title: 'Service',
    items: [
      { href: '/admin/menu', label: 'Menu', icon: UtensilsCrossed, needs: 'catalog:read' },
      { href: '/admin/requests', label: 'Requests', icon: ListChecks, needs: 'request:read' },
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
      { href: '/kds', label: 'Kitchen display', icon: MonitorPlay, needs: 'order:read', away: true },
      { href: '/runner', label: 'Runner', icon: Footprints, needs: 'order:read', away: true },
      /* The board the overview's "Requests open" card already led to, and the
         one floor screen the rail did not list. */
      { href: '/housekeeping', label: 'Housekeeping', icon: SprayCan, needs: 'request:read', away: true },
    ],
  },
];

export async function AdminShell({
  session,
  propertyId,
  propertyName,
  children,
}: {
  session: StaffSession;
  propertyId: string;
  propertyName: string;
  children: React.ReactNode;
}) {
  const groups = GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.needs || can(session, propertyId, item.needs)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className={styles.frame}>
      <ConsoleRail
        head={
          <>
            <Link href="/admin" className={styles.brand}>
              {propertyName}
            </Link>
            <span className={styles.brandSub}>Ops console</span>
          </>
        }
        /* Once, in the head. It holds a live stream, and in the head it is
           in the top bar on a phone and beside the name on a desk. */
        bell={<Alerts session={session} propertyId={propertyId} placement="rail" />}
      >
        <nav className={styles.nav} aria-label="Console">
          {groups.map((group) => (
            <div key={group.title} className={styles.navGroup}>
              <p className={styles.navGroupTitle}>{group.title}</p>
              {group.items.map((item) => (
                <ConsoleNavLink key={item.href} href={item.href} exact={item.href === '/admin'}>
                  <item.icon
                    className={styles.navIcon}
                    size={18}
                    strokeWidth={1.75}
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
                      strokeWidth={1.75}
                      aria-label="opens a floor screen"
                    />
                  ) : null}
                </ConsoleNavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.railFoot}>
          {/* The name is the part that tells somebody which account a shared
              back-office machine is signed in to, so it gets its own line. */}
          <span className={styles.whoName}>{session.fullName}</span>
          {/* A form, not a link: signing out is a mutation, and a GET that
              revokes a session can be fired by a prefetch. */}
          <form action={signOut}>
            <button type="submit" className={styles.signOut}>Sign out</button>
          </form>
        </div>
      </ConsoleRail>

      <div className={styles.canvas}>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
