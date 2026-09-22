import { Skeleton, SkeletonBar, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * One request, waiting.
 *
 * The bar carries no title: it is the room number, which comes off the
 * session, and the reference beside it is the request number. Both are data.
 *
 * Two asked-for lines is the common shape — towels and a charger — and the
 * three links at the foot are fixed, so the page's full height is right from
 * the first frame and the status block does not push them down when it lands.
 */
export default function LoadingRequest() {
  return (
    <SkeletonScreen label="Loading your request">
      <SkeletonBar trailing />

      <div className={styles.panel}>
        <Skeleton w="74%" h="1.5rem" />
        <Skeleton w="34%" h="0.9rem" />
        <div className={styles.stack}>
          {[0, 1].map((line) => (
            <div key={line} className={styles.headingRow}>
              <Skeleton w="56%" h="0.9rem" />
              <Skeleton w="52px" h="0.9rem" />
            </div>
          ))}
        </div>
        <Skeleton w="88%" h="0.8rem" />
      </div>

      <div className={styles.stack}>
        {[0, 1, 2].map((link) => <Skeleton key={link} w="100%" h="44px" />)}
      </div>
    </SkeletonScreen>
  );
}
