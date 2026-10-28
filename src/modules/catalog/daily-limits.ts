import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { recordEvent, type Tx } from '@/db';
import { menuItemDailySales, menuItems } from '@/db/schema/catalog';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';

/**
 * "Only 20 today" (D-086). See migration 0012 for why this is a counter and
 * why it cannot oversell.
 */

export interface PortionLine {
  menuItemId: string;
  quantity: number;
}

/** Sum the quantities per dish: a cart can hold one dish on two lines. */
function perDish(lines: readonly PortionLine[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.menuItemId, (totals.get(line.menuItemId) ?? 0) + line.quantity);
  }
  return totals;
}

/**
 * Take portions of limited dishes for one order, all or nothing.
 *
 * Called by placeOrder() inside its own transaction, so a refusal here
 * rolls back the whole order: no half-placed order, no folio line, no
 * ticket. Each limited dish is one statement: an upsert that adds only if
 * the total stays within the limit, so two orders racing for the last
 * portion queue on the row and exactly one of them gets it.
 *
 * Dishes with no limit are not touched and cost nothing.
 */
export async function claimDailyPortions(
  tx: Tx,
  input: { tenantId: string; businessDate: string; lines: readonly PortionLine[] },
): Promise<void> {
  const wanted = perDish(input.lines);
  if (wanted.size === 0) return;

  const limited = await tx.select({
    id: menuItems.id, name: menuItems.name, dailyLimit: menuItems.dailyLimit,
  }).from(menuItems)
    .where(and(inArray(menuItems.id, [...wanted.keys()]), isNotNull(menuItems.dailyLimit)));

  for (const dish of limited) {
    const quantity = wanted.get(dish.id)!;
    const limit = dish.dailyLimit!;

    const claimed = await tx.execute<{ sold: number }>(sql`
      INSERT INTO menu_item_daily_sales (tenant_id, menu_item_id, business_date, sold)
      SELECT ${input.tenantId}, ${dish.id}, ${input.businessDate}, ${quantity}
      WHERE ${quantity} <= ${limit}
      ON CONFLICT (menu_item_id, business_date) DO UPDATE
        SET sold = menu_item_daily_sales.sold + EXCLUDED.sold, updated_at = now()
        WHERE menu_item_daily_sales.sold + EXCLUDED.sold <= ${limit}
      RETURNING sold
    `);

    if (!claimed.rows[0]) {
      const left = await portionsLeft(tx, dish.id, limit, input.businessDate);
      throw new ConflictError(left === 0
        ? `${dish.name} has sold out for today. Take it out of the order to send the rest.`
        : `Only ${left} ${dish.name} left today. Change the quantity to ${left} or fewer.`);
    }
  }
}

/**
 * Give portions back: an order rejected or cancelled no longer holds them.
 * Never below zero, and only for dishes that had a limit when sold.
 */
export async function releaseDailyPortions(
  tx: Tx,
  input: { businessDate: string; lines: readonly PortionLine[] },
): Promise<void> {
  for (const [menuItemId, quantity] of perDish(input.lines)) {
    await tx.update(menuItemDailySales)
      .set({ sold: sql`GREATEST(${menuItemDailySales.sold} - ${quantity}, 0)`, updatedAt: new Date() })
      .where(and(
        eq(menuItemDailySales.menuItemId, menuItemId),
        eq(menuItemDailySales.businessDate, input.businessDate),
      ));
  }
}

async function portionsLeft(tx: Tx, menuItemId: string, limit: number, businessDate: string): Promise<number> {
  const row = await tx.select({ sold: menuItemDailySales.sold }).from(menuItemDailySales)
    .where(and(
      eq(menuItemDailySales.menuItemId, menuItemId),
      eq(menuItemDailySales.businessDate, businessDate),
    )).limit(1);
  return Math.max(limit - (row[0]?.sold ?? 0), 0);
}

/**
 * Portions left today, for each LIMITED dish among these (others are absent
 * from the map). What the menu read and the cart use to say "only 3 left"
 * and "sold out today".
 */
export async function portionsLeftToday(
  tx: Tx,
  input: { itemIds: readonly string[]; businessDate: string },
): Promise<Map<string, { limit: number; left: number }>> {
  const result = new Map<string, { limit: number; left: number }>();
  if (input.itemIds.length === 0) return result;

  const rows = await tx.select({
    id: menuItems.id,
    limit: menuItems.dailyLimit,
    sold: menuItemDailySales.sold,
  }).from(menuItems)
    .leftJoin(menuItemDailySales, and(
      eq(menuItemDailySales.menuItemId, menuItems.id),
      eq(menuItemDailySales.businessDate, input.businessDate),
    ))
    .where(and(inArray(menuItems.id, [...input.itemIds]), isNotNull(menuItems.dailyLimit)));

  for (const row of rows) {
    result.set(row.id, { limit: row.limit!, left: Math.max(row.limit! - (row.sold ?? 0), 0) });
  }
  return result;
}

/** Set or clear a dish's daily limit. A pricing-adjacent act, so it is logged. */
export async function setDailyLimit(
  tx: Tx,
  input: {
    tenantId: string; propertyId: string; outletId: string;
    itemId: string; dailyLimit: number | null; actorStaffId: string;
  },
): Promise<{ name: string }> {
  if (input.dailyLimit !== null && (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 1 || input.dailyLimit > 10_000)) {
    throw new ValidationError('A daily limit is a whole number of portions, at least 1.');
  }
  // Saving a dish's other fields posts its limit too; an unchanged one is not
  // an event, or every edit would claim the limit was set again.
  const current = (await tx.select({ dailyLimit: menuItems.dailyLimit, name: menuItems.name })
    .from(menuItems)
    .where(and(eq(menuItems.id, input.itemId), eq(menuItems.outletId, input.outletId), isNull(menuItems.archivedAt)))
    .limit(1))[0];
  if (!current) throw new NotFoundError('That dish is not on this menu.');
  if (current.dailyLimit === input.dailyLimit) return { name: current.name };

  const updated = await tx.update(menuItems)
    .set({ dailyLimit: input.dailyLimit, updatedAt: new Date() })
    .where(and(
      eq(menuItems.id, input.itemId),
      eq(menuItems.outletId, input.outletId),
      isNull(menuItems.archivedAt),
    ))
    .returning({ name: menuItems.name });
  if (!updated[0]) throw new NotFoundError('That dish is not on this menu.');

  await recordEvent(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    entityType: 'menu_item',
    entityId: input.itemId,
    eventType: 'menu_item.daily_limit_set',
    actor: { kind: 'STAFF', staffUserId: input.actorStaffId },
    payload: { name: updated[0].name, dailyLimit: input.dailyLimit },
  });
  return { name: updated[0].name };
}
