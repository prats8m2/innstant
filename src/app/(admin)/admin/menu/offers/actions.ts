'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { createOffer, updateOffer, archiveOffer } from '@/modules/catalog';
import { parseMoneyInput, parseRateBps, MoneyInputError } from '@/lib/money';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Offers (D-085). Every one changes what a guest is charged, so every one is
 * behind `catalog:pricing`, the permission a repricing needs, re-checked here
 * whatever the screen showed.
 */

export interface OfferActionState {
  error?: string;
  done?: string;
}

const clock = z.string().trim().regex(/^(\d{1,2}:\d{2})?$/, 'Times are 24-hour, like 15:00.')
  .optional().transform((v) => (v ? v : null));
const isoDate = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Dates are written like 2026-11-05.')
  .optional().transform((v) => (v ? v : null));
const optionalId = z.string().trim().optional().transform((v) => (v ? v : null))
  .pipe(z.uuid().nullable());

const OfferForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  offerId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give the offer a name a guest would understand.').max(80),
  scope: z.enum(['MENU', 'CATEGORY', 'DISH']),
  categoryId: optionalId,
  menuItemId: optionalId,
  kind: z.enum(['PERCENT', 'AMOUNT']),
  amount: z.string().trim().min(1, 'Say how much comes off.').max(20),
  availableFrom: clock,
  availableUntil: clock,
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).max(7),
  startsOn: isoDate,
  endsOn: isoDate,
  isActive: z.boolean(),
});

async function guard(what: string, run: () => Promise<OfferActionState>): Promise<OfferActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MoneyInputError) return { error: error.message };
    if (error instanceof AppError) {
      logger.info({ code: error.code, what }, 'offer edit refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message, what }, 'offer edit failed');
    throw error;
  }
}

export async function saveOffer(
  _previous: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const parsed = OfferForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    offerId: formData.get('offerId') || undefined,
    name: formData.get('name') ?? '',
    scope: formData.get('scope'),
    categoryId: formData.get('categoryId') ?? undefined,
    menuItemId: formData.get('menuItemId') ?? undefined,
    kind: formData.get('kind'),
    amount: formData.get('amount') ?? '',
    availableFrom: formData.get('availableFrom') ?? undefined,
    availableUntil: formData.get('availableUntil') ?? undefined,
    daysOfWeek: formData.getAll('daysOfWeek').map(String),
    startsOn: formData.get('startsOn') ?? undefined,
    endsOn: formData.get('endsOn') ?? undefined,
    isActive: formData.get('isActive') === 'on',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the offer.' };
  const input = parsed.data;

  return guard('save offer', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:pricing');

    // "20" or "12.5" for a percentage; "100" or "99.50" rupees for an amount.
    const percentBps = input.kind === 'PERCENT' ? parseRateBps(input.amount) : null;
    const amountMinor = input.kind === 'AMOUNT'
      ? parseMoneyInput(input.amount, 'INR').amountMinor
      : null;

    const shared = {
      tenantId: session.tenantId,
      propertyId: input.propertyId,
      outletId: input.outletId,
      name: input.name,
      scope: input.scope,
      categoryId: input.scope === 'CATEGORY' ? input.categoryId : null,
      menuItemId: input.scope === 'DISH' ? input.menuItemId : null,
      kind: input.kind,
      percentBps,
      amountMinor,
      availableFrom: input.availableFrom,
      availableUntil: input.availableUntil,
      daysOfWeek: input.daysOfWeek,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      isActive: input.isActive,
      actorStaffId: session.staffUserId,
    };

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => input.offerId
        ? updateOffer(tx, { ...shared, offerId: input.offerId })
        : createOffer(tx, shared).then(() => undefined),
    );

    revalidatePath('/admin/menu/offers');
    revalidatePath('/admin/menu');
    return { done: `${input.name} saved.` };
  });
}

const ArchiveForm = z.object({ propertyId: z.uuid(), outletId: z.uuid(), offerId: z.uuid() });

export async function removeOffer(
  _previous: OfferActionState,
  formData: FormData,
): Promise<OfferActionState> {
  const parsed = ArchiveForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    offerId: formData.get('offerId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('archive offer', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:pricing');
    const { name } = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => archiveOffer(tx, { ...input, tenantId: session.tenantId, actorStaffId: session.staffUserId }),
    );
    revalidatePath('/admin/menu/offers');
    revalidatePath('/admin/menu');
    return { done: `${name} has ended. Receipts that used it still show it.` };
  });
}
