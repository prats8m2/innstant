'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import {
  createRequestType, updateRequestType, setRequestTypeActive, archiveRequestType,
  REQUEST_CATEGORIES, SLA_MINUTES_MIN, SLA_MINUTES_MAX, MAX_QUANTITY_CEILING,
} from '@/modules/requests';
import { parseMoneyInput, MoneyInputError } from '@/lib/money';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The request-catalog editor's buttons.
 *
 * All four need `request_type:manage`, which only PROPERTY_ADMIN holds by
 * default. Changing an SLA changes what the sweep escalates against and what the
 * guest is promised; changing a routing role changes whose phone rings. Neither
 * belongs behind the same permission as working a request.
 */

export interface RequestTypeActionState {
  error?: string;
  done?: string;
}

const Write = z.object({
  propertyId: z.uuid(),
  name: z.string().trim().min(1, 'Give it a name a guest would recognise.').max(120),
  description: z.string().trim().max(400).optional().transform((v) => (v ? v : null)),
  category: z.enum(REQUEST_CATEGORIES),
  price: z.string(),
  slaMinutes: z.coerce.number().int()
    .min(SLA_MINUTES_MIN, `Promise at least ${SLA_MINUTES_MIN} minute.`)
    .max(SLA_MINUTES_MAX, `Promise at most ${SLA_MINUTES_MAX} minutes.`),
  routeToRoleKey: z.string().trim().min(1, 'Say who this should go to.'),
  allowsQuantity: z.boolean(),
  maxQuantity: z.coerce.number().int().min(1).max(MAX_QUANTITY_CEILING),
  allowsNote: z.boolean(),
  allowsPhoto: z.boolean(),
});

function readWrite(formData: FormData) {
  return Write.safeParse({
    propertyId: formData.get('propertyId'),
    name: formData.get('name') ?? '',
    description: formData.get('description') ?? undefined,
    category: formData.get('category') ?? '',
    price: formData.get('price') ?? '',
    slaMinutes: formData.get('slaMinutes') ?? '',
    routeToRoleKey: formData.get('routeToRoleKey') ?? '',
    allowsQuantity: formData.get('allowsQuantity') === 'on',
    maxQuantity: formData.get('maxQuantity') || '1',
    allowsNote: formData.get('allowsNote') === 'on',
    allowsPhoto: formData.get('allowsPhoto') === 'on',
  });
}

async function guard(
  what: string,
  run: () => Promise<RequestTypeActionState>,
): Promise<RequestTypeActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MoneyInputError) return { error: error.message };
    if (error instanceof AppError) {
      logger.info({ code: error.code, what }, 'request type edit refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message, what }, 'request type edit failed');
    throw error;
  }
}

/**
 * Both writes revalidate the guest screens as well as this one.
 *
 * `/admin/requests` is obvious. `/r/[qrCode]/amenities` and `/service` are the
 * point: a manager who changes a promise and then walks to a room to check it
 * should see the new number, not a cached twelve minutes.
 */
function revalidateEverywhere(): void {
  revalidatePath('/admin/requests');
  revalidatePath('/r/[qrCode]/amenities', 'page');
  revalidatePath('/r/[qrCode]/service', 'page');
}

export async function saveRequestType(
  _previous: RequestTypeActionState,
  formData: FormData,
): Promise<RequestTypeActionState> {
  const parsed = readWrite(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  }
  const input = parsed.data;

  // Present on an edit, absent on a create. The same form does both, the way
  // the menu editor's section form does.
  const requestTypeId = z.uuid().safeParse(formData.get('requestTypeId'));

  return guard('save request type', async () => {
    const session = await requirePermission(input.propertyId, 'request_type:manage');

    // Blank means free, which is what most of this catalog is (#9).
    const price = parseMoneyInput(input.price.trim() || '0', 'INR');

    const common = {
      tenantId: session.tenantId,
      propertyId: input.propertyId,
      name: input.name,
      description: input.description,
      category: input.category,
      priceMinor: price.amountMinor,
      slaMinutes: input.slaMinutes,
      routeToRoleKey: input.routeToRoleKey,
      allowsQuantity: input.allowsQuantity,
      maxQuantity: input.maxQuantity,
      allowsNote: input.allowsNote,
      allowsPhoto: input.allowsPhoto,
      actorStaffId: session.staffUserId,
    };

    const done = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        if (requestTypeId.success) {
          await updateRequestType(tx, { ...common, requestTypeId: requestTypeId.data });
          return `Saved. A guest asking for ${input.name} is now promised ${input.slaMinutes} minutes.`;
        }
        const created = await createRequestType(tx, common);
        return `Added ${input.name}. Guests can ask for it now.`
          + ` Its key is ${created.key} and does not change if you rename it.`;
      },
    );

    revalidateEverywhere();
    return { done };
  });
}

const Toggle = z.object({
  propertyId: z.uuid(),
  requestTypeId: z.uuid(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export async function toggleRequestType(
  _previous: RequestTypeActionState,
  formData: FormData,
): Promise<RequestTypeActionState> {
  const parsed = Toggle.safeParse({
    propertyId: formData.get('propertyId'),
    requestTypeId: formData.get('requestTypeId'),
    isActive: formData.get('isActive'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('toggle request type', async () => {
    const session = await requirePermission(input.propertyId, 'request_type:manage');

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => setRequestTypeActive(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        requestTypeId: input.requestTypeId,
        isActive: input.isActive,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidateEverywhere();
    return {
      done: input.isActive
        ? 'Back on the guest’s list.'
        : 'Off the guest’s list. Requests already open are unaffected.',
    };
  });
}

export async function archiveType(
  _previous: RequestTypeActionState,
  formData: FormData,
): Promise<RequestTypeActionState> {
  const propertyId = z.uuid().safeParse(formData.get('propertyId'));
  const requestTypeId = z.uuid().safeParse(formData.get('requestTypeId'));
  if (!propertyId.success || !requestTypeId.success) {
    return { error: 'That did not come through. Try again.' };
  }

  return guard('archive request type', async () => {
    const session = await requirePermission(propertyId.data, 'request_type:manage');

    await withTenant(
      { tenantId: session.tenantId, propertyId: propertyId.data },
      (tx) => archiveRequestType(tx, {
        tenantId: session.tenantId,
        propertyId: propertyId.data,
        requestTypeId: requestTypeId.data,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidateEverywhere();
    return { done: 'Removed. Past requests of this kind still read correctly.' };
  });
}
