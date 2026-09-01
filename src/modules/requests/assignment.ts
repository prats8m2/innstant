import type { OnDutyStaff } from '@/modules/housekeeping';

/**
 * The ranking half of auto-routing, kept apart from the queries.
 *
 * Its own file for a mechanical reason with a real consequence: anything
 * importing `@/db` drags the connection pool in, and a unit test of a pure
 * function should not need a database URL to run. `transitions.ts` is split from
 * `advance-request.ts` for exactly this, and the rule here deserves the same —
 * it is the one piece of routing a hotel will argue with.
 */

/**
 * Pick the assignee. Pure, so the rule can be tested without a shift table.
 *
 * Fewest open jobs wins. Ties break on the NAME rather than on who clocked in
 * first: "longest on duty" would hand the busiest evening to whoever arrived
 * earliest, and a stable alphabetical tie-break is at least explainable to the
 * person who keeps getting picked.
 */
export function pickAssignee(
  candidates: readonly OnDutyStaff[],
  openCounts: ReadonlyMap<string, number>,
): OnDutyStaff | null {
  if (!candidates.length) return null;

  return [...candidates].sort((a, b) => {
    const byLoad = (openCounts.get(a.staffUserId) ?? 0) - (openCounts.get(b.staffUserId) ?? 0);
    if (byLoad !== 0) return byLoad;
    return a.fullName.localeCompare(b.fullName);
  })[0]!;
}
