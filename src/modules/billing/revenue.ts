import { sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { windowSql, type ReportWindow } from '@/lib/report-window';
import {
  addToParts, emptyParts, type FolioSource, type RevenueLine, type RevenueParts,
} from './revenue-rules';

/**
 * What was posted to folios over a report period, split into the parts of
 * revenue `revenue-rules.ts` defines — rooms, services, corrections to food,
 * and whole-bill credits — per bucket of the period and in total, for the
 * current window and the one it is compared with.
 *
 * By `created_at`: the day a charge was POSTED, which is the day it is revenue
 * on a folio. A room charge the desk adds at checkout for three nights is
 * that day's room revenue; there is no nightly room posting in this product
 * yet (rates are reserved for booking, CLAUDE.md #11), and the overview says
 * so rather than inventing nights.
 *
 * Only lines in the property's currency; nothing is converted (#5).
 * Read-only, over this module's own tables (D-001).
 */
export interface PostedRevenuePeriod {
  total: RevenueParts;
  byBucket: RevenueParts[];
}

export interface PostedRevenueReport {
  current: PostedRevenuePeriod;
  previous: PostedRevenuePeriod;
}

async function period(
  tx: Tx,
  input: { propertyId: string; window: ReportWindow; currency: string },
  which: 'current' | 'previous',
): Promise<PostedRevenuePeriod> {
  const w = windowSql(input.window, which);
  // Grouped by everything the rule reads, so a busy month is a few dozen rows.
  const rows = (await tx.execute<{
    bucket: number; source: FolioSource; category: string | null;
    t_source: FolioSource | null; t_category: string | null; tb_category: string | null;
    reverses: FolioSource | null; amount: number;
  }>(sql`
    SELECT ${w.bucketOf(sql`l.created_at`)} AS bucket,
           l.source, l.category,
           t.source AS t_source, t.category AS t_category, tb.category AS tb_category,
           CASE WHEN l.source = 'ADJUSTMENT' AND t.id IS NULL AND l.source_ref_id IS NOT NULL THEN (
             SELECT r.source FROM folio_lines r
             WHERE r.folio_id = l.folio_id AND r.source_ref_id = l.source_ref_id
               AND r.source IN ('ORDER', 'SERVICE_REQUEST', 'CHECKOUT_FEE')
             LIMIT 1
           ) END AS reverses,
           sum(l.amount_minor)::bigint AS amount
    FROM folio_lines l
    LEFT JOIN folio_lines t ON t.id = l.source_ref_id AND t.folio_id = l.folio_id
    LEFT JOIN folio_lines tb ON tb.id = t.source_ref_id AND tb.folio_id = t.folio_id
    WHERE l.property_id = ${input.propertyId}
      AND l.currency = ${input.currency}
      AND l.source NOT IN ('PAYMENT', 'ORDER')
      AND l.created_at >= ${w.start} AND l.created_at < ${w.end}
    GROUP BY 1, 2, 3, 4, 5, 6, 7
  `)).rows;

  const total = emptyParts();
  const byBucket = Array.from({ length: input.window.buckets }, emptyParts);
  for (const row of rows) {
    const line: RevenueLine = {
      source: row.source,
      category: row.category,
      target: row.t_source
        ? { source: row.t_source, category: row.t_category, targetCategory: row.tb_category }
        : null,
      reverses: row.reverses,
    };
    const amount = Number(row.amount);
    addToParts(total, line, amount);
    const i = Number(row.bucket);
    if (i >= 0 && i < byBucket.length) addToParts(byBucket[i]!, line, amount);
  }
  return { total, byBucket };
}

export async function postedRevenueReport(
  tx: Tx,
  input: { propertyId: string; window: ReportWindow; currency: string },
): Promise<PostedRevenueReport> {
  return {
    current: await period(tx, input, 'current'),
    previous: await period(tx, input, 'previous'),
  };
}
