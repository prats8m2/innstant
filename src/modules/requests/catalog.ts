import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/db';
import { requestTypes, serviceRequests, serviceRequestItems } from '@/db/schema/requests';
import type { CurrencyCode } from '@/lib/money';

/**
 * The request catalog, as a guest sees it.
 *
 * `request_types` is the property-configurable list behind BOTH "order
 * amenities" and "call for service" — one generic screen, and the ops team
 * self-serves (DATA-MODEL §7). Nine of its columns were written by the seeder
 * and read by nothing until this file; the sweep listed every one.
 *
 * Free and chargeable in ONE list, deliberately. The reference says it in the
 * line at the top of the screen — "Ask for as much as you like. Anything with a
 * price says so before you send it" — and separating them into paid and free
 * tabs would make asking for a towel feel like shopping.
 */

export interface RequestTypeCard {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: 'AMENITY' | 'SERVICE' | 'MAINTENANCE' | 'HOUSEKEEPING';
  iconKey: string | null;
  priceMinor: number;
  currency: CurrencyCode;
  isChargeable: boolean;
  /** The promise on the card AND the SLA deadline. One number, not two. */
  slaMinutes: number;
  allowsQuantity: boolean;
  maxQuantity: number;
  allowsNote: boolean;
  allowsPhoto: boolean;
}

const CARD_COLUMNS = {
  id: requestTypes.id,
  key: requestTypes.key,
  name: requestTypes.name,
  description: requestTypes.description,
  category: requestTypes.category,
  iconKey: requestTypes.iconKey,
  priceMinor: requestTypes.priceMinor,
  currency: requestTypes.currency,
  isChargeable: requestTypes.isChargeable,
  slaMinutes: requestTypes.slaMinutes,
  allowsQuantity: requestTypes.allowsQuantity,
  maxQuantity: requestTypes.maxQuantity,
  allowsNote: requestTypes.allowsNote,
  allowsPhoto: requestTypes.allowsPhoto,
};

function shape(row: {
  category: string; currency: string;
} & Omit<RequestTypeCard, 'category' | 'currency'>): RequestTypeCard {
  return {
    ...row,
    category: row.category as RequestTypeCard['category'],
    currency: row.currency as CurrencyCode,
  };
}

/**
 * Everything a guest may ask for, in the property's own order.
 *
 * `is_active` and `archived_at` are both respected: a property switches a type
 * off for the season and archives one it will never offer again (D-008 — the
 * archived row stays so an old request still resolves).
 */
export async function getRequestCatalog(
  tx: Tx,
  input: {
    propertyId: string;
    /** Narrow to one category — the amenities screen shows three of the four. */
    categories?: readonly RequestTypeCard['category'][];
  },
): Promise<RequestTypeCard[]> {
  const rows = await tx.select(CARD_COLUMNS).from(requestTypes)
    .where(and(
      eq(requestTypes.propertyId, input.propertyId),
      eq(requestTypes.isActive, true),
      isNull(requestTypes.archivedAt),
    ))
    .orderBy(asc(requestTypes.sortOrder), asc(requestTypes.name));

  const cards = rows.map(shape);
  if (!input.categories) return cards;

  const wanted = new Set(input.categories);
  return cards.filter((card) => wanted.has(card.category));
}

/**
 * One type by its stable key.
 *
 * The one-tap service call needs `CALL_SERVICE` without knowing its uuid, and a
 * key is what survives a property renaming the thing ("Call for service" →
 * "Ring for the butler"). Returns null if a property has switched it off, which
 * the screen has to handle rather than assume.
 */
export async function getRequestTypeByKey(
  tx: Tx,
  input: { propertyId: string; key: string },
): Promise<RequestTypeCard | null> {
  const rows = await tx.select(CARD_COLUMNS).from(requestTypes)
    .where(and(
      eq(requestTypes.propertyId, input.propertyId),
      eq(requestTypes.key, input.key),
      eq(requestTypes.isActive, true),
      isNull(requestTypes.archivedAt),
    ))
    .limit(1);

  return rows[0] ? shape(rows[0]) : null;
}

/** The key the one-tap call uses. Seeded on every property. */
export const CALL_SERVICE_KEY = 'CALL_SERVICE';

/**
 * What this property's guests actually ask for.
 *
 * ─── Why counted and not configured ────────────────────────────────────────
 *
 * The amenities screen leads with a handful of one-tap chips, and something
 * has to decide which. The tempting answer is a `is_featured` column somebody
 * ticks. The better one is already in the database: every request ever sent
 * carries its `request_type_id`, so the property can be asked rather than
 * guessed — and the answer improves on its own as the hotel is used, without
 * anybody maintaining it.
 *
 * It also cannot be wrong in the way a curated list can. A GM who ticks
 * "bathrobe" because the brand deck says so is overruled by ninety guests a
 * month asking for towels.
 *
 * ─── The window, and the fallback ──────────────────────────────────────────
 *
 * Ninety days: long enough that a quiet fortnight does not reshuffle the
 * screen, short enough to follow a season. A property with no history yet
 * returns nothing here, and the caller falls back to the catalogue's own
 * order — a new hotel gets a sensible screen on its first night rather than an
 * empty strip.
 */
export async function countRequestsByType(
  tx: Tx,
  input: { propertyId: string; sinceDays?: number },
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - (input.sinceDays ?? 90) * 86_400_000);

  const rows = await tx
    .select({
      requestTypeId: serviceRequestItems.requestTypeId,
      asked: sql<number>`sum(${serviceRequestItems.quantity})::int`,
    })
    .from(serviceRequestItems)
    .innerJoin(serviceRequests, eq(serviceRequests.id, serviceRequestItems.serviceRequestId))
    .where(and(
      eq(serviceRequests.propertyId, input.propertyId),
      gte(serviceRequests.createdAt, since),
    ))
    .groupBy(serviceRequestItems.requestTypeId);

  const counts = new Map<string, number>();
  for (const row of rows) {
    // Null once the type has been deleted — the snapshot on the item keeps the
    // old request readable (#6), but there is nothing left to rank.
    if (row.requestTypeId) counts.set(row.requestTypeId, row.asked);
  }
  return counts;
}
