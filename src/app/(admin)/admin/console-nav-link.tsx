'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './admin.module.css';

/**
 * A console menu item that knows, from the URL, whether it is the page.
 *
 * The rail now lives in the console's LAYOUT, which renders once and stays
 * across navigations; a layout is not told which page is inside it. So the
 * current item is read from the pathname, client-side: `/admin` exactly for
 * the overview, and the item's own path or anything under it for the rest
 * (`/admin/menu/offers` is still Menu).
 */
export function ConsoleNavLink({
  href,
  exact = false,
  children,
}: {
  href: string;
  /** Only this path, not the paths under it. The overview's `/admin`. */
  exact?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={styles.navLink} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}
