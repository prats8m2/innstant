import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Tx } from '@/db';
import { pois } from '@/db/schema/concierge';
import type { PlannedPlace } from './plan';

/**
 * Reading the curated list. P4's write side — the admin screens, the nightly
 * travel-time refresh, saving a guest's own itinerary — does not exist yet.
 *
 * This is deliberately the whole module for now. It is enough to put a real
 * screen in front of a guest, and every row it returns came out of `pois`
 * through RLS like anything else, rather than out of a fixture in the page.
 */
export async function listPlacesForProperty(
  tx: Tx,
  input: { propertyId: string },
): Promise<PlannedPlace[]> {
  const rows = await tx
    .select({
      id: pois.id,
      name: pois.name,
      category: pois.category,
      editorialNote: pois.editorialNote,
      description: pois.description,
      walkMinutes: pois.walkMinutes,
      driveMinutes: pois.driveMinutes,
      isPartner: pois.isPartner,
      partnerOffer: pois.partnerOffer,
    })
    .from(pois)
    .where(and(
      eq(pois.propertyId, input.propertyId),
      eq(pois.isActive, true),
      isNull(pois.archivedAt),
    ))
    .orderBy(asc(pois.sortOrder), asc(pois.name));

  return rows;
}
