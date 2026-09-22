import { Skeleton, SkeletonBar, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * Calling for service, waiting.
 *
 * One query — the CALL_SERVICE request type, for the wait it promises — so
 * this is the shortest wait of the eleven. It still gets a skeleton, because
 * the alternative is the room home sitting there after a tap.
 *
 * The bell is centred in the stage and the button is on the bottom edge,
 * which is the whole composition of the real screen: everything in the
 * middle, one thing under the thumb. The button is pinned to get there —
 * the real one is the last child of a full-height flex column, and a fixed
 * element lands in the same place without making this screen a column.
 */
export default function LoadingService() {
  return (
    <SkeletonScreen label="Calling for service">
      <SkeletonBar title="Service" />

      <div className={styles.centre}>
        <div className={styles.disc} />
        <Skeleton w="78%" h="1.7rem" />
        <Skeleton w="56%" h="0.95rem" />
        <Skeleton w="160px" h="30px" radius="var(--radius-pill)" />
      </div>

      <div className={styles.pinned}>
        <Skeleton w="100%" h="62px" />
      </div>
    </SkeletonScreen>
  );
}
