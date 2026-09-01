'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { updateOutletSettings, setOutletHours } from '@/modules/catalog';
import { parseMoneyInput, parseRateBps, MoneyInputError } from '@/lib/money';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Outlet settings: what the kitchen charges, and when it is open.
 *
 * Both need `catalog:pricing` as well as `catalog:manage` — a tax rate and a
 * service charge are prices, and the KITCHEN role holds neither (permissions.ts).
 * The hours do not move money, but they decide whether a guest is invited to
 * order at all, so they sit behind `catalog:manage`.
 */

export interface OutletActionState {
  error?: string;
  done?: string;
}

const Settings = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  name: z.string().trim().min(1, 'Give the outlet a name.').max(120),
  description: z.string().trim().max(400).optional()
    .transform((v) => (v ? v : null)),
  taxRate: z.string(),
  serviceChargeRate: z.string(),
  deliveryFee: z.string(),
  minimumOrder: z.string(),
  prepTimeMinutes: z.coerce.number().int().min(1).max(240),
});

/** `HH:MM`, the storage format. Rejected here rather than in the domain. */
const clock = z.string().regex(/^\d{1,2}:\d{2}$/, 'Times are 24-hour, like 07:00.');

const HoursDay = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  opensAt: clock,
  closesAt: clock,
  crossesMidnight: z.boolean(),
});

async function guard(
  what: string,
  run: () => Promise<OutletActionState>,
): Promise<OutletActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MoneyInputError) return { error: error.message };
    if (error instanceof AppError) {
      logger.info({ code: error.code, what }, 'outlet edit refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message, what }, 'outlet edit failed');
    throw error;
  }
}

export async function saveOutletSettings(
  _previous: OutletActionState,
  formData: FormData,
): Promise<OutletActionState> {
  const parsed = Settings.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    name: formData.get('name') ?? '',
    description: formData.get('description') ?? undefined,
    taxRate: formData.get('taxRate') ?? '',
    serviceChargeRate: formData.get('serviceChargeRate') ?? '',
    deliveryFee: formData.get('deliveryFee') ?? '',
    minimumOrder: formData.get('minimumOrder') ?? '',
    prepTimeMinutes: formData.get('prepTimeMinutes') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the settings.' };
  }
  const input = parsed.data;

  return guard('save outlet settings', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');
    await requirePermission(input.propertyId, 'catalog:pricing');

    // The one place a typed percentage becomes basis points, and a typed
    // amount becomes minor units. Both throw MoneyInputError, which `guard`
    // turns into the message the manager reads.
    const taxRateBps = parseRateBps(input.taxRate);
    const serviceChargeBps = parseRateBps(input.serviceChargeRate);
    const deliveryFee = parseMoneyInput(input.deliveryFee || '0', 'INR');
    const minimumOrder = parseMoneyInput(input.minimumOrder || '0', 'INR');

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => updateOutletSettings(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        outletId: input.outletId,
        name: input.name,
        description: input.description,
        taxRateBps,
        serviceChargeBps,
        deliveryFeeMinor: deliveryFee.amountMinor,
        minimumOrderMinor: minimumOrder.amountMinor,
        prepTimeMinutes: input.prepTimeMinutes,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/outlet');
    revalidatePath('/admin/menu');
    return { done: 'Saved. New orders use these from now on.' };
  });
}

/**
 * The week's hours, all seven days in one post.
 *
 * A day is open only if its "open" box is ticked; an unticked day posts no row
 * at all, which is exactly how "closed on Tuesdays" is stored (hours.ts). That
 * is why this reads the checkbox first and skips the rest of the day's fields.
 */
export async function saveOutletHours(
  _previous: OutletActionState,
  formData: FormData,
): Promise<OutletActionState> {
  const propertyId = z.uuid().safeParse(formData.get('propertyId'));
  const outletId = z.uuid().safeParse(formData.get('outletId'));
  if (!propertyId.success || !outletId.success) {
    return { error: 'That did not come through. Try again.' };
  }

  const days: unknown[] = [];
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    if (formData.get(`open-${dayOfWeek}`) !== 'on') continue;
    days.push({
      dayOfWeek,
      opensAt: String(formData.get(`opensAt-${dayOfWeek}`) ?? ''),
      closesAt: String(formData.get(`closesAt-${dayOfWeek}`) ?? ''),
      crossesMidnight: formData.get(`crossesMidnight-${dayOfWeek}`) === 'on',
    });
  }

  const parsed = z.array(HoursDay).safeParse(days);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the hours.' };
  }

  return guard('save outlet hours', async () => {
    const session = await requirePermission(propertyId.data, 'catalog:manage');

    await withTenant(
      { tenantId: session.tenantId, propertyId: propertyId.data },
      (tx) => setOutletHours(tx, {
        tenantId: session.tenantId,
        propertyId: propertyId.data,
        outletId: outletId.data,
        hours: parsed.data,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/outlet');
    return {
      done: parsed.data.length
        ? 'Hours saved. The guest menu says so now.'
        : 'Saved — the outlet is now marked closed every day.',
    };
  });
}
