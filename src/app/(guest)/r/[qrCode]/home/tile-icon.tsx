import styles from './room-home.module.css';

/**
 * One icon per tile.
 *
 * All four tiles drew the same thing — a small arch outline, repeated. It is
 * the app's motif and it looked deliberate, but four identical marks carry no
 * information: the eye cannot use them to find anything, so the tiles are
 * read as four blocks of text with decoration on top. Distinct marks let a
 * guest who has used the app once find "amenities" without reading.
 *
 * ─── Drawn to one recipe ───────────────────────────────────────────────────
 *
 * 24×24, 1.5 stroke, round caps, `currentColor` — so the tile decides the
 * colour and the `soon` state dims all four the same way. They keep the
 * arch's family resemblance: thin line, generous curve, nothing filled except
 * a single dot where one helps the shape read at 22px.
 *
 * Deliberately not an icon font or a package. Four paths is less code than
 * the import, and a 40KB dependency on hotel wifi to draw four small lines is
 * the thing this product is supposed to be better than.
 */
export type TileIconName = 'amenities' | 'service' | 'stay' | 'nearby';

/** The drawing, per tile. The `key` matches TILES in `page.tsx`. */
const PATHS: Record<TileIconName, React.ReactNode> = {
  /*
   * Two folded towels, stacked, with the fold showing on the left.
   *
   * The first attempt was three plain horizontal rules and a vertical one,
   * which drew a list icon — the one mark on a screen of lists that must not
   * look like a list. Rounded bars with a fold line read as cloth.
   */
  amenities: (
    <>
      <rect x="4" y="7.5" width="16" height="5" rx="2.5" />
      <rect x="4" y="14" width="16" height="5" rx="2.5" />
      <path d="M8.5 7.5v5" />
      <path d="M8.5 14v5" />
    </>
  ),

  /* A bell — the same mark the service screen leads with, so the tile and the
     screen it opens are recognisably one thing. */
  service: (
    <>
      <path d="M7 16c0-5 .9-8 5-8s5 3 5 8" />
      <path d="M5 16h14" />
      <path d="M12 8V6" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),

  /* A key: the stay, and what is owed at the end of it. */
  stay: (
    <>
      <circle cx="8.5" cy="9" r="3.5" />
      <path d="M11 11.5 19 19.5" />
      <path d="M16.5 17 15 18.5" />
    </>
  ),

  /* A compass needle in its ring — a day out, rather than a map pin, which
     would mean one place. */
  nearby: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M14.8 9.2 10.6 10.6 9.2 14.8 13.4 13.4Z" />
    </>
  ),
};

export function TileIcon({ name }: { name: TileIconName }) {
  return (
    <svg
      className={styles.tileIcon}
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
