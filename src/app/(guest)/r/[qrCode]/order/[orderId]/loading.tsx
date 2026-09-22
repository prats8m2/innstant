import { Skeleton, SkeletonStep, SkeletonBar, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * An order in the kitchen, waiting.
 *
 * Five steps, always. The timeline has the same rungs for every order — sent,
 * accepted, cooking, on the way, with you — so the rail and its dots are
 * drawn rather than greyed, and only the titles, the times and which one is
 * lit are waiting on the server.
 *
 * That is what makes this one worth having: the guest arrives here straight
 * after pressing Send, wanting to know the food is real, and the shape of
 * the answer is on screen before the answer is.
 */
export default function LoadingOrder() {
  return (
    <SkeletonScreen label="Loading your order">
      <SkeletonBar trailing divider />

      <div className={styles.panel}>
        <Skeleton w="46%" h="0.8rem" />
        <Skeleton w="64%" h="2rem" />
        <Skeleton w="92%" h="0.8rem" />
      </div>

      <div className={styles.steps}>
        {[0, 1, 2, 3, 4].map((step) => (
          <SkeletonStep key={step} last={step === 4} />
        ))}
      </div>

      {/* The order summary is a closed `details`, so only its head shows. */}
      <div className={styles.panel}>
        <div className={styles.headingRow}>
          <Skeleton w="36%" h="1rem" />
          <Skeleton w="104px" h="0.8rem" />
        </div>
      </div>

      <div className={styles.stack}>
        {[0, 1, 2].map((link) => <Skeleton key={link} w="100%" h="44px" />)}
      </div>
    </SkeletonScreen>
  );
}
