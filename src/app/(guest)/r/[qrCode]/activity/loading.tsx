import { Skeleton, SkeletonBar, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * Your requests, waiting.
 *
 * Every order and every service request for the stay, merged and sorted —
 * two queries and a sort before a row appears.
 *
 * One group of three entries. The real screen splits into "Happening now"
 * and the rest, but which group a stay has is exactly what is being loaded,
 * and guessing two headings would put one of them somewhere it is not.
 */
export default function LoadingActivity() {
  return (
    <SkeletonScreen label="Loading your requests">
      <SkeletonBar title="Your requests" divider />

      <section className={styles.stackWide}>
        <Skeleton w="42%" h="0.7rem" />
        <div>
          {[0, 1, 2].map((entry) => (
            <div key={entry} className={styles.entry}>
              <div className={styles.headingRow}>
                <Skeleton w="44%" h="1rem" />
                <Skeleton w="62px" h="1rem" />
              </div>
              <Skeleton w="84%" h="0.85rem" />
              <div className={styles.headingRow}>
                <Skeleton w="48%" h="0.7rem" />
                <Skeleton w="58px" h="0.7rem" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </SkeletonScreen>
  );
}
