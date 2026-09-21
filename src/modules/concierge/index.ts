/**
 * The concierge module's service interface.
 *
 * P4 in the plan, and only its READ half exists: a guest can browse the list
 * the hotel curated. What is deliberately absent — and what the guest screen
 * says out loud rather than implying — is everything that writes. No admin
 * screens for adding a place, no nightly travel-time refresh from Google
 * Places, and no saving a day of your own, which is what `itineraries` and
 * `itinerary_stops` are for.
 *
 * Built this far because a demo needs a real screen more than it needs a
 * finished feature, and a read path over the real tables is a truthful version
 * of one. See D-069.
 */
export { listPlacesForProperty } from './pois';

export {
  planDay, partForCategory, partAtHour, describeTrip, PARTS, PART_LABELS,
} from './plan';
export type { PlannedPlace, PlanSection, PartOfDay } from './plan';
