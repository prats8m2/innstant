import { ChevronLeft } from 'lucide-react';
import { Skeleton, SkeletonScreen } from '@/components/skeleton';
import styles from './amenities.module.css';

/**
 * Amenities, waiting (D-077: a skeleton shaped like its own page).
 *
 * The back arrow and the question are real — both are literals in the page,
 * decided by the route before anything is read. What waits is the "most asked
 * for" line (D-071) and the hairline rows under their eyebrow, each with the
 * outline of its + button.
 */
export default function LoadingAmenities() {
  return (
    <SkeletonScreen label="Loading amenities">
      <div className={styles.skeleton}>
        <div className={styles.bar}>
          <span className={styles.back}>
            <ChevronLeft size={22} strokeWidth={1.5} aria-hidden="true" />
          </span>
        </div>

        <div className={styles.intro}>
          <p className={styles.title}>What can we bring?</p>
          <p className={styles.lede}>Free, unless it shows a price.</p>
        </div>

        <section className={styles.quick}>
          <Skeleton w="110px" h="0.75rem" />
          <div className={styles.skeletonChips}>
            {['118px', '96px', '108px', '124px'].map((w) => (
              <Skeleton key={w} w={w} h="44px" radius="var(--radius-pill)" />
            ))}
          </div>
        </section>

        {[4, 3].map((rows, group) => (
          <section key={group} className={styles.group}>
            <Skeleton w="88px" h="0.75rem" />
            <div>
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className={styles.skeletonRow}>
                  <div className={styles.skeletonRowText}>
                    <Skeleton w={i % 2 ? '44%' : '56%'} h="1rem" />
                    <Skeleton w="30%" h="0.75rem" />
                  </div>
                  <span className={styles.skeletonStep} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </SkeletonScreen>
  );
}
