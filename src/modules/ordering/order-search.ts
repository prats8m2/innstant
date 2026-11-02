import { sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { likeContains } from '@/lib/search';
import type { OrderStatus } from './transitions';

/**
 * Orders by number, for the console's search (⌘K).
 *
 * The needle is the letters and digits of what was typed (`orderNeedle()`),
 * matched against the letters and digits of the stored number, so "KE-1186",
 * "ke1186" and "1186" all find KE-1186. Newest first: a number quoted down
 * the phone is almost always tonight's.
 *
 * A draft is a cart nobody sent and has no number a guest could quote, so it
 * is not found. The room comes from the stay behind a room order, for the
 * desk's one-room view; a visit's order (D-079) has none.
 */
export interface OrderHit {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  /** The snapshot a cook reads: "Room 214", "Table 4", "Takeaway · Priya". */
  destination: string | null;
  roomId: string | null;
  placedAt: Date | null;
}

export async function searchOrders(
  tx: Tx,
  input: { propertyId: string; needle: string; limit?: number },
): Promise<OrderHit[]> {
  if (!input.needle) return [];
  const rows = await tx.execute<{
    id: string; order_number: string; status: OrderStatus;
    destination_label: string | null; room_id: string | null;
    placed_at: string | Date | null;
  }>(sql`
    SELECT o.id, o.order_number, o.status, o.destination_label, s.room_id, o.placed_at
    FROM orders o
    LEFT JOIN stays s ON s.id = o.stay_id
    WHERE o.property_id = ${input.propertyId}
      AND o.status <> 'DRAFT'
      AND upper(regexp_replace(o.order_number, '[^A-Za-z0-9]', '', 'g'))
          LIKE ${likeContains(input.needle)}
    ORDER BY o.placed_at DESC NULLS LAST, o.created_at DESC
    LIMIT ${input.limit ?? 5}
  `);

  return rows.rows.map((row) => ({
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    destination: row.destination_label,
    roomId: row.room_id,
    placedAt: row.placed_at ? new Date(row.placed_at) : null,
  }));
}
