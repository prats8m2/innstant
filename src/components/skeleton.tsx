import styles from './skeleton.module.css';

/**
 * Skeletons for the guest app.
 *
 * ─── UNFINISHED. Nothing imports this yet ──────────────────────────────────
 *
 * This is the primitive half of the job. The other half — one `loading.tsx`
 * per guest segment, each shaped like the screen it stands in for — has not
 * been written, so no screen currently shows a skeleton. Eleven need one:
 * home, menu, menu/[itemId], cart, amenities, service, service/[requestId],
 * activity, order/[orderId], stay, nearby. `/orders` is a redirect and needs
 * none.
 *
 * Kept rather than deleted because the thinking below — the sweep over a
 * pulse, the shapes matching real content so nothing jumps, the aria — is the
 * considered part, and what remains is mechanical. See docs/STATUS.md.
 *
 * ─── Why these exist at all ────────────────────────────────────────────────
 *
 * Every guest screen is `force-dynamic` and reads the database on the way in:
 * the menu loads an outlet, its dishes, their schedules and the cart, and the
 * target network is hotel wifi. Without a fallback, tapping a tile gives a
 * dead screen holding the PREVIOUS page until the server answers — which on a
 * phone reads as a tap that did not register, and the guest taps again.
 *
 * Next renders `loading.tsx` as the Suspense boundary for a segment, so each
 * screen gets one shaped like itself. Shaped LIKE ITSELF is the whole point:
 * a spinner says "wait", a skeleton says "a list of four things is coming",
 * and when the content lands nothing jumps because the bars were already the
 * right size.
 *
 * ─── Motion ────────────────────────────────────────────────────────────────
 *
 * A sweep rather than a pulse. Pulsing opacity on eight bars at once makes a
 * screen breathe; a highlight travelling left to right reads as progress and
 * only one thing appears to be moving.
 *
 * No reduced-motion query here, deliberately, and one would fail the theme
 * discipline test besides: `theme.css` answers that preference once for the
 * whole product. The sweep settles instantly and the bars sit still, which is
 * the correct outcome — the SHAPE is doing the work, and the shimmer was only
 * ever telling you it was not frozen.
 */

/** One grey bar. `w` and `h` are any CSS length; the defaults suit a line. */
export function Skeleton({
  w = '100%',
  h = '1rem',
  radius = 'var(--radius-sm)',
  className,
}: {
  w?: string;
  h?: string;
  radius?: string;
  className?: string;
}) {
  return (
    <span
      className={`${styles.bar} ${className ?? ''}`}
      style={{ width: w, height: h, borderRadius: radius }}
    />
  );
}

/**
 * The wrapper every `loading.tsx` uses.
 *
 * `role="status"` with a label, and the bars inside are decoration — so a
 * screen reader hears "Loading" once instead of reciting eleven nameless
 * boxes. `aria-busy` is what tells assistive tech the region is mid-update.
 */
export function SkeletonScreen({
  label = 'Loading',
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={`${styles.screen} ${className ?? ''}`}
    >
      <span aria-hidden="true" className={styles.contents}>{children}</span>
    </div>
  );
}

/**
 * The back bar every inner guest screen opens with.
 *
 * Real, not a skeleton: the arrow and the title are already known before the
 * data is: the route decides them. Greying out a heading the app can render
 * immediately is a skeleton pretending to wait for something.
 */
export function SkeletonBar({ title }: { title: string }) {
  return (
    <div className={styles.bar_} aria-hidden="true">
      <span className={styles.back}>←</span>
      <span className={styles.title}>{title}</span>
    </div>
  );
}

/** A card with a thumbnail and three lines — the menu and activity shape. */
export function SkeletonCard({ thumb = false }: { thumb?: boolean }) {
  return (
    <div className={styles.card}>
      {thumb ? <Skeleton w="84px" h="84px" radius="var(--radius-md)" /> : null}
      <div className={styles.cardBody}>
        <Skeleton w="62%" h="1.05rem" />
        <Skeleton w="100%" h="0.8rem" />
        <Skeleton w="78%" h="0.8rem" />
        <Skeleton w="34%" h="0.9rem" className={styles.cardFoot} />
      </div>
    </div>
  );
}

/** A plain row — name on the left, a control on the right. */
export function SkeletonRow() {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <Skeleton w="54%" h="0.95rem" />
        <Skeleton w="22%" h="0.7rem" />
      </div>
      <Skeleton w="72px" h="34px" radius="var(--radius-pill)" />
    </div>
  );
}
