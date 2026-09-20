import styles from './innstant-logo.module.css';

/**
 * The mark.
 *
 * Drawn rather than linked, so that it is one colour token away from a dark
 * header, a light header, or a favicon, and so that it stays sharp on the
 * screens this product is mostly read on — a phone held in a hotel room and a
 * 4K monitor at a front desk. A PNG would need three of it.
 *
 * ─── How the S is constructed ──────────────────────────────────────────────
 *
 * Two circles of equal radius stacked so that the bottom of the upper one is
 * the top of the lower one, with a ~300° arc taken from the first and ~240°
 * from the second. That is the geometric S the mark is built from, and drawing
 * it as arcs rather than as a traced outline means the weight is one number —
 * `strokeWidth` — instead of forty coordinates.
 *
 * The two gold dots sit in the notches the arcs leave: upper-right where the
 * top bowl opens, lower-left where the bottom one does. They are what makes the
 * mark read as a monogram rather than as a letter.
 */
const S_PATH = 'M 106 60 A 30 30 0 1 0 80 75 A 30 30 0 1 1 54 120';

/**
 * Cropped to the drawing, not to a round number.
 *
 * The arcs and the dots between them occupy x 4→156 and y 2→148; anything
 * wider is padding, and padding inside an SVG is indistinguishable from a
 * smaller logo. The first version used a tidy `0 0 160 170` and the mark sat
 * visibly small beside the wordmark for exactly that reason.
 */
const VIEW_BOX = { x: 4, y: 2, w: 152, h: 146 };

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
        strokeLinecap="butt"
      />
      <circle cx={140} cy={38} r={16} className={styles.dot} />
      <circle cx={20} cy={124} r={16} className={styles.dot} />
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
      <span className={styles.word} style={{ fontSize: `${size * 0.62}px` }}>
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
