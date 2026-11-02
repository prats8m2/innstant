import { Skeleton, SkeletonBar, SkeletonScreen } from '@/components/skeleton';
import styles from './loading.module.css';

/**
 * Plan my day, waiting.
 *
 * The property's own list of the city (D-069), drawn the way the board lays
 * it out: the headline, the time-of-day chips, the first place as a card and
 * the rest as hairline rows. Not a live screen, so D-099 does not apply.
 */
export default function LoadingNearby() {
  return (
    <SkeletonScreen label="Loading things to do" className={styles.ground}>
      <SkeletonBar />

      <div className={styles.intro}>
        <Skeleton w="78%" h="2rem" />
        <Skeleton w="100%" h="0.9rem" />
        <Skeleton w="58%" h="0.9rem" />
      </div>

      <div className={styles.chips}>
        {[0, 1, 2].map((chip) => (
          <Skeleton key={chip} w="88px" h="44px" radius="var(--radius-pill)" />
        ))}
      </div>

      <div className={styles.feature}>
        <Skeleton w="36px" h="1.1rem" radius="var(--radius-xs)" />
        <Skeleton w="64%" h="1.3rem" />
        <Skeleton w="100%" h="0.85rem" />
        <Skeleton w="72%" h="0.85rem" />
      </div>

      {[0, 1].map((row) => (
        <div key={row} className={styles.row}>
          <Skeleton w="54%" h="1.1rem" />
          <Skeleton w="100%" h="0.8rem" />
          <Skeleton w="30%" h="0.8rem" />
        </div>
      ))}
    </SkeletonScreen>
  );
}
