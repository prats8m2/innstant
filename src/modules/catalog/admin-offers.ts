import { and, asc, eq, isNull } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { menuCategories, menuItems, menuOffers, outlets } from '@/db/schema/catalog';
import { NotFoundError, ValidationError } from '@/lib/errors';
import type { OfferKind, OfferScope } from './offers';
import { validateDates, validateDays, validateWindow } from './schedule-validate';

/**
 * Automatic offers, the editor's half (D-085). Every write leaves an
 * `event_log` row; a change of how much an offer takes off is a pricing act,
 * and the history has to be able to say what the offer was on the day a
 * guest was charged under it.
 */

export interface AdminOffer {
  id: string;
  name: string;
  scope: OfferScope;
  menuItemId: string | null;
  categoryId: string | null;
  /** The dish's or section's name, or null for the whole menu. */
  targetName: string | null;
  kind: OfferKind;
  percentBps: number | null;
  amountMinor: number | null;
  currency: string;
  availableFrom: string | null;
  availableUntil: string | null;
  daysOfWeek: number[] | null;
  startsOn: string | null;
  endsOn: string | null;
  isActive: boolean;
  createdAt: Date;
}

export async function listOffers(tx: Tx, input: { outletId: string }): Promise<AdminOffer[]> {
  const rows = await tx.select({
    id: menuOffers.id,
    name: menuOffers.name,
    scope: menuOffers.scope,
    menuItemId: menuOffers.menuItemId,
    categoryId: menuOffers.categoryId,
    dishName: menuItems.name,
    categoryName: menuCategories.name,
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
    .leftJoin(menuItems, eq(menuItems.id, menuOffers.menuItemId))
    .leftJoin(menuCategories, eq(menuCategories.id, menuOffers.categoryId))
    .where(and(eq(menuOffers.outletId, input.outletId), isNull(menuOffers.archivedAt)))
    .orderBy(asc(menuOffers.createdAt));

  return rows.map(({ dishName, categoryName, ...row }) => ({
    ...row,
    targetName: row.scope === 'DISH' ? dishName : row.scope === 'CATEGORY' ? categoryName : null,
  }));
}

export interface OfferWriteInput {
  tenantId: string;
  propertyId: string;
  outletId: string;
  name: string;
  scope: OfferScope;
  /** DISH only. */
  menuItemId?: string | null;
  /** CATEGORY only. */
  categoryId?: string | null;
  kind: OfferKind;
  /** PERCENT only. 2000 = 20%. */
  percentBps?: number | null;
  /** AMOUNT only, in the outlet's currency. */
  amountMinor?: number | null;
  availableFrom?: string | null;
  availableUntil?: string | null;
  daysOfWeek?: readonly number[] | null;
  startsOn?: string | null;
  endsOn?: string | null;
  isActive?: boolean;
  actorStaffId: string;
}

/** Everything about an offer that is checked before it is stored. */
async function validated(tx: Tx, input: OfferWriteInput) {
  const name = input.name.trim();
  if (!name) throw new ValidationError('Give the offer a name a guest would understand.');
  if (name.length > 80) throw new ValidationError('That name is too long for a menu card.');

  const outlet = (await tx.select({ currency: outlets.currency }).from(outlets)
    .where(and(eq(outlets.id, input.outletId), isNull(outlets.archivedAt))).limit(1))[0];
  if (!outlet) throw new NotFoundError('No such outlet at this property.');

  // The target, checked against THIS outlet: an id from another menu is
  // refused, not stored as an offer that silently applies to nothing.
  let menuItemId: string | null = null;
  let categoryId: string | null = null;
  if (input.scope === 'DISH') {
    if (!input.menuItemId) throw new ValidationError('Pick the dish it is for.');
    const dish = await tx.select({ id: menuItems.id }).from(menuItems).where(and(
      eq(menuItems.id, input.menuItemId), eq(menuItems.outletId, input.outletId),
      isNull(menuItems.archivedAt),
    )).limit(1);
    if (!dish[0]) throw new ValidationError('That dish is not on this menu.');
    menuItemId = input.menuItemId;
  } else if (input.scope === 'CATEGORY') {
    if (!input.categoryId) throw new ValidationError('Pick the section it is for.');
    const category = await tx.select({ id: menuCategories.id }).from(menuCategories).where(and(
      eq(menuCategories.id, input.categoryId), eq(menuCategories.outletId, input.outletId),
      isNull(menuCategories.archivedAt),
    )).limit(1);
    if (!category[0]) throw new ValidationError('That section is not on this menu.');
    categoryId = input.categoryId;
  }

  let percentBps: number | null = null;
  let amountMinor: number | null = null;
  if (input.kind === 'PERCENT') {
    const bps = input.percentBps ?? 0;
    if (!Number.isInteger(bps) || bps < 1 || bps > 10_000) {
      throw new ValidationError('A percentage off is between 0.01% and 100%.');
    }
    percentBps = bps;
  } else {
    const amount = input.amountMinor ?? 0;
    if (!Number.isInteger(amount) || amount < 1) {
      throw new ValidationError('An amount off is more than nothing.');
    }
    amountMinor = amount;
  }

  const window = validateWindow(input.availableFrom, input.availableUntil);
  return {
    name,
    scope: input.scope,
    menuItemId,
    categoryId,
    kind: input.kind,
    percentBps,
    amountMinor,
    // #5: an amount is in the outlet's currency, said on the row.
    currency: outlet.currency,
    availableFrom: window.from,
    availableUntil: window.until,
    daysOfWeek: validateDays(input.daysOfWeek),
    ...validateDates(input.startsOn, input.endsOn),
  };
}

export async function createOffer(tx: Tx, input: OfferWriteInput): Promise<{ id: string }> {
  const values = await validated(tx, input);
  const [row] = await tx.insert(menuOffers).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    outletId: input.outletId,
    ...values,
    isActive: input.isActive ?? true,
  }).returning({ id: menuOffers.id });

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_offer',
    entityId: row!.id,
    eventType: 'menu_offer.created',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: summary(values),
  });
  return { id: row!.id };
}

export async function updateOffer(
  tx: Tx,
  input: OfferWriteInput & { offerId: string },
): Promise<void> {
  const values = await validated(tx, input);
  const updated = await tx.update(menuOffers)
    .set({
      ...values,
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(and(
      eq(menuOffers.id, input.offerId),
      eq(menuOffers.outletId, input.outletId),
      isNull(menuOffers.archivedAt),
    ))
    .returning({ id: menuOffers.id });
  if (!updated[0]) throw new NotFoundError('That offer is not on this menu.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_offer',
    entityId: input.offerId,
    eventType: 'menu_offer.updated',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { ...summary(values), isActive: input.isActive ?? null },
  });
}

/** Archived, never deleted: a receipt's `offer_id` may still point at it. */
export async function archiveOffer(
  tx: Tx,
  input: { tenantId: string; propertyId: string; outletId: string; offerId: string; actorStaffId: string },
): Promise<{ name: string }> {
  const archived = await tx.update(menuOffers)
    .set({ archivedAt: new Date(), isActive: false, updatedAt: new Date() })
    .where(and(
      eq(menuOffers.id, input.offerId),
      eq(menuOffers.outletId, input.outletId),
      isNull(menuOffers.archivedAt),
    ))
    .returning({ id: menuOffers.id, name: menuOffers.name });
  if (!archived[0]) throw new NotFoundError('That offer is not on this menu.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_offer',
    entityId: input.offerId,
    eventType: 'menu_offer.archived',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name: archived[0].name },
  });
  return { name: archived[0].name };
}

/** What the audit row says: enough to know what the offer WAS that day. */
function summary(values: Awaited<ReturnType<typeof validated>>) {
  return {
    name: values.name,
    scope: values.scope,
    menuItemId: values.menuItemId,
    categoryId: values.categoryId,
    kind: values.kind,
    percentBps: values.percentBps,
    amountMinor: values.amountMinor,
    currency: values.currency,
    window: values.availableFrom ? `${values.availableFrom}-${values.availableUntil}` : null,
    daysOfWeek: values.daysOfWeek,
    startsOn: values.startsOn,
    endsOn: values.endsOn,
  };
}
