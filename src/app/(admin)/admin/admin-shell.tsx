import Link from 'next/link';
import {
  ArrowUpRight, BedDouble, Building2, ChefHat, ConciergeBell, DoorOpen,
  Footprints, LayoutDashboard, Link2, ListChecks, MonitorPlay, SprayCan,
  UtensilsCrossed, Users, type LucideIcon,
} from 'lucide-react';
import { can, type StaffSession, type Permission } from '@/modules/identity';
import { Alerts } from '@/components/alerts';
import { signOut } from './actions';
import { ConsoleRail } from './console-rail';
import styles from './admin.module.css';

/**
 * The ops console's frame.
 *
 * A component rather than a `layout.tsx`, deliberately: a layout at this level
 * would also wrap `/admin/login` and `/admin/invite`, and putting a signed-in
 * navigation rail with a sign-out button around a sign-in form is the kind of
 * thing that looks fine until someone screenshots it.
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
export type AdminSection =
  | 'home' | 'desk' | 'rooms' | 'checkouts'
  | 'menu' | 'requests' | 'outlet' | 'links'
  | 'property' | 'staff';

interface NavItem {
  href: string;
  label: string;
  /** A mark the eye can find before it has read the word. */
  icon: LucideIcon;
  section?: AdminSection;
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
      { href: '/admin', label: 'Overview', icon: LayoutDashboard, section: 'home' },
      /* The desk's one-room view. Above the key rack because it is where
         somebody answering a phone starts, and the rack is where somebody
         walking a floor starts. */
      { href: '/admin/desk', label: 'Front desk', icon: ConciergeBell, section: 'desk', needs: 'stay:read' },
      { href: '/admin/rooms', label: 'Rooms', icon: BedDouble, section: 'rooms', needs: 'stay:read' },
      { href: '/admin/checkouts', label: 'Leaving', icon: DoorOpen, section: 'checkouts', needs: 'stay:read' },
    ],
  },
  {
    title: 'Service',
    items: [
      { href: '/admin/menu', label: 'Menu', icon: UtensilsCrossed, section: 'menu', needs: 'catalog:read' },
      { href: '/admin/requests', label: 'Requests', icon: ListChecks, section: 'requests', needs: 'request:read' },
      { href: '/admin/outlet', label: 'The kitchen', icon: ChefHat, section: 'outlet', needs: 'catalog:read' },
      /* D-079. Under Service rather than Setup: a table tent is reprinted
         mid-service by whoever is running the floor, not configured once by
         whoever set the property up. */
      { href: '/admin/links', label: 'Links', icon: Link2, section: 'links', needs: 'catalog:read' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { href: '/admin/property', label: 'Property', icon: Building2, section: 'property', needs: 'room:read' },
      { href: '/admin/staff', label: 'Staff', icon: Users, section: 'staff', needs: 'staff:read' },
    ],
  },
  {
    title: 'Floor screens',
    items: [
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
  /** Which nav item is the current page. */
  current,
  children,
}: {
  session: StaffSession;
  propertyId: string;
  propertyName: string;
  current: AdminSection;
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
                <Link
                  key={item.href}
                  href={item.href}
                  className={styles.navLink}
                  aria-current={
                    item.section && item.section === current ? 'page' : undefined
                  }
                >
                  <item.icon
                    className={styles.navIcon}
                    size={18}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className={styles.navLabel}>{item.label}</span>
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
                </Link>
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
