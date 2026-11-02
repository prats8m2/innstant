import { Skeleton, SkeletonBar, SkeletonScreen } from '@/components/skeleton';
import styles from './loading.module.css';

/**
 * Your stay, waiting.
 *
 * The heaviest read on the guest side when the session is verified: the
 * property, the room and its type, the folio with every line on it, and the
 * checkout options the property offers today.
 *
 * Drawn as the board's two panels — when they leave, and the bill — at the
 * height they arrive at. The bill panel is the same box whether the session
 * can see a folio or gets the four-digit prompt in it, so it does not resize
 * under either answer. Not a live screen, so D-099 does not apply.
 */
export default function LoadingStay() {
  return (
    <SkeletonScreen label="Loading your stay" className={styles.ground}>
      <SkeletonBar />

      <div className={styles.title}>
        <Skeleton w="52%" h="2rem" />
      </div>

      <div className={styles.card}>
        <Skeleton w="34%" h="0.7rem" />
        <div className={styles.row}>
          <Skeleton w="62%" h="1.6rem" />
          <Skeleton w="22%" h="0.8rem" />
        </div>
        <Skeleton w="44%" h="0.8rem" />
      </div>

      <div className={styles.card}>
        <div className={styles.row}>
          <Skeleton w="30%" h="0.7rem" />
          <Skeleton w="26%" h="0.8rem" />
        </div>
        <Skeleton w="40%" h="1.6rem" />
        <Skeleton w="100%" h="0.9rem" />
        <Skeleton w="82%" h="0.9rem" />
        <Skeleton w="48%" h="48px" />
      </div>
    </SkeletonScreen>
  );
}
