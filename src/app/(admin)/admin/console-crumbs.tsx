'use client';

import { usePathname } from 'next/navigation';
import styles from './admin.module.css';

export interface CrumbTarget {
  href: string;
  label: string;
  group: string;
}

/**
 * "Today / Overview" at the head of the top bar: which group, which page.
 *
 * Read from the URL, like the current nav item, because the frame is a layout
 * and is not told which page it holds. The longest nav path that contains the
 * URL wins, so `/admin/checkouts/<stay>` is still Today / Leaving. A page
 * the nav does not list says what it is from `EXTRA` instead.
 *
 * Text, not links and not a landmark: the nav beside it is the way around,
 * and a second `navigation` landmark would be one more stop for a screen
 * reader that has nothing different in it.
 */
const EXTRA: CrumbTarget[] = [
  { href: '/admin/guests', label: 'Guest', group: 'Today' },
];

export function ConsoleCrumbs({ targets }: { targets: CrumbTarget[] }) {
  const pathname = usePathname();
  const match = [...targets, ...EXTRA]
    .filter((t) => (t.href === '/admin'
      ? pathname === '/admin'
      : pathname === t.href || pathname.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];

  if (!match) return <span className={styles.crumbs} />;
  return (
    <p className={styles.crumbs}>
      <span className={styles.crumbGroup}>{match.group}</span>
      <span className={styles.crumbSep} aria-hidden="true">/</span>
      <span className={styles.crumbPage}>{match.label}</span>
    </p>
  );
}
