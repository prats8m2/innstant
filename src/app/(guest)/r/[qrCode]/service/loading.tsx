import { ChevronLeft } from 'lucide-react';
import { Skeleton, SkeletonScreen } from '@/components/skeleton';
import styles from './service.module.css';

/**
 * Calling for service, waiting (D-077: a skeleton shaped like its own page).
 *
 * One query — the CALL_SERVICE request type, for the wait it promises. The
 * back arrow, the eyebrow and the second line are literals the route already
 * knows; the title carries the room number, so it waits as bars. The card,
 * the note and the pinned button are where the real ones will be.
 */
export default function LoadingService() {
  return (
    <SkeletonScreen label="Calling for service">
      <div className={styles.skeleton}>
        <div className={styles.bar}>
          <span className={styles.back}>
            <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
          </span>
        </div>

        <div className={styles.intro}>
          <p className={styles.eyebrow}>Call for service</p>
          <Skeleton w="88%" h="2rem" />
          <Skeleton w="52%" h="2rem" />
          <p className={styles.lede}>No queue, no call, no reason needed.</p>
        </div>

        <div className={styles.skeletonCard}>
          <Skeleton w="24px" h="24px" />
          <div className={styles.skeletonCardText}>
            <Skeleton w="48%" h="0.95rem" />
            <Skeleton w="66%" h="0.8rem" />
          </div>
        </div>

        <div className={styles.noteField}>
          <Skeleton w="132px" h="0.75rem" />
          <Skeleton w="100%" h="48px" radius="var(--radius-xs)" />
        </div>

        <div className={styles.skeletonFooter}>
          <Skeleton w="100%" h="56px" />
        </div>
      </div>
    </SkeletonScreen>
  );
}
