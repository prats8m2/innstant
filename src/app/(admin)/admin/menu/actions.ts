'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import {
  createMenuCategory, updateMenuCategory, archiveMenuCategory,
  createMenuItem, updateMenuItem, setMenuItemAvailability, archiveMenuItem,
  setMenuItemModifierGroups, setOutletAcceptingOrders,
  MENU_DIETARY_FLAGS,
} from '@/modules/catalog';
import { parseMoneyInput, MoneyInputError, type CurrencyCode } from '@/lib/money';
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
  isAvailable: z.boolean(),
  dietaryFlags: z.array(Flags),
  modifierGroupIds: z.array(z.uuid()),
});

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
