import { sql } from 'drizzle-orm';
import type { Tx } from '@/db';

export interface HousekeeperDay {
  /** Requests this person finished today, property-local. */
  done: number;
  /** How many of those were finished inside their SLA target. */
  onTime: number;
}

/**
 * One housekeeper's day, for the strip at the top of the floor board (D-090).
 *
 * The same two questions the runner's strip answers — "how many have I done"
 * and "am I quick" — asked of `service_requests`. Quick here means inside the
 * target the request type promised, not minutes, because towels at twelve
 * minutes and a plumber at forty are not comparable as averages.
 *
 * "Done" is `completed_at`, set on COMPLETED and kept through VERIFIED, and the
 * owner is `assigned_staff_id` — which the board's claim sets and a completion
 * by somebody else deliberately does not (see `moveRequest`).
 */
export async function housekeeperDay(
  tx: Tx,
  input: { propertyId: string; staffUserId: string; timeZone: string },
): Promise<HousekeeperDay> {
  const tz = input.timeZone;
  const todayStart = sql`(date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
  const [row] = (await tx.execute<{ done: number; on_time: number }>(sql`
    SELECT count(*)::int AS done,
           count(*) FILTER (WHERE sla_target_at IS NULL OR completed_at <= sla_target_at)::int AS on_time
    FROM service_requests
    WHERE property_id = ${input.propertyId}
      AND assigned_staff_id = ${input.staffUserId}
      AND completed_at >= ${todayStart}
  `)).rows;
  return { done: row?.done ?? 0, onTime: row?.on_time ?? 0 };
}
