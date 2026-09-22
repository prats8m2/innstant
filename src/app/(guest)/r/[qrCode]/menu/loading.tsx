import { Skeleton, SkeletonCard, SkeletonHeading, SkeletonBar, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * The menu, waiting.
 *
 * The slowest guest screen and the one worth the most: it loads the outlet,
 * its editorial sections, every dish with its schedule, the outlet's hours
 * and the cart before it renders.
 *
 * No title on the bar — it is the outlet's own name ("Kesari Kitchen"), which
 * is data. Two sections of three dishes is the seeded shape and close enough
 * to any real one that the rail and the first card land where they were.
 */
export default function LoadingMenu() {
  return (
    <SkeletonScreen label="Loading the menu" className={styles.clearsPill}>
      <SkeletonBar trailing />

      <div className={styles.rail}>
        {['82px', '96px', '68px', '90px', '74px'].map((w) => (
          <Skeleton key={w} w={w} h="30px" radius="var(--radius-pill)" />
        ))}
      </div>

      {[0, 1].map((section) => (
        <section key={section} className={styles.stackWide}>
          <SkeletonHeading count />
          <div className={styles.stack}>
            {[0, 1, 2].map((dish) => <SkeletonCard key={dish} thumb />)}
          </div>
        </section>
      ))}

      <div className={styles.pinned}>
        <Skeleton w="100%" h="46px" radius="var(--radius-pill)" />
      </div>
    </SkeletonScreen>
  );
}
