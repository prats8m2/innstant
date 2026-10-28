import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '@/db';
import { menuOffers } from '@/db/schema/catalog';
import type { MenuOffer } from './offers';

/**
 * Every offer that COULD apply on this outlet: switched on, not archived.
 *
 * The schedule is applied in memory by `bestOffer()`, for the reason
 * collections do it that way (menu.ts): a window past midnight, days and
 * dates are one tested function there and a tangle of clauses in SQL, and an
 * outlet has a handful of offers, not thousands.
 */
export async function offersForOutlet(tx: Tx, outletId: string): Promise<MenuOffer[]> {
  return tx.select({
    id: menuOffers.id,
    name: menuOffers.name,
    scope: menuOffers.scope,
    menuItemId: menuOffers.menuItemId,
    categoryId: menuOffers.categoryId,
    kind: menuOffers.kind,
    percentBps: menuOffers.percentBps,
    amountMinor: menuOffers.amountMinor,
    currency: menuOffers.currency,
    availableFrom: menuOffers.availableFrom,
    availableUntil: menuOffers.availableUntil,
    daysOfWeek: menuOffers.daysOfWeek,
    startsOn: menuOffers.startsOn,
    endsOn: menuOffers.endsOn,
    isActive: menuOffers.isActive,
    createdAt: menuOffers.createdAt,
  }).from(menuOffers)
    .where(and(
      eq(menuOffers.outletId, outletId),
      eq(menuOffers.isActive, true),
      isNull(menuOffers.archivedAt),
    ));
}
