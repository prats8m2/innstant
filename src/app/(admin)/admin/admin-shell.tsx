import Link from 'next/link';
import type { StaffSession } from '@/modules/identity';
import { Alerts } from '@/components/alerts';
import { signOut } from './actions';
import styles from './admin.module.css';

/**
 * The ops console's frame.
 *
 * A component rather than a `layout.tsx`, deliberately: a layout at this level
 * would also wrap `/admin/login`, and putting a signed-in navigation bar with a
 * sign-out button around a sign-in form is the kind of thing that looks fine
 * until someone screenshots it.
 *
 * Desktop-first, unlike everything under `(guest)`. This is used sitting down.
 *
 * Async, because the alert bell lives here rather than in each page: the duty
 * manager's escalations should reach them on whichever admin screen they happen
 * to have open, and seven pages each remembering to load a bell is seven places
 * for one of them to forget.
 */
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
  current: 'home' | 'menu' | 'requests' | 'checkouts' | 'outlet';
  children: React.ReactNode;
}) {
  return (
    <div className={styles.frame}>
      <header className={styles.bar}>
        <Link href="/admin" className={styles.brand}>
          {propertyName}
        </Link>

        <nav className={styles.nav}>
          <Link
            href="/admin"
            className={styles.navLink}
            aria-current={current === 'home' ? 'page' : undefined}
          >
            Overview
          </Link>
          <Link
            href="/admin/menu"
            className={styles.navLink}
            aria-current={current === 'menu' ? 'page' : undefined}
          >
            Menu
          </Link>
          <Link
            href="/admin/requests"
            className={styles.navLink}
            aria-current={current === 'requests' ? 'page' : undefined}
          >
            Requests
          </Link>
          <Link
            href="/admin/checkouts"
            className={styles.navLink}
            aria-current={current === 'checkouts' ? 'page' : undefined}
          >
            Leaving
          </Link>
          <Link
            href="/admin/outlet"
            className={styles.navLink}
            aria-current={current === 'outlet' ? 'page' : undefined}
          >
            The kitchen
          </Link>
        </nav>

        <span className={styles.who}>
          <Alerts session={session} propertyId={propertyId} />
          <span className={styles.whoName}>{session.fullName}</span>
          {/* A form, not a link: signing out is a mutation, and a GET that
              revokes a session can be fired by a prefetch. */}
          <form action={signOut}>
            <button type="submit" className={styles.signOut}>Sign out</button>
          </form>
        </span>
      </header>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
