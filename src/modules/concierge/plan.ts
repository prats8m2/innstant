/**
 * Turning a list of places into a day.
 *
 * Pure, and in its own file for the reason `guest-name.ts` and
 * `kitchen-ticket.ts` are: the interesting part is a decision table, and a test
 * for it should not have to stand up Postgres.
 *
 * ─── Why the part of day is derived and not stored ─────────────────────────
 *
 * The obvious move is a `part_of_day` column on `pois`. It was not taken, for
 * two reasons.
 *
 * A place is not a time. Jagdish Temple is a morning thing because it is
 * quiet at seven and heaving at eleven, not because somebody tagged it; the
 * Ambrai ghat is an evening thing because that is where the sun goes. Those
 * facts follow from WHAT THE PLACE IS, which the schema already records as
 * `category` — and a second column would let the two disagree, which is a bug
 * nobody would notice for months.
 *
 * And P4 has not been designed yet. Adding a column to one of its tables to
 * make a demo screen work is exactly the sort of decision EXTENSION-POINTS
 * exists to prevent: it looks free, and it commits the eventual design to a
 * model nobody has thought about. When P4 arrives and a GM wants to say "this
 * one is a morning place, whatever its category", that is the moment to add
 * the column — with the screen that edits it.
 */

export const PARTS = ['morning', 'afternoon', 'evening', 'night'] as const;
export type PartOfDay = (typeof PARTS)[number];

export const PART_LABELS: Record<PartOfDay, string> = {
  morning: 'This morning',
  afternoon: 'This afternoon',
  evening: 'This evening',
  night: 'After dark',
};

/**
 * What each kind of place is FOR, in a day.
 *
 * The fallback is `afternoon` — the part of the day that tolerates anything —
 * so a category nobody has mapped yet still appears on the screen instead of
 * vanishing from it. A place missing from a list is the failure a guest cannot
 * see and therefore cannot report.
 */
const PART_BY_CATEGORY: Record<string, PartOfDay> = {
  TEMPLE: 'morning',
  GHAT: 'morning',
  CAFE: 'morning',
  MARKET: 'afternoon',
  PALACE: 'afternoon',
  MUSEUM: 'afternoon',
  SHOPPING: 'afternoon',
  GARDEN: 'afternoon',
  VIEWPOINT: 'evening',
  EXPERIENCE: 'evening',
  DINING: 'night',
  BAR: 'night',
};

export function partForCategory(category: string): PartOfDay {
  return PART_BY_CATEGORY[category.toUpperCase()] ?? 'afternoon';
}

/**
 * Which part of the day it is, on the PROPERTY's clock.
 *
 * The bands match the greeting on the room home rather than being invented
 * again here — a guest told "good evening" and then shown "this afternoon" on
 * the next screen has caught the app not knowing what time it is.
 */
export function partAtHour(hour: number): PartOfDay {
  // Before five is still last night, which is what the room home says too. A
  // test caught this arriving as "morning": somebody reading at two would have
  // been shown temples that opened five hours later, under a heading
  // contradicting the greeting they had just been given.
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

export interface PlannedPlace {
  id: string;
  name: string;
  category: string;
  editorialNote: string | null;
  description: string | null;
  walkMinutes: number | null;
  driveMinutes: number | null;
  isPartner: boolean;
  partnerOffer: string | null;
}

export interface PlanSection {
  part: PartOfDay;
  label: string;
  /** True for the section the guest is standing in right now. */
  isNow: boolean;
  places: PlannedPlace[];
}

/**
 * The day, in order, starting from where the guest actually is.
 *
 * Rotated rather than sorted: at nine in the evening the useful screen opens
 * on dinner, not on a temple that shut six hours ago. The earlier parts still
 * follow, because "what did I miss" and "what about tomorrow" are the same
 * list.
 *
 * Empty sections are dropped. A heading with nothing under it reads as a
 * loading failure.
 */
export function planDay(places: PlannedPlace[], nowHour: number): PlanSection[] {
  const now = partAtHour(nowHour);
  const start = PARTS.indexOf(now);

  return PARTS
    .map((_, i) => PARTS[(start + i) % PARTS.length]!)
    .map((part) => ({
      part,
      label: PART_LABELS[part],
      isNow: part === now,
      places: places
        .filter((place) => partForCategory(place.category) === part)
        // Nearest first. Walking time is the only number a guest on foot in an
        // unfamiliar city actually uses; anything without one sorts last
        // rather than pretending to be next door.
        .sort((a, b) => (a.walkMinutes ?? 9999) - (b.walkMinutes ?? 9999)),
    }))
    .filter((section) => section.places.length > 0);
}

/** "6 min walk", "12 min drive", or nothing rather than a guess. */
export function describeTrip(place: PlannedPlace): string | null {
  if (place.walkMinutes !== null) return `${place.walkMinutes} min walk`;
  if (place.driveMinutes !== null) return `${place.driveMinutes} min drive`;
  return null;
}
