import { Compass, ConciergeBell, ReceiptText, SquareStack, type LucideIcon } from 'lucide-react';
import styles from './room-home.module.css';

/**
 * One icon per tile, from Lucide.
 *
 * ─── Why a library, after two rounds of drawing them by hand ───────────────
 *
 * The first version was a CSS arch repeated four times, which carried no
 * information. The second was four hand-written SVG paths, which at least
 * differed — but hand-drawing is where this stops being worth it: every new
 * mark is a fresh argument about stroke weight and optical size, the first
 * towel came out looking like a list icon, and none of it is checked by
 * anything.
 *
 * Lucide is the set shadcn/ui ships with, and shadcn is already this
 * product's component layer (see the stack table in CLAUDE.md), so it is the
 * consistent choice rather than a new one. 2,095 icons drawn to one grid and
 * one stroke weight by people who do that for a living.
 *
 * ─── The dependency ────────────────────────────────────────────────────────
 *
 * CLAUDE.md asks before anything over ~50KB. Lucide is per-icon ESM and Next
 * lists it in `optimizePackageImports` by default, so the four below cost
 * roughly a kilobyte in the bundle — the installed package is large and the
 * shipped bytes are not.
 *
 * ─── Colour ────────────────────────────────────────────────────────────────
 *
 * Each tile has its own tone from `--icon-*` in theme.css: a solid stroke and
 * a tint filling the closed shapes. No badge behind it — a tinted square per
 * icon put a fifth box inside four boxes, and the tiles are already cards.
 * Decorative in the strict sense — every icon sits beside its own text label
 * and never alone — so nothing is lost if the colours cannot be told apart.
 */
export type TileIconName = 'amenities' | 'service' | 'stay' | 'nearby';

/**
 * The mark and the tone, per tile.
 *
 * `ConciergeBell` is the same icon the service screen leads with, so the tile
 * and the screen it opens are recognisably one thing — the only reason to
 * care which bell it is.
 *
 * `ReceiptText` for "Your stay" rather than a key or a bed: the screen behind
 * it is the folio and the checkout, so what a guest is really tapping is
 * "what do I owe, and when do I have to leave".
 */
const TILES: Record<TileIconName, { Icon: LucideIcon; tone: string }> = {
  /*
    `SquareStack` — folded linen, stacked. `HandPlatter` was tried first and
    had to go: it is a dome on a hand, and the tile directly beside it is a
    concierge bell, which is a dome on a base. Two domes side by side is worse
    than the four identical arches this whole exercise replaced.
  */
  amenities: { Icon: SquareStack, tone: 'amenity' },
  service: { Icon: ConciergeBell, tone: 'service' },
  stay: { Icon: ReceiptText, tone: 'stay' },
  nearby: { Icon: Compass, tone: 'nearby' },
};

export function TileIcon({ name }: { name: TileIconName }) {
  const { Icon, tone } = TILES[name];
  return (
    <span className={styles.tileIcon} data-tone={tone} aria-hidden="true">
      {/*
        `absoluteStrokeWidth` keeps the stroke at 1.75px whatever the box is
        scaled to. Without it Lucide scales the stroke with the icon, and a
        22px mark ends up hairline beside 16px type.
      */}
      <Icon size={24} strokeWidth={1.75} absoluteStrokeWidth />
    </span>
  );
}
