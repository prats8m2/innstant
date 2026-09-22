import { Skeleton, SkeletonTotal, SkeletonBar, SkeletonScreen } from '@/components/skeleton';
import styles from '@/components/skeleton.module.css';

/**
 * Your stay, waiting.
 *
 * The heaviest read on the guest side when the session is verified: the
 * property, the room and its type, the folio with every line on it, and the
 * checkout options the property offers today.
 *
 * The folio panel is drawn at three lines and a total whether or not the
 * session can see one — an unverified guest gets the four-digit prompt in
 * the same box, at about the same height, so the panel does not resize under
 * either answer.
 */
export default function LoadingStay() {
  return (
    <SkeletonScreen label="Loading your stay">
      <SkeletonBar title="Your stay" />

      <div className={styles.lede}>
        <Skeleton w="32%" h="0.7rem" />
        <Skeleton w="66%" h="1.8rem" />
        <Skeleton w="76%" h="0.95rem" />
      </div>

      <div className={styles.panel}>
        <div className={styles.headingRow}>
          <Skeleton w="38%" h="1.05rem" />
          <Skeleton w="88px" h="0.75rem" />
        </div>
        <div>
          <SkeletonTotal />
          <SkeletonTotal />
          <SkeletonTotal />
          <SkeletonTotal grand />
        </div>
        <Skeleton w="82%" h="0.75rem" />
      </div>

      <div className={styles.stackWide}>
        <Skeleton w="30%" h="1.05rem" />
        <div className={styles.stack}>
          {[0, 1].map((offer) => <Skeleton key={offer} w="100%" h="62px" />)}
        </div>
      </div>
    </SkeletonScreen>
  );
}
