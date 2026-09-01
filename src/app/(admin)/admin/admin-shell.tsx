import Link from 'next/link';
import type { StaffSession } from '@/modules/identity';
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
 */
export function AdminShell({
  session,
  propertyName,
  /** Which nav item is the current page. */
  current,
  children,
}: {
  session: StaffSession;
  propertyName: string;
  current: 'home' | 'menu';
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
        </nav>

        <span className={styles.who}>
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
