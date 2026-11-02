import { sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import type { CurrencyCode } from '@/lib/money';

export interface Collection {
  method: string;
  /** Money in, today. */
  takenMinor: number;
  /** Money given back, today. */
  refundedMinor: number;
  payments: number;
}

/**
 * What the desk took today, by how it arrived (D-097) — the numbers a cash
 * drawer and a card machine's settlement are closed against. Property-local
 * day; refunds counted separately rather than netted, because a drawer that
 * paid ₹500 out in change has to show the ₹500.
 */
export async function collectionsToday(
  tx: Tx,
  input: { propertyId: string; timeZone: string },
): Promise<{ rows: Collection[]; currency: CurrencyCode }> {
  const tz = input.timeZone;
  const result = await tx.execute<{ method: string | null; taken: number; refunded: number; payments: number; currency: string | null }>(sql`
    SELECT COALESCE(p.method, 'OTHER') AS method,
           COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status = 'CAPTURED'), 0)::int AS taken,
           COALESCE(SUM(p.amount_minor) FILTER (WHERE p.status = 'REFUNDED'), 0)::int AS refunded,
           COUNT(*)::int AS payments,
           MIN(p.currency) AS currency
    FROM payments p
    WHERE p.property_id = ${input.propertyId}
      AND p.status IN ('CAPTURED', 'REFUNDED')
      AND p.captured_at >= (date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})
    GROUP BY 1
    ORDER BY 2 DESC
  `);
  return {
    rows: result.rows.map((r) => ({
      method: r.method ?? 'OTHER', takenMinor: Number(r.taken), refundedMinor: Number(r.refunded), payments: Number(r.payments),
    })),
    currency: (result.rows[0]?.currency ?? 'INR') as CurrencyCode,
  };
}
