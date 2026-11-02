import { Skeleton, SkeletonScreen } from '@/components/skeleton';
import styles from './dish.module.css';

/**
 * A dish, waiting (D-077).
 *
 * Drawn to the Direction A layout: the 300px photograph to the edges, a 32px
 * name, the price and two lines of description, one group of three choices
 * (the common case: how hot), and the pinned bar with the stepper and the Add
 * button. A dish with no choices loses the row and nothing above it moves,
 * because the choices are the last thing in the scroll.
 */
export default function LoadingDish() {
  return (
    <SkeletonScreen label="Loading the dish" className={styles.skScreen}>
      <Skeleton w="100%" h="300px" radius="0" />

      <div className={styles.skBody}>
        <Skeleton w="72px" h="0.8rem" />
        <Skeleton w="64%" h="32px" />
        <Skeleton w="84px" h="1.1rem" />
        <Skeleton w="100%" h="0.9rem" />
        <Skeleton w="76%" h="0.9rem" />

        <div className={styles.skChoices}>
          {[0, 1, 2].map((n) => <Skeleton key={n} w="100%" h="48px" />)}
        </div>
      </div>

      <div className={styles.skBar}>
        <Skeleton w="126px" h="56px" />
        <Skeleton w="100%" h="56px" />
      </div>
    </SkeletonScreen>
  );
}
