'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { findProperty } from '@/modules/identity';
import { localTimeAt } from '@/lib/clock';
import {
  createMenuCategory, updateMenuCategory, archiveMenuCategory,
  createMenuItem, updateMenuItem, setMenuItemAvailability, archiveMenuItem,
  setMenuItemPrice, arrangeMenu, startTodaysSpecial, addDishToCollection,
  setDailyLimit, repriceCategory, duplicateMenuItem,
  setMenuItemModifierGroups, setOutletAcceptingOrders,
  setMenuItemAvailabilityWindows,
  MENU_DIETARY_FLAGS,
} from '@/modules/catalog';
import type { ItemAvailabilityWindow } from '@/modules/catalog';
import { parseMoneyInput, parseRateBps, MoneyInputError, type CurrencyCode } from '@/lib/money';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The menu editor's mutations.
 *
 * Server Actions rather than route handlers, because they originate in our own
 * UI (CLAUDE.md "Conventions"). Zod parses at the edge and the domain functions
 * in `modules/catalog/admin.ts` take typed input — no `FormData` goes inward.
 *
 * ─── The permission split, and why it is not one check ─────────────────────
 *
 * `catalog:manage` edits the menu. `catalog:pricing` changes what a dish costs.
 * `catalog:availability` says whether it is on tonight. The KITCHEN role holds
 * only the last one on purpose (permissions.ts), so a hot-kitchen tablet that
 * is left signed in can 86 the sole and nothing else.
 *
 * A price change therefore needs BOTH `manage` and `pricing`: the form posts
 * one payload, and holding half the permissions must not let half of it land.
 */

export interface MenuActionState {
  error?: string;
  /** Set on success so the page can say what happened. */
  done?: string;
}

const Flags = z.enum(MENU_DIETARY_FLAGS);

/** Trim, then treat empty as absent. An empty text input is not a value. */
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const CategoryForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  categoryId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give the section a name.').max(120),
  description: optionalText(400),
});

const ItemForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  itemId: z.uuid().optional(),
  categoryId: z.uuid('Pick a section.'),
  name: z.string().trim().min(1, 'Give the dish a name.').max(120),
  description: optionalText(600),
  price: z.string().min(1, 'Enter a price.'),
  imageUrl: optionalText(500),
  spiceLevel: z.coerce.number().int().min(0).max(5).optional(),
  prepTimeMinutes: z.coerce.number().int().min(1).max(240).optional(),
  dailyLimit: z.coerce.number().int().min(1, 'A daily limit is at least 1.').max(10_000).optional(),
  isAvailable: z.boolean(),
  dietaryFlags: z.array(Flags),
  modifierGroupIds: z.array(z.uuid()),
});

/**
 * A row of the schedule table on the dish form.
 *
 * Three fixed rows rather than an add-a-row control: this form works with
 * JavaScript off, and a variable number of fields without it means a round trip
 * per row. Three covers breakfast, lunch and dinner; a fourth is a schema-free
 * change if anyone needs it.
 */
const SCHEDULE_ROWS = 3;

const ScheduleRow = z.object({
  dayOfWeek: z.union([z.literal(''), z.coerce.number().int().min(0).max(6)]),
  startsAt: z.string().regex(/^\d{1,2}:\d{2}$/, 'Times are 24-hour, like 07:00.'),
  endsAt: z.string().regex(/^\d{1,2}:\d{2}$/, 'Times are 24-hour, like 10:30.'),
});

function readSchedule(formData: FormData):
  { ok: true; windows: ItemAvailabilityWindow[] } | { ok: false; error: string } {
  const windows: ItemAvailabilityWindow[] = [];

  for (let i = 0; i < SCHEDULE_ROWS; i += 1) {
    const startsAt = String(formData.get(`windowStart-${i}`) ?? '').trim();
    const endsAt = String(formData.get(`windowEnd-${i}`) ?? '').trim();
    // A row with neither time is an empty row, not an error — that is how a
    // schedule is cleared.
    if (!startsAt && !endsAt) continue;

    const parsed = ScheduleRow.safeParse({
      dayOfWeek: formData.get(`windowDay-${i}`) ?? '',
      startsAt,
      endsAt,
    });
    if (!parsed.success) {
      return { ok: false, error: 'A schedule row needs both a start and an end.' };
    }

    windows.push({
      dayOfWeek: parsed.data.dayOfWeek === '' ? null : parsed.data.dayOfWeek,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
    });
  }

  return { ok: true, windows };
}

const AvailabilityForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  itemId: z.uuid(),
  isAvailable: z.boolean(),
});

const ArchiveItemForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  itemId: z.uuid(),
});

const ArchiveCategoryForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  categoryId: z.uuid(),
});

const OutletForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  isAcceptingOrders: z.boolean(),
});

/** The one place a thrown domain error becomes something a person reads. */
async function guard(
  what: string,
  run: () => Promise<MenuActionState>,
): Promise<MenuActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MoneyInputError) return { error: error.message };
    if (error instanceof AppError) {
      logger.info({ code: error.code, what }, 'menu edit refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message, what }, 'menu edit failed');
    throw error;
  }
}

export async function saveCategory(
  _previous: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const parsed = CategoryForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    categoryId: formData.get('categoryId') || undefined,
    name: formData.get('name') ?? '',
    description: formData.get('description') ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the section details.' };
  }
  const input = parsed.data;

  return guard('save category', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        const shared = {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          outletId: input.outletId,
          name: input.name,
          description: input.description,
          actorStaffId: session.staffUserId,
        };
        if (input.categoryId) {
          await updateMenuCategory(tx, { ...shared, categoryId: input.categoryId });
        } else {
          await createMenuCategory(tx, shared);
        }
      },
    );

    revalidatePath('/admin/menu');
    return { done: input.categoryId ? `${input.name} renamed.` : `${input.name} added.` };
  });
}

export async function archiveCategory(
  _previous: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const parsed = ArchiveCategoryForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    categoryId: formData.get('categoryId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('archive category', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => archiveMenuCategory(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        outletId: input.outletId,
        categoryId: input.categoryId,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/menu');
    return { done: 'Section archived.' };
  });
}

/**
 * Create or update a dish, and its modifier groups, in one transaction.
 *
 * One transaction because a dish saved without the option groups it was ticked
 * with is a dish that prices wrongly for as long as nobody notices.
 */
export async function saveItem(
  _previous: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const parsed = ItemForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    itemId: formData.get('itemId') || undefined,
    categoryId: formData.get('categoryId'),
    name: formData.get('name') ?? '',
    description: formData.get('description') ?? undefined,
    price: formData.get('price') ?? '',
    imageUrl: formData.get('imageUrl') ?? undefined,
    spiceLevel: formData.get('spiceLevel') || undefined,
    prepTimeMinutes: formData.get('prepTimeMinutes') || undefined,
    dailyLimit: formData.get('dailyLimit') || undefined,
    // An unchecked checkbox posts nothing at all, which is the difference
    // between "off" and "not on the form".
    isAvailable: formData.get('isAvailable') === 'on',
    dietaryFlags: formData.getAll('dietaryFlags').map(String),
    modifierGroupIds: formData.getAll('modifierGroupIds').map(String),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the dish details.' };
  }
  const input = parsed.data;

  const schedule = readSchedule(formData);
  if (!schedule.ok) return { error: schedule.error };

  const state = await guard('save item', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');
    // A price is a separate permission, and this payload carries one whether it
    // changed or not — so it is required on every save rather than diffed.
    await requirePermission(input.propertyId, 'catalog:pricing');

    const currency: CurrencyCode = 'INR';
    const price = parseMoneyInput(input.price, currency);

    const itemId = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        const shared = {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          outletId: input.outletId,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
          priceMinor: price.amountMinor,
          currency,
          dietaryFlags: input.dietaryFlags,
          spiceLevel: input.spiceLevel ?? null,
          prepTimeMinutes: input.prepTimeMinutes ?? null,
          imageUrl: input.imageUrl,
          isAvailable: input.isAvailable,
          actorStaffId: session.staffUserId,
        };

        const id = input.itemId
          ? (await updateMenuItem(tx, { ...shared, itemId: input.itemId }), input.itemId)
          : (await createMenuItem(tx, shared)).id;

        await setMenuItemModifierGroups(tx, {
          tenantId: session.tenantId,
          outletId: input.outletId,
          itemId: id,
          groupIds: input.modifierGroupIds,
        });

        await setDailyLimit(tx, {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          outletId: input.outletId,
          itemId: id,
          dailyLimit: input.dailyLimit ?? null,
          actorStaffId: session.staffUserId,
        });

        await setMenuItemAvailabilityWindows(tx, {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          outletId: input.outletId,
          itemId: id,
          windows: schedule.windows,
          actorStaffId: session.staffUserId,
        });

        return id;
      },
    );

    revalidatePath('/admin/menu');
    revalidatePath(`/admin/menu/${itemId}`);
    return { done: `${input.name} saved.` };
  });

  // Only on the way out, and only when nothing went wrong: `redirect()` throws,
  // and throwing it inside the try above would be caught as a failure.
  if (!state.error) redirect('/admin/menu');
  return state;
}

export async function toggleAvailability(
  _previous: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const parsed = AvailabilityForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    itemId: formData.get('itemId'),
    isAvailable: formData.get('isAvailable') === 'true',
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('toggle availability', async () => {
    // The thin permission: this is the one a kitchen holds.
    const session = await requirePermission(input.propertyId, 'catalog:availability');

    const { name } = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => setMenuItemAvailability(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        outletId: input.outletId,
        itemId: input.itemId,
        isAvailable: input.isAvailable,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/menu');
    // The guest's menu is rendered per request, so nothing to invalidate there.
    return { done: input.isAvailable ? `${name} is back on.` : `${name} is off tonight.` };
  });
}

export async function archiveItem(
  _previous: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const parsed = ArchiveItemForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    itemId: formData.get('itemId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('archive item', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');

    const { name } = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => archiveMenuItem(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        outletId: input.outletId,
        itemId: input.itemId,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/menu');
    return { done: `${name} taken off the menu. Past orders are unaffected.` };
  });
}

export async function toggleOutletOpen(
  _previous: MenuActionState,
  formData: FormData,
): Promise<MenuActionState> {
  const parsed = OutletForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    isAcceptingOrders: formData.get('isAcceptingOrders') === 'true',
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('toggle outlet', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:availability');

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => setOutletAcceptingOrders(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        outletId: input.outletId,
        isAcceptingOrders: input.isAcceptingOrders,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/menu');
    revalidatePath('/admin');
    return {
      done: input.isAcceptingOrders
        ? 'The kitchen is taking orders.'
        : 'The kitchen is closed to new orders.',
    };
  });
}

/* ── The menu studio's board ────────────────────────────────────────────────
 *
 * Called directly by the board rather than posted by a form: a drop, a price
 * typed into a cell and a switch flipped are each one gesture with a typed
 * payload, and the board needs the answer in place, not a redirect. Same
 * guard, same permissions as the forms above, re-checked here.
 */

const Ids = z.object({ propertyId: z.uuid(), outletId: z.uuid() });

const Arrangement = Ids.extend({
  sections: z.array(z.object({
    categoryId: z.uuid(),
    itemIds: z.array(z.uuid()).max(500),
  })).min(1).max(100),
});

/** A drop on the board: the whole arrangement (see `arrangeMenu`). */
export async function arrangeMenuFromBoard(input: unknown): Promise<MenuActionState> {
  const parsed = Arrangement.safeParse(input);
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const { propertyId, outletId, sections } = parsed.data;

  return guard('arrange menu', async () => {
    // Moving a dish between sections changes how the menu reads, which is a
    // menu edit, not a price and not tonight's availability.
    const session = await requirePermission(propertyId, 'catalog:manage');
    const { changed } = await withTenant(
      { tenantId: session.tenantId, propertyId },
      (tx) => arrangeMenu(tx, {
        tenantId: session.tenantId,
        propertyId,
        outletId,
        sections,
        actorStaffId: session.staffUserId,
      }),
    );
    revalidatePath('/admin/menu');
    return { done: changed ? 'Menu order saved.' : 'Nothing moved.' };
  });
}

const BoardPrice = Ids.extend({ itemId: z.uuid(), price: z.string().max(20) });

/** A price typed into a dish's cell on the board. */
export async function setPriceFromBoard(input: unknown): Promise<MenuActionState> {
  const parsed = BoardPrice.safeParse(input);
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const { propertyId, outletId, itemId, price } = parsed.data;

  return guard('set price', async () => {
    const session = await requirePermission(propertyId, 'catalog:pricing');
    // INR is the only currency a property can hold today; see saveItem.
    const parsedPrice = parseMoneyInput(price, 'INR');
    const result = await withTenant(
      { tenantId: session.tenantId, propertyId },
      (tx) => setMenuItemPrice(tx, {
        tenantId: session.tenantId,
        propertyId,
        outletId,
        itemId,
        priceMinor: parsedPrice.amountMinor,
        actorStaffId: session.staffUserId,
      }),
    );
    revalidatePath('/admin/menu');
    return { done: result.changed ? `${result.name} repriced.` : 'Same price — nothing changed.' };
  });
}

const BoardAvailability = Ids.extend({ itemId: z.uuid(), isAvailable: z.boolean() });

/** The on/off switch on a dish's row — tonight's 86, as on the kitchen board. */
export async function setAvailabilityFromBoard(input: unknown): Promise<MenuActionState> {
  const parsed = BoardAvailability.safeParse(input);
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const { propertyId, outletId, itemId, isAvailable } = parsed.data;

  return guard('toggle availability', async () => {
    const session = await requirePermission(propertyId, 'catalog:availability');
    const { name } = await withTenant(
      { tenantId: session.tenantId, propertyId },
      (tx) => setMenuItemAvailability(tx, {
        tenantId: session.tenantId,
        propertyId,
        outletId,
        itemId,
        isAvailable,
        actorStaffId: session.staffUserId,
      }),
    );
    revalidatePath('/admin/menu');
    return { done: isAvailable ? `${name} is back on.` : `${name} is off tonight.` };
  });
}

/* ── Menus on a schedule, from the board (D-084) ───────────────────────── */

/** "Today's special", one tap. Today is the HOTEL's today, read here. */
export async function startTodaysSpecialFromBoard(input: unknown): Promise<MenuActionState> {
  const parsed = Ids.safeParse(input);
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const { propertyId, outletId } = parsed.data;

  return guard('start todays special', async () => {
    const session = await requirePermission(propertyId, 'catalog:manage');
    const result = await withTenant(
      { tenantId: session.tenantId, propertyId },
      async (tx) => {
        const property = await findProperty(tx, propertyId);
        const today = localTimeAt(new Date(), property?.timezone ?? 'Asia/Kolkata').date!;
        return startTodaysSpecial(tx, {
          tenantId: session.tenantId, propertyId, outletId, today,
          actorStaffId: session.staffUserId,
        });
      },
    );
    revalidatePath('/admin/menu');
    revalidatePath('/admin/menu/collections');
    return {
      done: result.created || result.rolledOver
        ? 'Today’s special is ready. Drag dishes onto it; it ends by itself tonight.'
        : 'Today’s special is already on. Drag more dishes onto it.',
    };
  });
}

const DropOnCollection = Ids.extend({ collectionId: z.uuid(), menuItemId: z.uuid() });

/** A dish dropped on a collection's card: it joins it, and stays in its section. */
export async function addDishToCollectionFromBoard(input: unknown): Promise<MenuActionState> {
  const parsed = DropOnCollection.safeParse(input);
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const { propertyId, outletId, collectionId, menuItemId } = parsed.data;

  return guard('add dish to collection', async () => {
    const session = await requirePermission(propertyId, 'catalog:manage');
    const result = await withTenant(
      { tenantId: session.tenantId, propertyId },
      (tx) => addDishToCollection(tx, {
        tenantId: session.tenantId, propertyId, outletId, collectionId, menuItemId,
        actorStaffId: session.staffUserId,
      }),
    );
    revalidatePath('/admin/menu');
    revalidatePath('/admin/menu/collections');
    return {
      done: result.added
        ? `${result.dish} is in ${result.collection} now.`
        : `${result.dish} was already in ${result.collection}.`,
    };
  });
}

/* ── Step 4, from the board: duplicate, reprice a section ──────────────── */

const Duplicate = Ids.extend({ itemId: z.uuid() });

/** A copy of a dish under the original, off the guest menu until reviewed. */
export async function duplicateFromBoard(input: unknown): Promise<MenuActionState> {
  const parsed = Duplicate.safeParse(input);
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const { propertyId, outletId, itemId } = parsed.data;

  return guard('duplicate dish', async () => {
    // A new dish carries a price, so it needs what the dish form needs.
    const session = await requirePermission(propertyId, 'catalog:manage');
    await requirePermission(propertyId, 'catalog:pricing');
    const copy = await withTenant(
      { tenantId: session.tenantId, propertyId },
      (tx) => duplicateMenuItem(tx, {
        tenantId: session.tenantId, propertyId, outletId, itemId,
        actorStaffId: session.staffUserId,
      }),
    );
    revalidatePath('/admin/menu');
    return { done: `${copy.name} is under the original, switched off until you have looked at it.` };
  });
}

const Reprice = Ids.extend({
  categoryId: z.uuid(),
  /** "5", "-10", "2.5": a signed percentage. */
  percent: z.string().trim().regex(/^[-+]?\d{1,3}(\.\d{1,2})?$/, 'A change is a percentage, like 5 or -10.'),
  /** The rounding step in minor units: 100 = ₹1, 500 = ₹5, 1000 = ₹10. */
  stepMinor: z.union([z.literal(1), z.literal(100), z.literal(500), z.literal(1_000)]),
});

/** Every dish in a section moved by one percentage, rounded to a step. */
export async function repriceSectionFromBoard(input: unknown): Promise<MenuActionState> {
  const parsed = Reprice.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'That did not come through. Try again.' };
  }
  const { propertyId, outletId, categoryId, percent, stepMinor } = parsed.data;

  return guard('reprice section', async () => {
    const session = await requirePermission(propertyId, 'catalog:pricing');
    const negative = percent.startsWith('-');
    const bps = parseRateBps(percent.replace(/^[-+]/, '')) * (negative ? -1 : 1);
    if (bps === 0) return { done: 'A change of 0% changes nothing.' };

    const result = await withTenant(
      { tenantId: session.tenantId, propertyId },
      (tx) => repriceCategory(tx, {
        tenantId: session.tenantId, propertyId, outletId, categoryId,
        percentBps: bps, stepMinor, actorStaffId: session.staffUserId,
      }),
    );
    revalidatePath('/admin/menu');
    return {
      done: result.changed
        ? `${result.changed} ${result.changed === 1 ? 'dish' : 'dishes'} in ${result.category} repriced.`
        : `Every price in ${result.category} already rounds to that. Nothing changed.`,
    };
  });
}
