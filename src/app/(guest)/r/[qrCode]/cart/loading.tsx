import { Skeleton, SkeletonScreen } from '@/components/skeleton';
import styles from './cart.module.css';

/**
 * The order, waiting (D-077).
 *
 * Drawn to the Direction A cart page: the bar with "Your order", two lines
 * (the median order), three totals, the payment option, and the send button
 * pinned where the real one lands.
 */
export default function LoadingCart() {
  return (
    <SkeletonScreen label="Loading your order" className={styles.skScreen}>
      <div className={styles.skHead}>
        <span className={styles.skIcon} />
        <Skeleton w="124px" h="22px" />
      </div>

      <div className={styles.lines}>
        {[0, 1].map((n) => (
          <div key={n} className={styles.skLine}>
            <div className={styles.skLineHead}>
              <Skeleton w="58%" h="1rem" />
              <Skeleton w="64px" h="1rem" />
            </div>
            <Skeleton w="40%" h="0.8rem" />
            <Skeleton w="116px" h="44px" />
          </div>
        ))}
      </div>

      <div className={styles.summary}>
        <div className={styles.skTotals}>
          <Skeleton w="100%" h="0.85rem" />
          <Skeleton w="100%" h="0.85rem" />
          <Skeleton w="100%" h="1.1rem" />
        </div>
        <Skeleton w="100%" h="52px" />
      </div>

      <div className={styles.sendBar}>
        <Skeleton w="100%" h="56px" />
      </div>
    </SkeletonScreen>
  );
}
