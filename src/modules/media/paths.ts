/**
 * Where an uploaded picture lives, as a path (D-093).
 *
 * Pure and dependency-free on purpose: the console's picker and the guest's
 * `<img>` both import this, and pulling the rest of the module (sharp, the S3
 * client) into a browser bundle would be the whole server shipped to a phone.
 *
 * A picture is stored once per width, at `media/<id>/<width>.webp`, and served
 * at `/media/<id>/<width>.webp`. The widths are fixed per purpose and every one
 * is always written — a small original is simply stored small under the larger
 * name — so a path alone is enough to build a `srcset`, with no lookup.
 */

export const MEDIA_PURPOSES = ['dish', 'logo', 'cover'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

/** Ascending. The last is the one a stored path names. */
export const MEDIA_WIDTHS: Record<MediaPurpose, readonly number[]> = {
  // A menu thumbnail, the dish page's hero, and a tablet or desktop preview.
  dish: [320, 640, 1280],
  // Shown at most ~200px wide on the guest home; 640 covers a 3× screen.
  logo: [160, 320, 640],
  // Full-bleed behind the arch, phone to desktop.
  cover: [640, 1280, 1920],
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATH = new RegExp(`^/media/(${UUID})/(\\d{2,4})\\.webp$`, 'i');

export function mediaPath(id: string, width: number): string {
  return `/media/${id}/${width}.webp`;
}

/** The object key in storage for one width. */
export function mediaKey(id: string, width: number): string {
  return `media/${id}/${width}.webp`;
}

export function parseMediaPath(value: string | null | undefined): { id: string; width: number } | null {
  const match = value ? PATH.exec(value.trim()) : null;
  return match ? { id: match[1]!.toLowerCase(), width: Number(match[2]) } : null;
}

export function isMediaPath(value: string | null | undefined): boolean {
  return parseMediaPath(value) !== null;
}

/**
 * A `srcset` for an uploaded picture, or undefined for anything else (a
 * pasted URL, a seeded photograph) — which then renders exactly as before.
 *
 * The widths come from the path's own width: it is the largest of its
 * purpose's set, and each set is unique by its largest.
 */
export function mediaSrcSet(value: string | null | undefined): string | undefined {
  const parsed = parseMediaPath(value);
  if (!parsed) return undefined;
  const widths = Object.values(MEDIA_WIDTHS).find((set) => set.at(-1) === parsed.width);
  if (!widths) return undefined;
  return widths.map((w) => `${mediaPath(parsed.id, w)} ${w}w`).join(', ');
}
