import Link from 'next/link';
import { can, type StaffSession, type Permission } from '@/modules/identity';
import { Alerts } from '@/components/alerts';
import { signOut } from './actions';
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
 * every page for that page. Below 960px it lies down into a scrolling strip
 * rather than wrapping, so it cannot cover anything.
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
  | 'home' | 'rooms' | 'checkouts'
  | 'menu' | 'requests' | 'outlet'
  | 'property' | 'staff';

interface NavItem {
  href: string;
  label: string;
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
      { href: '/admin', label: 'Overview', section: 'home' },
      { href: '/admin/rooms', label: 'Rooms', section: 'rooms', needs: 'stay:read' },
      { href: '/admin/checkouts', label: 'Leaving', section: 'checkouts', needs: 'stay:read' },
    ],
  },
  {
    title: 'Service',
    items: [
      { href: '/admin/menu', label: 'Menu', section: 'menu', needs: 'catalog:read' },
      { href: '/admin/requests', label: 'Requests', section: 'requests', needs: 'request:read' },
      { href: '/admin/outlet', label: 'The kitchen', section: 'outlet', needs: 'catalog:read' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { href: '/admin/property', label: 'Property', section: 'property', needs: 'room:read' },
      { href: '/admin/staff', label: 'Staff', section: 'staff', needs: 'staff:read' },
    ],
  },
  {
    title: 'Floor screens',
    items: [
      { href: '/kds', label: 'Kitchen display', needs: 'order:read', away: true },
      { href: '/runner', label: 'Runner', needs: 'order:read', away: true },
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
      <aside className={styles.rail}>
        <div className={styles.railHead}>
          <Link href="/admin" className={styles.brand}>
            {propertyName}
          </Link>
          <span className={styles.brandSub}>Ops console</span>
        </div>

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
                  <span className={styles.navLabel}>{item.label}</span>
                  {/* An always-on floor screen, not a console page. Said in the
                      nav because arriving at a full-screen ticket rail you did
                      not expect is disorienting on a desk. */}
                  {item.away ? <span className={styles.navAway} aria-hidden="true">↗</span> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.railFoot}>
          {/* Two lines, not one. A 228px rail holding a bell, a full name and a
              sign-out button truncated the name to "Vikra…" — and the name is
              the part that tells somebody which account a shared back-office
              machine is signed in to. */}
          <span className={styles.whoName}>{session.fullName}</span>
          <div className={styles.railFootRow}>
            <Alerts session={session} propertyId={propertyId} />
            {/* A form, not a link: signing out is a mutation, and a GET that
                revokes a session can be fired by a prefetch. */}
            <form action={signOut}>
              <button type="submit" className={styles.signOut}>Sign out</button>
            </form>
          </div>
        </div>
      </aside>

      <div className={styles.canvas}>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
