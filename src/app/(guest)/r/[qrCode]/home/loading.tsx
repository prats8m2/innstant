import { Skeleton, SkeletonScreen } from '@/components/skeleton';
import styles from './room-home.module.css';

/**
 * The room home, waiting (D-077: a skeleton shaped like its own page).
 *
 * This is the screen a sticker scan lands on, so it is the one skeleton a
 * guest is most likely to see. The masthead, the arch beside the greeting,
 * the four tiles and the pinned button are the shape of it.
 *
 * The arch is drawn rather than greyed — the doorway is ornament the page
 * owns, not data it is waiting for. The tiles are empty boxes of the right
 * size: an icon and two short lines are coming, and bars for those would be
 * busier than the tiles they stand in for.
 */
export default function LoadingRoomHome() {
  return (
    <SkeletonScreen label="Loading your room">
      <div className={styles.skeleton}>
        <div className={styles.skeletonMast}>
          <Skeleton w="132px" h="0.95rem" />
          <Skeleton w="72px" h="0.95rem" />
        </div>

        <div className={styles.hero}>
          <div className={styles.archFrame}>
            <div className={styles.archPhoto} />
            <svg className={styles.archLine} viewBox="0 0 200 260" focusable="false">
              <path d="M0 260 V110 C0 60 50 30 100 0 C150 30 200 60 200 110 V260" pathLength={1} />
            </svg>
          </div>
          <div className={styles.skeletonText}>
            <Skeleton w="92%" h="1.7rem" />
            <Skeleton w="64%" h="1.7rem" />
            <Skeleton w="80%" h="0.9rem" />
          </div>
        </div>

        <div className={styles.tiles}>
          {[0, 1, 2, 3].map((i) => <div key={i} className={styles.skeletonTile} />)}
        </div>

        <div className={styles.skeletonCta}>
          <Skeleton w="100%" h="58px" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
