import { Skeleton, SkeletonScreen } from '@/components/skeleton';
import styles from './menu.module.css';

/**
 * The menu, waiting (D-077).
 *
 * The slowest guest screen and the one worth the most: it loads the outlet,
 * its editorial sections, every dish with its schedule, the outlet's hours
 * and the cart before it renders.
 *
 * Drawn to the Direction A layout it is standing in for: the bar, a 32px
 * title and the kitchen's line, the chip rail, then a collection — an eyebrow,
 * one feature card and two half-width cards — which is how the seeded menu
 * and most real ones open. The title is not drawn as text because it is the
 * outlet's own name, which is data.
 */
export default function LoadingMenu() {
  return (
    <SkeletonScreen label="Loading the menu" className={styles.skScreen}>
      <div className={styles.skHead}>
        <span className={styles.skIcon} />
        <Skeleton w="96px" h="0.9rem" />
        <span className={styles.skIcon} />
      </div>

      <div className={styles.intro}>
        <Skeleton w="62%" h="32px" />
        <Skeleton w="78%" h="0.9rem" />
      </div>

      <div className={styles.skRail}>
        {['92px', '118px', '104px', '96px'].map((w) => (
          <Skeleton key={w} w={w} h="40px" radius="var(--radius-pill)" />
        ))}
      </div>

      <div className={styles.skSection}>
        <Skeleton w="132px" h="0.75rem" />
        <Skeleton w="88%" h="0.85rem" />
        <div className={styles.skFeature}>
          <Skeleton w="100%" h="200px" radius="0" />
          <div className={styles.skFeatureBody}>
            <Skeleton w="64px" h="0.75rem" />
            <Skeleton w="58%" h="1.4rem" />
            <Skeleton w="100%" h="0.85rem" />
          </div>
        </div>
        <div className={styles.grid}>
          {[0, 1].map((n) => (
            <div key={n} className={styles.skFeature}>
              <Skeleton w="100%" h="104px" radius="0" />
              <div className={styles.skFeatureBody}>
                <Skeleton w="70%" h="1.1rem" />
                <Skeleton w="44%" h="0.9rem" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonScreen>
  );
}
