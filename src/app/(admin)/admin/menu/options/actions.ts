'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import {
  createModifierGroup, updateModifierGroup, archiveModifierGroup,
  createModifierOption, updateModifierOption, archiveModifierOption,
} from '@/modules/catalog';
import { parseMoneyInput, MoneyInputError } from '@/lib/money';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Option groups: the choices a guest gets, and what they add to the price.
 *
 * `catalog:manage` AND `catalog:pricing` throughout — `price_delta_minor` is
 * added to the line total, so an option is a price. The KITCHEN role holds
 * neither, which is deliberate (permissions.ts).
 */

export interface OptionActionState {
  error?: string;
  done?: string;
}

const GroupForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  groupId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give the group a name.').max(120),
  minSelections: z.coerce.number().int().min(0).max(20),
  maxSelections: z.coerce.number().int().min(1).max(20),
  isRequired: z.boolean(),
});

/**
 * A signed price delta, as typed.
 *
 * `-50` is legal and meaningful: "no roti" can take money off. The sign is read
 * here and the magnitude goes through `parseMoneyInput()`, which is the only
 * place a keyboard becomes minor units (#5) — so a delta cannot arrive as a
 * float from a different code path.
 */
const delta = z.string().trim();

const OptionForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  groupId: z.uuid(),
  optionId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give the option a name.').max(120),
  priceDelta: delta,
  isDefault: z.boolean(),
  isAvailable: z.boolean(),
});

const ArchiveGroupForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  groupId: z.uuid(),
  detachFromDishes: z.boolean(),
});

const ArchiveOptionForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  groupId: z.uuid(),
  optionId: z.uuid(),
});

function parseDelta(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;

  const negative = trimmed.startsWith('-');
  const magnitude = parseMoneyInput(negative ? trimmed.slice(1) : trimmed, 'INR');
  return negative ? -magnitude.amountMinor : magnitude.amountMinor;
}

async function guard(
  what: string,
  run: () => Promise<OptionActionState>,
): Promise<OptionActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MoneyInputError) return { error: error.message };
    if (error instanceof AppError) {
      logger.info({ code: error.code, what }, 'option edit refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message, what }, 'option edit failed');
    throw error;
  }
}

function revalidate(): void {
  revalidatePath('/admin/menu/options');
  // A group's name and options show on the dish form too.
  revalidatePath('/admin/menu');
}

export async function saveGroup(
  _previous: OptionActionState,
  formData: FormData,
): Promise<OptionActionState> {
  const parsed = GroupForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    groupId: formData.get('groupId') || undefined,
    name: formData.get('name') ?? '',
    minSelections: formData.get('minSelections') ?? '0',
    maxSelections: formData.get('maxSelections') ?? '1',
    isRequired: formData.get('isRequired') === 'on',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the group.' };
  }
  const input = parsed.data;

  return guard('save group', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');
    await requirePermission(input.propertyId, 'catalog:pricing');

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        const shared = {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          outletId: input.outletId,
          name: input.name,
          minSelections: input.minSelections,
          maxSelections: input.maxSelections,
          isRequired: input.isRequired,
          actorStaffId: session.staffUserId,
        };
        if (input.groupId) {
          await updateModifierGroup(tx, { ...shared, groupId: input.groupId });
        } else {
          await createModifierGroup(tx, shared);
        }
      },
    );

    revalidate();
    return {
      done: input.groupId
        ? `${input.name} saved — every dish carrying it changed too.`
        : `${input.name} added. Attach it to dishes from the dish form.`,
    };
  });
}

export async function saveOption(
  _previous: OptionActionState,
  formData: FormData,
): Promise<OptionActionState> {
  const parsed = OptionForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    groupId: formData.get('groupId'),
    optionId: formData.get('optionId') || undefined,
    name: formData.get('name') ?? '',
    priceDelta: formData.get('priceDelta') ?? '0',
    isDefault: formData.get('isDefault') === 'on',
    isAvailable: formData.get('isAvailable') === 'on',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the option.' };
  }
  const input = parsed.data;

  return guard('save option', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');
    await requirePermission(input.propertyId, 'catalog:pricing');

    const priceDeltaMinor = parseDelta(input.priceDelta);

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        const shared = {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          outletId: input.outletId,
          groupId: input.groupId,
          name: input.name,
          priceDeltaMinor,
          currency: 'INR' as const,
          isDefault: input.isDefault,
          isAvailable: input.isAvailable,
          actorStaffId: session.staffUserId,
        };
        if (input.optionId) {
          await updateModifierOption(tx, { ...shared, optionId: input.optionId });
        } else {
          await createModifierOption(tx, shared);
        }
      },
    );

    revalidate();
    return { done: `${input.name} saved.` };
  });
}

export async function removeGroup(
  _previous: OptionActionState,
  formData: FormData,
): Promise<OptionActionState> {
  const parsed = ArchiveGroupForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    groupId: formData.get('groupId'),
    // The second, explicit step: the button that carries this says how many
    // dishes it will come off.
    detachFromDishes: formData.get('detachFromDishes') === 'true',
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('archive group', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');
    await requirePermission(input.propertyId, 'catalog:pricing');

    const { name, detachedFrom } = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => archiveModifierGroup(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        outletId: input.outletId,
        groupId: input.groupId,
        detachFromDishes: input.detachFromDishes,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidate();
    return {
      done: detachedFrom
        ? `${name} archived, and taken off ${detachedFrom} ${detachedFrom === 1 ? 'dish' : 'dishes'}.`
        : `${name} archived.`,
    };
  });
}

export async function removeOption(
  _previous: OptionActionState,
  formData: FormData,
): Promise<OptionActionState> {
  const parsed = ArchiveOptionForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    groupId: formData.get('groupId'),
    optionId: formData.get('optionId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('archive option', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');
    await requirePermission(input.propertyId, 'catalog:pricing');

    const { name } = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => archiveModifierOption(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        outletId: input.outletId,
        groupId: input.groupId,
        optionId: input.optionId,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidate();
    return { done: `${name} removed from the group.` };
  });
}
