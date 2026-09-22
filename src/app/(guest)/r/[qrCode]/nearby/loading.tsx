import { Skeleton, SkeletonBar, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * Plan my day, waiting.
 *
 * The property's own list of the city, sorted into the parts of the day
 * (D-069). Two groups of two is the seeded shape; the real one has as many
 * groups as the hour leaves ahead of you, and the cards are the same size in
 * every one of them.
 */
export default function LoadingNearby() {
  return (
    <SkeletonScreen label="Loading things to do">
      <SkeletonBar title="Plan my day" divider />

      <div className={styles.lede}>
        <Skeleton w="100%" h="0.9rem" />
        <Skeleton w="58%" h="0.9rem" />
      </div>

      {[0, 1].map((group) => (
        <section key={group} className={styles.stackWide}>
          <Skeleton w="36%" h="0.7rem" />
          <div className={styles.stack}>
            {[0, 1].map((place) => (
              <div key={place} className={styles.place}>
                <div className={styles.headingRow}>
                  <Skeleton w="52%" h="1.05rem" />
                  <Skeleton w="62px" h="0.75rem" />
                </div>
                <Skeleton w="100%" h="0.8rem" />
                <Skeleton w="68%" h="0.8rem" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </SkeletonScreen>
  );
}
