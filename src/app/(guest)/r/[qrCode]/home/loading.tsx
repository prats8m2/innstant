import { Skeleton, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * The room home, waiting.
 *
 * This is the screen a sticker scan lands on, so it is the one skeleton a
 * guest is most likely to see: the page reads the property, the outlet's
 * hours, every order and every request for the stay before it can render a
 * word.
 *
 * The masthead, the arch and the four tiles are the shape of it. The arch is
 * drawn rather than greyed — the doorway is ornament the page owns, not data
 * it is waiting for — and only the two lines inside it are bars.
 */
export default function LoadingRoomHome() {
  return (
    <SkeletonScreen label="Loading your room" className={styles.clearsCta}>
      <div className={styles.mast}>
        <Skeleton w="146px" h="1.1rem" />
        <Skeleton w="78px" h="24px" radius="var(--radius-xs)" />
      </div>

      <div className={styles.arch}>
        <Skeleton w="38%" h="0.7rem" />
        <Skeleton w="74%" h="1.2rem" />
      </div>

      <div className={styles.lede}>
        <Skeleton w="66%" h="1.9rem" />
        <Skeleton w="54%" h="1rem" />
      </div>

      {/* Four doors. Empty boxes of the right size: what is coming is an icon
          and two short lines, and bars for those would be busier than the
          tiles they stand in for. */}
      <div className={styles.grid}>
        {[0, 1, 2, 3].map((i) => <div key={i} className={styles.tile} />)}
      </div>

      {/* "Charged to room 214" — small, and the last thing above the fold. */}
      <div className={styles.lede}>
        <Skeleton w="44%" h="0.7rem" />
      </div>

      <div className={styles.pinned}>
        <Skeleton w="100%" h="58px" />
      </div>
    </SkeletonScreen>
  );
}
