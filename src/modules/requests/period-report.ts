import { sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { emptySeries, windowSql, type ReportWindow } from '@/lib/report-window';

/**
 * Requests finished over a report period, and how many inside their promise —
 * the console overview's "Requests on time".
 *
 * What counts, exactly:
 *
 *   finished  a request that reached COMPLETED or VERIFIED, with its
 *             `completed_at` in the window, and that HAD a promise
 *             (`sla_target_at`). A refused or cancelled request was never
 *             done, so it is neither on time nor late; a request type with no
 *             promise cannot be judged against one.
 *   on time   of those, `completed_at <= sla_target_at` — the same comparison
 *             the SLA sweep breaches on, so a request the duty manager was
 *             alerted about is never counted as on time here.
 *
 * Bucketed by the hotel's hour (today) or day (7/30 days), by `completed_at`.
 * Read-only, over this module's own table (D-001).
 */
export interface RequestsPeriod {
  finishedByBucket: number[];
  onTimeByBucket: number[];
}

export interface RequestsReport {
  current: RequestsPeriod;
  previous: RequestsPeriod;
}

async function period(
  tx: Tx,
  input: { propertyId: string; window: ReportWindow },
  which: 'current' | 'previous',
): Promise<RequestsPeriod> {
  const w = windowSql(input.window, which);
  const rows = (await tx.execute<{ bucket: number; finished: number; on_time: number }>(sql`
    SELECT ${w.bucketOf(sql`completed_at`)} AS bucket,
           count(*)::int AS finished,
           count(*) FILTER (WHERE completed_at <= sla_target_at)::int AS on_time
    FROM service_requests
    WHERE property_id = ${input.propertyId}
      AND status IN ('COMPLETED', 'VERIFIED')
      AND sla_target_at IS NOT NULL
      AND completed_at >= ${w.start} AND completed_at < ${w.end}
    GROUP BY 1
  `)).rows;

  const out: RequestsPeriod = {
    finishedByBucket: emptySeries(input.window),
    onTimeByBucket: emptySeries(input.window),
  };
  for (const row of rows) {
    const i = Number(row.bucket);
    if (i < 0 || i >= input.window.buckets) continue;
    out.finishedByBucket[i] = Number(row.finished);
    out.onTimeByBucket[i] = Number(row.on_time);
  }
  return out;
}

export async function requestsReport(
  tx: Tx,
  input: { propertyId: string; window: ReportWindow },
): Promise<RequestsReport> {
  return {
    current: await period(tx, input, 'current'),
    previous: await period(tx, input, 'previous'),
  };
}
