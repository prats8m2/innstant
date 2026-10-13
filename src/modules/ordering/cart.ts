import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '@/db';
import { carts, cartItems, cartItemModifiers } from '@/db/schema/ordering';
import { getDish, getCartPricing } from '@/modules/catalog';
import type { DishModifierGroup } from '@/modules/catalog';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { type CurrencyCode, money, formatMoney } from '@/lib/money';
import type { LocalTime } from '@/lib/clock';
import { calculateTotals, type OrderTotals } from './totals';
import { cartsIn, contextColumns, type OrderContext } from './context';

/**
 * The cart. One per `(context, outlet)` — CLAUDE.md #10: keyed on the STAY,
 * never the room, because rooms are reused and the next guest must not inherit
 * an abandoned cart. D-079 adds the second kind of context, a VISIT, and the
 * same sentence is true of it: a table is reused, and the next diner must not
 * inherit the last one's cart.
 *
 * ─── Live prices, not snapshots ────────────────────────────────────────────
 *
 * `cart_items` holds live foreign keys and stores no name or price. That is
 * deliberate and it is the opposite of `order_items` (#6): a cart is
 * pre-transactional, so a dish repriced or pulled while it sits in a cart
 * should change in the cart. Snapshotting happens once, at placement.
 *
 * The consequence is real and has to be shown, not hidden: a total can differ
 * between the cart screen and the confirmation. The cart read below reports
 * `unavailableLines` so the screen can say so.
 */

const MAX_QUANTITY = 20;
const MAX_NOTE_LENGTH = 280;

export interface CartLineModifier {
  optionId: string;
  name: string;
  priceDeltaMinor: number;
  /** "Nothing" under an optional group. Recorded, but not worth printing. */
  isNoOp: boolean;
}

export interface CartLine {
  id: string;
  menuItemId: string;
  name: string;
  unitPriceMinor: number;
  modifiers: CartLineModifier[];
  /** Unit price plus modifiers, times quantity. */
  lineTotalMinor: number;
  quantity: number;
  notes: string | null;
  /** The dish or one of its modifiers went off the menu while this sat here. */
  isAvailable: boolean;
  /** Carried so placement can snapshot it (#6) — a receipt shows the dish as it
   *  was sold. Nothing displays it yet; no screen has images until R2 exists. */
  imageUrl: string | null;
}

export interface Cart {
  id: string;
  outletId: string;
  currency: CurrencyCode;
  lines: CartLine[];
  totals: OrderTotals;
  /** Sum of quantities — what the cart pill shows. */
  itemCount: number;
}

export interface CartOutletConfig {
  outletId: string;
  currency: CurrencyCode;
  taxRateBps: number;
  serviceChargeBps: number;
  deliveryFeeMinor: number;
}

/**
 * One cart per (context, outlet), created on first use.
 *
 * `ON CONFLICT DO NOTHING` then re-select rather than a check-then-insert: two
 * taps on "Add to order" arrive concurrently often enough that the race is
 * real, and the unique index is the only thing that actually settles it.
 *
 * D-079 — the index behind that `ON CONFLICT` is now two PARTIAL indexes, one
 * per context, because a composite unique over a nullable column stops
 * constraining the rows where it is null (0008 explains it at length). The
 * conflict target is still inferred, and still resolves, because exactly one of
 * the two columns is non-null on any row this writes.
 */
export async function getOrCreateCart(
  tx: Tx,
  input: { tenantId: string; propertyId: string; context: OrderContext; outletId: string },
): Promise<{ id: string }> {
  await tx.insert(carts).values({
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    ...contextColumns(input.context),
    outletId: input.outletId,
  }).onConflictDoNothing();

  const rows = await tx.select({ id: carts.id }).from(carts)
    .where(and(cartsIn(input.context), eq(carts.outletId, input.outletId)))
    .limit(1);

  const cart = rows[0];
  if (!cart) {
    // Only reachable if the insert was rejected by RLS — which means the stay
    // or visit is not this tenant's, and saying more would confirm it exists.
    throw new NotFoundError('cart could not be opened for this context');
  }
  return cart;
}

/**
 * Validates a modifier selection against the dish's own groups.
 *
 * Server side, always. The screen preselects defaults and enforces min/max in
 * the UI, and none of that is a guarantee — a selection arrives as form data
 * and is exactly as trustworthy as anything else a client sends.
 */
function assertSelectionIsValid(
  groups: readonly DishModifierGroup[],
  optionIds: readonly string[],
): void {
  const chosen = new Set(optionIds);
  const known = new Set(groups.flatMap((g) => g.options.map((o) => o.id)));

  for (const id of chosen) {
    if (!known.has(id)) {
      throw new ValidationError('That option is not on this dish.', { optionId: id });
    }
  }

  for (const group of groups) {
    const picked = group.options.filter((o) => chosen.has(o.id));

    for (const option of picked) {
      if (!option.isAvailable) {
        throw new ConflictError(`${option.name} has run out. Choose another and try again.`);
      }
    }

    if (picked.length > group.maxSelections) {
      throw new ValidationError(
        `Choose at most ${group.maxSelections} under ${group.name}.`,
        { group: group.name },
      );
    }
    if (picked.length < group.minSelections) {
      throw new ValidationError(`Choose ${group.name.toLowerCase()} before adding this.`, {
        group: group.name,
      });
    }
  }
}

export interface AddToCartInput {
  tenantId: string;
  propertyId: string;
  context: OrderContext;
  menuItemId: string;
  quantity: number;
  notes?: string | null;
  modifierOptionIds?: readonly string[];
}

/**
 * Adds a dish to the cart, or bumps an identical line already in it.
 *
 * "Identical" is the same dish, the same note, and the same set of modifiers.
 * Merging matters because a guest who taps Add twice means two, and a cart with
 * "Laal maas x1" listed twice is a cart they cannot edit sensibly.
 */
export async function addToCart(
  tx: Tx,
  input: AddToCartInput,
): Promise<{ cartId: string; cartItemId: string; quantity: number }> {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new ValidationError('Choose at least one.');
  }
  if (input.quantity > MAX_QUANTITY) {
    throw new ValidationError(
      `That is more than we can send up in one order. Call the desk for ${input.quantity}.`,
    );
  }

  const notes = input.notes?.trim() || null;
  if (notes && notes.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(`Keep the note under ${MAX_NOTE_LENGTH} characters.`);
  }

  const detail = await getDish(tx, {
    propertyId: input.propertyId,
    itemId: input.menuItemId,
  });
  if (!detail) throw new NotFoundError('That dish is no longer on the menu.');
  if (!detail.dish.isAvailable) {
    throw new ConflictError(`${detail.dish.name} is off the menu tonight.`);
  }
  if (!detail.outlet.isAcceptingOrders) {
    throw new ConflictError('The kitchen has stopped taking orders for tonight.');
  }

  const optionIds = [...new Set(input.modifierOptionIds ?? [])].sort();
  assertSelectionIsValid(detail.modifierGroups, optionIds);

  const cart = await getOrCreateCart(tx, {
    tenantId: input.tenantId,
    propertyId: input.propertyId,
    context: input.context,
    outletId: detail.outlet.id,
  });

  const existing = await findIdenticalLine(tx, cart.id, input.menuItemId, notes, optionIds);
  if (existing) {
    const quantity = Math.min(existing.quantity + input.quantity, MAX_QUANTITY);
    await tx.update(cartItems)
      .set({ quantity, updatedAt: new Date() })
      .where(eq(cartItems.id, existing.id));
    return { cartId: cart.id, cartItemId: existing.id, quantity };
  }

  const [line] = await tx.insert(cartItems).values({
    tenantId: input.tenantId,
    cartId: cart.id,
    menuItemId: input.menuItemId,
    quantity: input.quantity,
    notes,
  }).returning({ id: cartItems.id });

  if (optionIds.length) {
    await tx.insert(cartItemModifiers).values(
      optionIds.map((modifierOptionId) => ({
        tenantId: input.tenantId,
        cartItemId: line!.id,
        modifierOptionId,
      })),
    );
  }

  return { cartId: cart.id, cartItemId: line!.id, quantity: input.quantity };
}

/** The line this add would merge into, if there is one. */
async function findIdenticalLine(
  tx: Tx,
  cartId: string,
  menuItemId: string,
  notes: string | null,
  optionIds: readonly string[],
): Promise<{ id: string; quantity: number } | null> {
  const candidates = await tx
    .select({ id: cartItems.id, quantity: cartItems.quantity, notes: cartItems.notes })
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.menuItemId, menuItemId)));

  const sameNote = candidates.filter((c) => (c.notes ?? null) === notes);
  if (!sameNote.length) return null;

  const modifiers = await tx
    .select({ cartItemId: cartItemModifiers.cartItemId, optionId: cartItemModifiers.modifierOptionId })
    .from(cartItemModifiers)
    .where(inArray(cartItemModifiers.cartItemId, sameNote.map((c) => c.id)));

  const key = optionIds.join(',');
  for (const candidate of sameNote) {
    const theirs = modifiers
      .filter((m) => m.cartItemId === candidate.id)
      .map((m) => m.optionId)
      .sort()
      .join(',');
    if (theirs === key) return { id: candidate.id, quantity: candidate.quantity };
  }
  return null;
}

export async function setCartItemQuantity(
  tx: Tx,
  input: { context: OrderContext; cartItemId: string; quantity: number },
): Promise<void> {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw new ValidationError('That is not a quantity.');
  }
  if (input.quantity > MAX_QUANTITY) {
    throw new ValidationError('Call the desk for an order that size.');
  }

  const line = await lineInOwnCart(tx, input.context, input.cartItemId);

  // Zero means remove. A stepper that bottoms out at 1 and needs a separate
  // delete control is two ways to do one thing.
  if (input.quantity === 0) {
    await tx.delete(cartItems).where(eq(cartItems.id, line.id));
    return;
  }

  await tx.update(cartItems)
    .set({ quantity: input.quantity, updatedAt: new Date() })
    .where(eq(cartItems.id, line.id));
}

export async function removeCartItem(
  tx: Tx,
  input: { context: OrderContext; cartItemId: string },
): Promise<void> {
  const line = await lineInOwnCart(tx, input.context, input.cartItemId);
  await tx.delete(cartItems).where(eq(cartItems.id, line.id));
}

/**
 * Resolves a cart line id against THIS context's cart.
 *
 * RLS confines the row to the tenant; this confines it to the guest. Without
 * it, a line id from another room in the same hotel would be editable — or,
 * since D-079, from another table in the same restaurant — and that id travels
 * in a form.
 */
async function lineInOwnCart(
  tx: Tx,
  context: OrderContext,
  cartItemId: string,
): Promise<{ id: string }> {
  const rows = await tx
    .select({ id: cartItems.id })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .where(and(eq(cartItems.id, cartItemId), cartsIn(context)))
    .limit(1);

  const line = rows[0];
  if (!line) throw new NotFoundError('That is no longer in your order.');
  return line;
}

/**
 * The cart, priced. Returns null when this context has never opened one — which
 * is different from an empty cart, and the screen says different things.
 */
export async function getCart(
  tx: Tx,
  input: {
    propertyId: string;
    context: OrderContext;
    outlet: CartOutletConfig;
    /**
     * Property-local time, so a dish outside its schedule prices as unavailable
     * (`menu_item_availability_windows`). Optional because the pricing read
     * treats absence as "no schedule applied" — every guest-facing caller and
     * `placeOrder()` pass it.
     */
    at?: LocalTime;
  },
): Promise<Cart | null> {
  const cartRows = await tx.select({ id: carts.id, outletId: carts.outletId })
    .from(carts)
    .where(and(cartsIn(input.context), eq(carts.outletId, input.outlet.outletId)))
    .limit(1);

  const cart = cartRows[0];
  if (!cart) return null;

  const rows = await tx
    .select({
      id: cartItems.id,
      menuItemId: cartItems.menuItemId,
      quantity: cartItems.quantity,
      notes: cartItems.notes,
    })
    .from(cartItems)
    .where(eq(cartItems.cartId, cart.id))
    .orderBy(asc(cartItems.createdAt));

  if (!rows.length) {
    return {
      id: cart.id,
      outletId: cart.outletId,
      currency: input.outlet.currency,
      lines: [],
      totals: calculateTotals([], input.outlet),
      itemCount: 0,
    };
  }

  const modifiers = await tx
    .select({ cartItemId: cartItemModifiers.cartItemId, optionId: cartItemModifiers.modifierOptionId })
    .from(cartItemModifiers)
    .where(inArray(cartItemModifiers.cartItemId, rows.map((r) => r.id)));

  const pricing = await getCartPricing(tx, {
    propertyId: input.propertyId,
    itemIds: rows.map((r) => r.menuItemId),
    optionIds: modifiers.map((m) => m.optionId),
    at: input.at,
  });

  const lines: CartLine[] = rows.map((row) => {
    const item = pricing.items.get(row.menuItemId);
    const chosen = modifiers
      .filter((m) => m.cartItemId === row.id)
      .map((m) => ({ optionId: m.optionId, option: pricing.options.get(m.optionId) }));

    const lineModifiers: CartLineModifier[] = chosen.map(({ optionId, option }) => ({
      optionId,
      // An archived option keeps its place in the line rather than silently
      // vanishing and quietly reducing the price.
      name: option?.name ?? 'No longer offered',
      priceDeltaMinor: option?.priceDeltaMinor ?? 0,
      isNoOp: option?.isNoOp ?? false,
    }));

    const modifiersMinor = lineModifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0);
    const unitPriceMinor = item?.priceMinor ?? 0;

    return {
      id: row.id,
      menuItemId: row.menuItemId,
      name: item?.name ?? 'No longer on the menu',
      unitPriceMinor,
      modifiers: lineModifiers,
      lineTotalMinor: (unitPriceMinor + modifiersMinor) * row.quantity,
      quantity: row.quantity,
      notes: row.notes,
      isAvailable:
        (item?.isAvailable ?? false) && chosen.every(({ option }) => option?.isAvailable ?? false),
      imageUrl: item?.imageUrl ?? null,
    };
  });

  // An unavailable line is shown but does not price into the total — the guest
  // is not charged for a dish the kitchen has already said it cannot cook.
  const totals = calculateTotals(
    lines.filter((l) => l.isAvailable).map((l) => ({
      unitPriceMinor: l.unitPriceMinor,
      modifiersMinor: l.modifiers.reduce((sum, m) => sum + m.priceDeltaMinor, 0),
      quantity: l.quantity,
    })),
    input.outlet,
  );

  return {
    id: cart.id,
    outletId: cart.outletId,
    currency: input.outlet.currency,
    lines,
    totals,
    itemCount: lines.filter((l) => l.isAvailable).reduce((sum, l) => sum + l.quantity, 0),
  };
}

/** What the "Add to order" button shows before anything is in the cart. */
export function formatAddButtonTotal(
  unitPriceMinor: number,
  modifiersMinor: number,
  quantity: number,
  currency: CurrencyCode,
): string {
  return formatMoney(money((unitPriceMinor + modifiersMinor) * quantity, currency));
}
