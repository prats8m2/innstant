import styles from './innstant-logo.module.css';

/**
 * The mark.
 *
 * Drawn rather than linked, so that it is one colour token away from a dark
 * header, a light header or a favicon, and so that it stays sharp on the
 * screens this product is read on — a phone held in a hotel room and a 4K
 * monitor at a front desk. A raster would need three of it.
 *
 * ─── How the S is constructed, and what two earlier attempts got wrong ────
 *
 * Two ELLIPSES stacked tangentially — a ~310° arc from the upper, ~250° from
 * the lower, meeting at the waist. `rx` is larger than `ry`, and that is the
 * whole trick.
 *
 * The first version used two tangent CIRCLES. It reads as an S, but the
 * proportion is locked: equal tangent circles of radius R give a mark
 * (4R+stroke) tall and (2R+stroke) wide, which is 1.7 however the numbers are
 * chosen, against the ~1.4 of the mark it is copying. There is no stroke width
 * that fixes it.
 *
 * The second version tried unequal bowls on an offset axis to widen it. That
 * produced a lowercase g: the diagonal closes the upper counter into a loop,
 * and the letter stops being an S at all. Four variants, all g.
 *
 * Ellipses solve it directly. A bowl 33 wide and 27 high is short enough to
 * stack twice inside a 1.4 box, and the curvature still reverses cleanly at the
 * waist because the two are tangent there. The terminals are cut at 35° and
 * 145° rather than nearer the horizontal, which is what keeps the counters open
 * — a terminal that wraps further round closes them and the g comes back.
 *
 * The dots are the other half of the monogram and they have to READ: a quarter
 * of the mark's width, tucked into the notches the arcs leave, with real
 * daylight against the stroke. Both clearances are checked against the terminal
 * points, not just the bowls — the terminal is the part that reaches furthest
 * into each notch.
 *
 * Still a recreation, traced by eye from the supplied artwork. If the original
 * files are dropped into `public/`, this becomes an <img> and the comment above
 * becomes history.
 */

/**
 * Upper bowl centred at (70, 40), lower at (70, 94), both rx 33 / ry 27, so
 * they are tangent at the waist (70, 67).
 */
const S_PATH = 'M 97 55.5 A 33 27 0 1 0 70 67 A 33 27 0 1 1 43 109.5';

const DOTS = [
  { cx: 117, cy: 15, r: 15 },   // upper right, clear of the top terminal at (97, 55.5)
  { cx: 16, cy: 124, r: 15 },   // lower left, clear of the bottom one at (43, 109.5)
];

const VIEW_BOX = { x: 1, y: 0, w: 131, h: 139 };

export function InnstantMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox={`${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.w} ${VIEW_BOX.h}`}
      width={size}
      height={(size * VIEW_BOX.h) / VIEW_BOX.w}
      className={className}
      role="img"
      aria-label="Innstant"
      focusable="false"
    >
      <path
        d={S_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={26}
        // Butt, not round: the cap is cut square to the path, which at these
        // terminal angles reads as the angled shear the original has. A round
        // cap would turn both ends into lollipops.
        strokeLinecap="butt"
      />
      {DOTS.map((dot) => (
        <circle key={dot.cx} cx={dot.cx} cy={dot.cy} r={dot.r} className={styles.dot} />
      ))}
    </svg>
  );
}

/**
 * The full lockup: the mark, then the name with its roof.
 *
 * The circumflex over the A is a separate element rather than the character Â,
 * because it is gold and the letter is not — and a single glyph cannot be two
 * colours. It is also the idea in the whole identity (a roof, a gable, a place
 * to stay), so it is worth the extra element.
 */
export function InnstantLogo({
  size = 32,
  withMark = true,
  className,
}: {
  size?: number;
  withMark?: boolean;
  className?: string;
}) {
  return (
    <span className={`${styles.lockup} ${className ?? ''}`}>
      {withMark ? <InnstantMark size={size} /> : null}
      <span className={styles.word} style={{ fontSize: `${size * 0.6}px` }}>
        INNST
        <span className={styles.roofed}>
          A
          <svg className={styles.roof} viewBox="0 0 20 10" aria-hidden="true" focusable="false">
            <path
              d="M 2 8 L 10 2 L 18 8"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        NT
      </span>
    </span>
  );
}
