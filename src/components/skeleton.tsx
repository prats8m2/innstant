import styles from './skeleton.module.css';

/**
 * Skeletons for the guest app.
 *
 * ─── Why these exist ──────────────────────────────────────────────────────
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
 * Eleven guest segments have one — home, menu, menu/[itemId], cart, amenities,
 * service, service/[requestId], activity, order/[orderId], stay, nearby.
 * `/orders` is a redirect: it renders nothing and needs none.
 *
 * The layout each screen composes with — the stacks, the grid, the sheet, the
 * timeline — lives in `skeleton.module.css` beside these, so a `loading.tsx`
 * is a shape and nothing else.
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
      <div aria-hidden="true" className={styles.contents}>{children}</div>
    </div>
  );
}

/**
 * The back bar every inner guest screen opens with.
 *
 * The arrow is real, and so is the title WHEN THE ROUTE KNOWS IT: "Amenities",
 * "Your stay", "Plan my day" are literals in their own pages, decided before
 * any query runs. Greying out a heading the app can render immediately is a
 * skeleton pretending to wait for something.
 *
 * The other five titles are data — an outlet's name, a dish's name, the room
 * number — so those screens pass no `title` and get a bar instead. Rendering
 * a plausible guess there would be worse than a grey box: the guess changes
 * under the reader when the real one lands.
 *
 * `trailing` is the small right-hand slot the menu, the order and the request
 * screens carry (a prep window, an order number). `divider` is the hairline
 * the sticky bars sit on; the two plain bars — service and stay — do without.
 */
export function SkeletonBar({
  title,
  trailing = false,
  divider = false,
}: {
  title?: string;
  trailing?: boolean;
  divider?: boolean;
}) {
  return (
    <div className={styles.bar_} data-divider={divider} aria-hidden="true">
      <span className={styles.back}>←</span>
      {title
        ? <span className={styles.title}>{title}</span>
        : <Skeleton w="44%" h="1.15rem" />}
      {trailing ? <Skeleton w="58px" h="0.8rem" className={styles.trailing} /> : null}
    </div>
  );
}

/**
 * A card with a thumbnail and three lines — the menu and the cart's lines.
 *
 * The thumbnail is arch-topped, the same curve the real dish thumbnails and
 * the room home carry. A plain rounded square there is the one thing on the
 * screen that would visibly change shape when the dishes arrive.
 */
const THUMB_ARCH = '40% 40% var(--radius-sm) var(--radius-sm) / 26% 26% 0 0';

export function SkeletonCard({ thumb = false }: { thumb?: boolean }) {
  return (
    <div className={styles.card}>
      {thumb ? <Skeleton w="84px" h="84px" radius={THUMB_ARCH} /> : null}
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

/**
 * A heading with a count beside it — the menu's section head, activity's
 * group head, and the folio's. Two bars on one baseline rather than a stack,
 * because that is what the real one is.
 */
export function SkeletonHeading({ count = false }: { count?: boolean }) {
  return (
    <div className={styles.headingRow}>
      <Skeleton w="40%" h="1.1rem" />
      {count ? <Skeleton w="54px" h="0.75rem" /> : null}
    </div>
  );
}

/** A money row: a label on the left, an amount right-aligned. */
export function SkeletonTotal({ grand = false }: { grand?: boolean }) {
  return (
    <div className={styles.totalRow} data-grand={grand}>
      <Skeleton w={grand ? '58%' : '34%'} h={grand ? '1.05rem' : '0.85rem'} />
      <Skeleton w={grand ? '76px' : '54px'} h={grand ? '1.05rem' : '0.85rem'} />
    </div>
  );
}

/**
 * One step of the order timeline: the rail with its dot, and two lines.
 *
 * The rail is drawn rather than greyed. It is the same five steps for every
 * order — the route already knows there will be five of them and where the
 * line between them runs — and only the times and the state are waiting on
 * the server.
 */
export function SkeletonStep({ last = false }: { last?: boolean }) {
  return (
    <div className={styles.step}>
      <span className={styles.stepRail} data-last={last}>
        <span className={styles.dot} />
        {last ? null : <span className={styles.line} />}
      </span>
      <div className={styles.stepBody}>
        <div className={styles.headingRow}>
          <Skeleton w="46%" h="0.95rem" />
          <Skeleton w="44px" h="0.75rem" />
        </div>
        <Skeleton w="70%" h="0.75rem" />
      </div>
    </div>
  );
}
