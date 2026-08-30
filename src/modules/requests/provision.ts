import { eq } from 'drizzle-orm';
import type { Tx } from '@/db';
import { requestTypes } from '@/db/schema/requests';

/**
 * The ~20 standard request types every property starts with (DATA-MODEL §10).
 *
 * This catalog is what makes "order amenities" and "call the service boy" one
 * generic guest UI — and it is property-editable, so the ops team self-serves
 * instead of filing a ticket with us (§7).
 *
 * Two things encoded here that matter:
 *  - `isChargeable: false` on most of them. #9 — free requests must work at the
 *    base REQUEST tier with no verification prompt. Only the chargeable ones
 *    trip escalation.
 *  - `slaMinutes` is the promise the guest sees ("usually 12 minutes") AND the
 *    deadline the SLA sweep escalates against. One number, not two.
 */
interface RequestTypeSeed {
  key: string;
  name: string;
  category: 'AMENITY' | 'SERVICE' | 'MAINTENANCE' | 'HOUSEKEEPING';
  priceMinor: number;
  slaMinutes: number;
  routeToRoleKey: string;
  allowsQuantity?: boolean;
  maxQuantity?: number;
  allowsPhoto?: boolean;
  iconKey?: string;
}

export const DEFAULT_REQUEST_TYPES: readonly RequestTypeSeed[] = [
  // Free amenities — the majority, deliberately. Nothing here costs the hotel
  // enough to be worth a verification prompt.
  { key: 'EXTRA_TOWELS',   name: 'Extra towels',        category: 'AMENITY', priceMinor: 0, slaMinutes: 12, routeToRoleKey: 'HOUSEKEEPING', allowsQuantity: true, maxQuantity: 4, iconKey: 'towel' },
  { key: 'EXTRA_PILLOW',   name: 'Extra pillow',        category: 'AMENITY', priceMinor: 0, slaMinutes: 12, routeToRoleKey: 'HOUSEKEEPING', allowsQuantity: true, maxQuantity: 4, iconKey: 'pillow' },
  { key: 'EXTRA_BLANKET',  name: 'Extra blanket',       category: 'AMENITY', priceMinor: 0, slaMinutes: 15, routeToRoleKey: 'HOUSEKEEPING', allowsQuantity: true, maxQuantity: 2, iconKey: 'blanket' },
  { key: 'IRON_BOARD',     name: 'Iron and board',      category: 'AMENITY', priceMinor: 0, slaMinutes: 15, routeToRoleKey: 'HOUSEKEEPING', iconKey: 'iron' },
  { key: 'SLIPPERS',       name: 'Slippers',            category: 'AMENITY', priceMinor: 0, slaMinutes: 12, routeToRoleKey: 'HOUSEKEEPING', allowsQuantity: true, maxQuantity: 2, iconKey: 'slippers' },
  { key: 'SEWING_KIT',     name: 'Sewing kit',          category: 'AMENITY', priceMinor: 0, slaMinutes: 15, routeToRoleKey: 'HOUSEKEEPING', iconKey: 'sewing' },
  { key: 'TOILETRIES',     name: 'Toiletries',          category: 'AMENITY', priceMinor: 0, slaMinutes: 12, routeToRoleKey: 'HOUSEKEEPING', iconKey: 'toiletries' },
  { key: 'DRINKING_WATER', name: 'Drinking water',      category: 'AMENITY', priceMinor: 0, slaMinutes: 10, routeToRoleKey: 'RUNNER',       allowsQuantity: true, maxQuantity: 6, iconKey: 'water' },
  { key: 'PHONE_CHARGER',  name: 'Phone charger',       category: 'AMENITY', priceMinor: 0, slaMinutes: 15, routeToRoleKey: 'RUNNER',       iconKey: 'charger' },
  { key: 'ADAPTER',        name: 'Travel adapter',      category: 'AMENITY', priceMinor: 0, slaMinutes: 15, routeToRoleKey: 'RUNNER',       iconKey: 'adapter' },

  // Housekeeping
  { key: 'ROOM_CLEANING',  name: 'Clean my room',       category: 'HOUSEKEEPING', priceMinor: 0, slaMinutes: 45, routeToRoleKey: 'HOUSEKEEPING', iconKey: 'clean' },
  { key: 'TURNDOWN',       name: 'Turndown service',    category: 'HOUSEKEEPING', priceMinor: 0, slaMinutes: 30, routeToRoleKey: 'HOUSEKEEPING', iconKey: 'bed' },
  { key: 'BIN_EMPTY',      name: 'Empty the bin',       category: 'HOUSEKEEPING', priceMinor: 0, slaMinutes: 20, routeToRoleKey: 'HOUSEKEEPING', iconKey: 'bin' },

  // Service — "call someone", the one-tap action
  { key: 'CALL_SERVICE',   name: 'Call for service',    category: 'SERVICE', priceMinor: 0, slaMinutes: 8,  routeToRoleKey: 'RUNNER',    iconKey: 'bell' },
  { key: 'LUGGAGE_HELP',   name: 'Help with luggage',   category: 'SERVICE', priceMinor: 0, slaMinutes: 10, routeToRoleKey: 'RUNNER',    iconKey: 'luggage' },
  { key: 'WAKE_UP_CALL',   name: 'Wake-up call',        category: 'SERVICE', priceMinor: 0, slaMinutes: 5,  routeToRoleKey: 'FRONT_DESK', iconKey: 'clock' },

  // Maintenance — photo enabled; a picture of the leak saves a trip
  { key: 'AC_ISSUE',       name: 'Air conditioning',    category: 'MAINTENANCE', priceMinor: 0, slaMinutes: 30, routeToRoleKey: 'HOUSEKEEPING', allowsPhoto: true, iconKey: 'ac' },
  { key: 'PLUMBING_ISSUE', name: 'Plumbing',            category: 'MAINTENANCE', priceMinor: 0, slaMinutes: 30, routeToRoleKey: 'HOUSEKEEPING', allowsPhoto: true, iconKey: 'tap' },
  { key: 'ELECTRICAL',     name: 'Lights or power',     category: 'MAINTENANCE', priceMinor: 0, slaMinutes: 25, routeToRoleKey: 'HOUSEKEEPING', allowsPhoto: true, iconKey: 'bulb' },
  { key: 'WIFI_ISSUE',     name: 'Wi-Fi trouble',       category: 'MAINTENANCE', priceMinor: 0, slaMinutes: 20, routeToRoleKey: 'FRONT_DESK',   iconKey: 'wifi' },

  // Chargeable — these are what trip the one verification prompt (D-012)
  { key: 'LAUNDRY',        name: 'Laundry service',     category: 'SERVICE', priceMinor: 45_000,  slaMinutes: 60,  routeToRoleKey: 'HOUSEKEEPING', allowsQuantity: true, maxQuantity: 10, iconKey: 'laundry' },
  { key: 'MINIBAR_RESTOCK',name: 'Restock the minibar', category: 'SERVICE', priceMinor: 0,       slaMinutes: 45,  routeToRoleKey: 'RUNNER',       iconKey: 'minibar' },
  { key: 'AIRPORT_TRANSFER', name: 'Airport transfer',  category: 'SERVICE', priceMinor: 180_000, slaMinutes: 120, routeToRoleKey: 'FRONT_DESK',   iconKey: 'car' },
];

/**
 * One SELECT and one bulk INSERT, not two queries per type.
 *
 * Provisioning runs across the network — 23 types at two round trips each was
 * ~12 seconds of pure latency, which blew the integration-test hook timeout and
 * would be just as slow onboarding a real hotel.
 */
export async function seedDefaultRequestTypes(
  tx: Tx,
  input: { tenantId: string; propertyId: string; currency?: string },
): Promise<number> {
  const existing = await tx.select({ key: requestTypes.key })
    .from(requestTypes)
    .where(eq(requestTypes.propertyId, input.propertyId));
  const have = new Set(existing.map((r) => r.key));

  const missing = DEFAULT_REQUEST_TYPES
    .map((seed, index) => ({ seed, index }))
    .filter(({ seed }) => !have.has(seed.key));
  if (!missing.length) return 0;

  await tx.insert(requestTypes).values(missing.map(({ seed, index }) => ({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    key: seed.key,
    name: seed.name,
    category: seed.category,
    iconKey: seed.iconKey ?? null,
    priceMinor: seed.priceMinor,
    currency: input.currency ?? 'INR',
    isChargeable: seed.priceMinor > 0,
    slaMinutes: seed.slaMinutes,
    routeToRoleKey: seed.routeToRoleKey,
    allowsQuantity: seed.allowsQuantity ?? false,
    maxQuantity: seed.maxQuantity ?? 1,
    allowsPhoto: seed.allowsPhoto ?? false,
    sortOrder: index,
  })));

  return missing.length;
}
