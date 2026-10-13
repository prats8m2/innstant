import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/db';
import { getDish } from '@/modules/catalog';
import { cartItems, cartItemModifiers, carts } from '@/db/schema/ordering';
import { NotFoundError, ConflictError } from '@/lib/errors';
import { addToCart, setCartItemQuantity, removeCartItem } from './cart';
import { cartsIn, type OrderContext } from './context';
import { canQuickAdd, defaultOptionIds } from './quick-add-rules';

/**
 * Adding and removing a dish from the menu list, without opening it.
 *
 * The RULES — which dishes qualify, and what selection a quick add carries —
 * live in `quick-add-rules.ts`, which imports no database. They are the part
 * worth testing in isolation, and a test that has to stand up Postgres to
 * check that an unavailable default does not count is a test nobody runs.
 * This file is the part that touches the cart.
 */

export interface QuickAdjustInput {
  tenantId: string;
  propertyId: string;
  context: OrderContext;
  outletId: string;
  menuItemId: string;
}

/** One more, at the chef's own settings. */
export async function quickAddDish(tx: Tx, input: QuickAdjustInput): Promise<void> {
  const detail = await getDish(tx, {
    propertyId: input.propertyId,
    itemId: input.menuItemId,
  });
  if (!detail) throw new NotFoundError('That dish is no longer on the menu.');

  if (!canQuickAdd(detail.modifierGroups)) {
    // The card should not have offered this, but a stale page can post it.
    throw new ConflictError(`${detail.dish.name} needs a choice — open it to order.`);
  }

  // Everything else — availability, the kitchen being open, the price — is
  // re-checked inside addToCart(). A form is a suggestion.
  await addToCart(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    context: input.context,
    menuItemId: input.menuItemId,
    quantity: 1,
    modifierOptionIds: defaultOptionIds(detail.modifierGroups),
  });
}

/**
 * One fewer.
 *
 * Which line? The default one — the line a plus on this card would have
 * created. If the guest has only ever ordered this dish with choices of their
 * own, that line does not exist, and the newest line for the dish is taken
 * instead: a minus that does nothing because the guest used the long way round
 * is worse than a minus that removes the thing they most recently added.
 *
 * Returns false when there was nothing to remove, so the caller can stay quiet
 * rather than raise an error at somebody tapping a stale screen.
 */
export async function quickRemoveDish(tx: Tx, input: QuickAdjustInput): Promise<boolean> {
  const cart = await tx.select({ id: carts.id })
    .from(carts)
    .where(and(
      eq(carts.propertyId, input.propertyId),
      cartsIn(input.context),
      eq(carts.outletId, input.outletId),
    ))
    .limit(1);

  const cartId = cart[0]?.id;
  if (!cartId) return false;

  const lines = await tx.select({
    id: cartItems.id,
    quantity: cartItems.quantity,
    notes: cartItems.notes,
  })
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.menuItemId, input.menuItemId)))
    .orderBy(desc(cartItems.createdAt));

  if (!lines.length) return false;

  const detail = await getDish(tx, {
    propertyId: input.propertyId,
    itemId: input.menuItemId,
  });
  const wanted = new Set(detail ? defaultOptionIds(detail.modifierGroups) : []);

  // The options actually on each candidate line, so "the default line" is
  // decided on what is in the cart rather than on what we hope is there.
  const chosen = await tx.select({
    cartItemId: cartItemModifiers.cartItemId,
    optionId: cartItemModifiers.modifierOptionId,
  })
    .from(cartItemModifiers)
    .where(inArray(cartItemModifiers.cartItemId, lines.map((l) => l.id)));

  const optionsByLine = new Map<string, Set<string>>();
  for (const row of chosen) {
    const set = optionsByLine.get(row.cartItemId) ?? new Set<string>();
    set.add(row.optionId);
    optionsByLine.set(row.cartItemId, set);
  }

  const isDefaultLine = (lineId: string, notes: string | null) => {
    if (notes) return false;
    const set = optionsByLine.get(lineId) ?? new Set<string>();
    return set.size === wanted.size && [...set].every((id) => wanted.has(id));
  };

  const target = lines.find((l) => isDefaultLine(l.id, l.notes)) ?? lines[0]!;

  if (target.quantity <= 1) {
    await removeCartItem(tx, { context: input.context, cartItemId: target.id });
    return true;
  }

  await setCartItemQuantity(tx, {
    context: input.context,
    cartItemId: target.id,
    quantity: target.quantity - 1,
  });
  return true;
}
