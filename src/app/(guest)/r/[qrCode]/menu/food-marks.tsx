import styles from './food-marks.module.css';

/**
 * The two facts an Indian menu prints beside a dish name before anything
 * else: whether it is vegetarian, and how hot it is. Direction A.
 *
 * ─── The diet mark is the FSSAI square ─────────────────────────────────────
 *
 * A green square with a dot is vegetarian; a brown square with a triangle is
 * not. The SHAPE carries the meaning, not only the colour, which is why it is
 * drawn as a dot and a triangle rather than two coloured squares: a guest who
 * cannot tell the two tones apart can still tell a circle from a triangle.
 *
 * Drawn only when the dish DECLARES it. A dish carrying neither flag gets no
 * square at all — the same rule `ApiDish.dietaryFlags` and `passesFilters()`
 * follow. Guessing "veg" for an undeclared dish is the one mistake on this
 * screen that matters to somebody.
 *
 * ─── Heat is three strokes and a word ──────────────────────────────────────
 *
 * The console records spice as 0–5 (the dish editor's field). A guest reads
 * three steps, so the six collapse: 1–2 is mild, 3 medium, 4–5 hot. Zero and
 * undeclared both draw nothing — "not spicy" is the absence of a warning, and
 * printing "Mild" on a lassi would be a strange thing to say about a lassi.
 * The word is always beside the strokes: the strokes are decoration for the
 * eye, the word is what is read.
 */
export type Diet = 'veg' | 'nonveg';

export function dietOf(flags: readonly string[]): Diet | null {
  if (flags.includes('VEGETARIAN') || flags.includes('VEGAN')) return 'veg';
  if (flags.includes('NON_VEGETARIAN')) return 'nonveg';
  return null;
}

export interface Heat {
  strokes: 1 | 2 | 3;
  word: 'Mild' | 'Medium' | 'Hot';
}

export function heatOf(level: number | null | undefined): Heat | null {
  if (level == null || level <= 0) return null;
  if (level <= 2) return { strokes: 1, word: 'Mild' };
  if (level === 3) return { strokes: 2, word: 'Medium' };
  return { strokes: 3, word: 'Hot' };
}

/** The square alone. Used inline before a name, where the heat would crowd it. */
export function DietMark({ diet, size = 'sm' }: { diet: Diet; size?: 'sm' | 'md' }) {
  return (
    <span
      role="img"
      aria-label={diet === 'veg' ? 'Vegetarian' : 'Non-vegetarian'}
      className={styles.diet}
      data-diet={diet}
      data-size={size}
    >
      <span className={styles.dietInner} />
    </span>
  );
}

export function HeatMark({ heat }: { heat: Heat }) {
  return (
    <span className={styles.heat}>
      <span className={styles.heatWord}>
        <span className={styles.srOnly}>Spice: </span>
        {heat.word}
      </span>
      <span className={styles.strokes} aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={styles.stroke} data-on={n <= heat.strokes} />
        ))}
      </span>
    </span>
  );
}

/** Both marks on one line, or nothing when the dish declares neither. */
export function FoodMarks({
  flags,
  spiceLevel,
  size = 'sm',
}: {
  flags: readonly string[];
  spiceLevel: number | null;
  size?: 'sm' | 'md';
}) {
  const diet = dietOf(flags);
  const heat = heatOf(spiceLevel);
  if (!diet && !heat) return null;
  return (
    <span className={styles.marks} data-size={size}>
      {diet ? <DietMark diet={diet} size={size} /> : null}
      {heat ? <HeatMark heat={heat} /> : null}
    </span>
  );
}

/**
 * The dietary facts worth a sentence on the dish screen. Vegetarian and
 * non-vegetarian are left to the square; these are the ones a square cannot
 * say — and the allergens, which are the ones somebody is reading for.
 */
const WORDS: Record<string, string> = {
  VEGAN: 'Vegan',
  JAIN: 'Jain',
  GLUTEN_FREE: 'Gluten-free',
  CONTAINS_NUTS: 'Contains nuts',
  CONTAINS_DAIRY: 'Contains dairy',
};

export function dietaryWords(flags: readonly string[]): string[] {
  return flags.map((f) => WORDS[f]).filter((w): w is string => Boolean(w));
}
