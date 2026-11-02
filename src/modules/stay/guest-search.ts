import { sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { likeContains } from '@/lib/search';

/**
 * Guests by name, for the console's search (⌘K).
 *
 * Anyone with a stay at THIS property, ever — `guests` is tenant-wide, and a
 * group's other hotels' guests are not this desk's to find. Somebody in the
 * house now comes first, with the room they are in, because the desk that
 * types a name is usually holding a phone with that person on it.
 *
 * Matches the desk's name for them and the one they gave themselves
 * (`display_name`, D-081), anywhere in the name: "nair" finds Priya Nair.
 * Read-only, and RLS applies to every row.
 */
export interface GuestHit {
  id: string;
  fullName: string;
  /** The room they are checked in to now, or null. */
  inRoom: string | null;
  lastStayAt: Date;
}

export async function searchGuests(
  tx: Tx,
  input: { propertyId: string; query: string; limit?: number },
): Promise<GuestHit[]> {
  const term = input.query.trim();
  if (!term) return [];
  const pattern = likeContains(term);

  /* Raw for the aggregate: one row per guest, the room only from a stay that
     is open now. Joining rooms by id is a read across modules' tables, the
     same narrow projection front-desk and the kitchen ticket take. */
  const rows = await tx.execute<{
    id: string; full_name: string; in_room: string | null; last_stay_at: string | Date;
  }>(sql`
    SELECT g.id, g.full_name,
           (array_agg(r.number ORDER BY s.created_at DESC)
              FILTER (WHERE s.status = 'CHECKED_IN'))[1] AS in_room,
           max(s.created_at) AS last_stay_at
    FROM stays s
    JOIN guests g ON g.id = s.guest_id
    JOIN rooms r ON r.id = s.room_id
    WHERE s.property_id = ${input.propertyId}
      AND (g.full_name ILIKE ${pattern} OR g.display_name ILIKE ${pattern})
    GROUP BY g.id, g.full_name
    ORDER BY bool_or(s.status = 'CHECKED_IN') DESC, max(s.created_at) DESC
    LIMIT ${input.limit ?? 5}
  `);

  return rows.rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    inRoom: row.in_room,
    lastStayAt: new Date(row.last_stay_at),
  }));
}
