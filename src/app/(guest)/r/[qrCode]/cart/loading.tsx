import { Skeleton, SkeletonCard, SkeletonTotal, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * The order sheet, waiting.
 *
 * The cart is not a page — it is a sheet over the menu, with a scrim behind
 * it — so this is too. A full-page skeleton here would cover the menu the
 * guest is still looking at and then uncover it again a moment later, which
 * is a bigger movement than the one it is hiding.
 *
 * Two lines and three totals: the median order, and enough that the Send
 * button sits at roughly its real height on the screen.
 */
export default function LoadingCart() {
  return (
    <SkeletonScreen label="Loading your order">
      <div className={styles.scrim} />

      <div className={styles.sheet}>
        <div className={styles.handle} />

        <div className={styles.headingRow}>
          <Skeleton w="44%" h="1.4rem" />
          <Skeleton w="96px" h="0.8rem" />
        </div>

        <div className={styles.stack}>
          {[0, 1].map((line) => <SkeletonCard key={line} thumb />)}
        </div>

        <div>
          <SkeletonTotal />
          <SkeletonTotal />
          <SkeletonTotal grand />
        </div>

        <Skeleton w="100%" h="58px" />
        <Skeleton w="74%" h="0.75rem" />
      </div>
    </SkeletonScreen>
  );
}
