import { Skeleton, SkeletonScreen } from '@/components/skeleton';
import styles from './room-home.module.css';

/**
 * The room home, waiting (D-077: a skeleton shaped like its own page).
 *
 * Midnight's shape: the wordmark, the arch (drawn, not greyed — the doorway is
 * ornament the page owns, not data it is waiting for), the stay strip, the
 * four tiles and the dock. The tiles are empty boxes of the right size: an
 * icon and two short lines are coming, and bars for those would be busier
 * than the tiles they stand in for.
 */
export default function LoadingRoomHome() {
  return (
    <SkeletonScreen label="Loading your room">
      <div className={styles.skeleton}>
        <div className={styles.skeletonMast}>
          <Skeleton w="140px" h="1rem" />
        </div>

        <div className={styles.heroWrap}>
          <div className={styles.hero}>
            <span className={styles.heroInner} aria-hidden="true" />
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.skeletonStrip} />
        </div>

        <div className={styles.sectionWide}>
          <div className={styles.tiles}>
            {[0, 1, 2, 3].map((i) => <div key={i} className={styles.tile} />)}
          </div>
        </div>

        <div className={styles.skeletonDock}>
          <div className={styles.skeletonBar} />
          <div className={styles.skeletonTabs} />
        </div>
      </div>
    </SkeletonScreen>
  );
}
