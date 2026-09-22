import { Skeleton, SkeletonRow, SkeletonBar, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * Amenities, waiting.
 *
 * Two queries: the property's request catalog, and the counts behind the
 * "most asked for" strip (D-071). The strip is what the screen leads with,
 * so it is what this leads with.
 *
 * The title is real. "Amenities" is a literal in the page, decided by the
 * route before anything is read.
 */
export default function LoadingAmenities() {
  return (
    <SkeletonScreen label="Loading amenities" className={styles.clearsPill}>
      <SkeletonBar title="Amenities" divider />

      <div className={styles.lede}>
        <Skeleton w="100%" h="0.95rem" />
        <Skeleton w="46%" h="0.95rem" />
      </div>

      <section className={styles.stackWide}>
        <Skeleton w="38%" h="0.75rem" />
        <div className={styles.chips}>
          {['104px', '86px', '128px', '92px', '112px'].map((w) => (
            <Skeleton key={w} w={w} h="44px" radius="var(--radius-pill)" />
          ))}
        </div>
      </section>

      {[0, 1].map((group) => (
        <section key={group} className={styles.stackWide}>
          <Skeleton w="34%" h="0.75rem" />
          <div>
            {[0, 1, 2].map((card) => <SkeletonRow key={card} />)}
          </div>
        </section>
      ))}

      <div className={styles.pinned}>
        <Skeleton w="100%" h="46px" radius="var(--radius-pill)" />
      </div>
    </SkeletonScreen>
  );
}
