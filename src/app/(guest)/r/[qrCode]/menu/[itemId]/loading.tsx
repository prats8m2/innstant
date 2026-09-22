import { Skeleton, SkeletonHeading, SkeletonRow, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * A dish, waiting.
 *
 * The hero is 220px of the page's own surface, bleeding past the padding and
 * square-topped like the real one. Not the arch itself — the rings are four
 * gradients this would have to keep in step with `dish.module.css` forever,
 * for a shape the eye reads for about 200ms. The height and the corners are
 * what stop the dish's name moving when it lands, and those are here.
 *
 * No bar over it: the real back arrow floats on the hero, and a grey one
 * floating there would be the only thing on screen that moved.
 *
 * Two modifier groups of three options is the common case (spice, and one
 * choice of side); a dish with none loses the stack and nothing shifts above
 * it, because the groups are the last thing on the page.
 */
export default function LoadingDish() {
  return (
    <SkeletonScreen label="Loading the dish" className={styles.clearsOrderBar}>
      <div className={styles.heroArch} />

      <div className={styles.lede}>
        <Skeleton w="86px" h="0.75rem" />
        <Skeleton w="68%" h="1.7rem" />
        <Skeleton w="88px" h="1.2rem" />
        <Skeleton w="100%" h="0.85rem" />
        <Skeleton w="72%" h="0.85rem" />
      </div>

      {[0, 1].map((group) => (
        <section key={group} className={styles.stackWide}>
          <SkeletonHeading />
          <div>
            {[0, 1, 2].map((option) => <SkeletonRow key={option} />)}
          </div>
        </section>
      ))}

      <div className={styles.pinned}>
        <Skeleton w="100%" h="58px" />
      </div>
    </SkeletonScreen>
  );
}
