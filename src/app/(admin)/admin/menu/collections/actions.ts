'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import {
  createCollection, updateCollection, archiveCollection, setCollectionItems,
} from '@/modules/catalog';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Collections: the menu's running order and its voice.
 *
 * `catalog:manage` only — no pricing involved. A collection is a view over
 * dishes; nothing here changes what anything costs, and nothing here takes a
 * dish off the menu.
 */

export interface CollectionActionState {
  error?: string;
  done?: string;
}

/** `HH:MM`, or nothing. An empty window field is absence, not midnight. */
const window = z.string().trim().regex(/^(\d{1,2}:\d{2})?$/, 'Times are 24-hour, like 22:00.')
  .optional().transform((v) => (v ? v : null));

const isoDate = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Dates are written like 2026-11-05.')
  .optional().transform((v) => (v ? v : null));

const CollectionForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  collectionId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give the collection a name.').max(120),
  editorialNote: z.string().trim().max(400).optional().transform((v) => (v ? v : null)),
  availableFrom: window,
  availableUntil: window,
  /* D-084. The form always posts its seven day boxes, so an empty list is a
     choice (refused by the service: "switch it off instead"), not an omission.
     All seven is stored as every day. */
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).max(7),
  startsOn: isoDate,
  endsOn: isoDate,
  isActive: z.boolean(),
  menuItemIds: z.array(z.uuid()),
});

const ArchiveForm = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  collectionId: z.uuid(),
});

async function guard(
  what: string,
  run: () => Promise<CollectionActionState>,
): Promise<CollectionActionState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code, what }, 'collection edit refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message, what }, 'collection edit failed');
    throw error;
  }
}

/**
 * Save a collection and its dishes in one transaction.
 *
 * One transaction because a collection saved without its dishes is an empty
 * section, and an empty collection is skipped by the guest read entirely — so a
 * half-applied save looks exactly like the collection having been deleted.
 */
export async function saveCollection(
  _previous: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const parsed = CollectionForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    collectionId: formData.get('collectionId') || undefined,
    name: formData.get('name') ?? '',
    editorialNote: formData.get('editorialNote') ?? undefined,
    availableFrom: formData.get('availableFrom') ?? undefined,
    availableUntil: formData.get('availableUntil') ?? undefined,
    daysOfWeek: formData.getAll('daysOfWeek').map(String),
    startsOn: formData.get('startsOn') ?? undefined,
    endsOn: formData.get('endsOn') ?? undefined,
    // An unchecked checkbox posts nothing at all.
    isActive: formData.get('isActive') === 'on',
    menuItemIds: formData.getAll('menuItemIds').map(String),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the collection.' };
  }
  const input = parsed.data;

  return guard('save collection', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        const shared = {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          outletId: input.outletId,
          name: input.name,
          editorialNote: input.editorialNote,
          availableFrom: input.availableFrom,
          availableUntil: input.availableUntil,
          daysOfWeek: input.daysOfWeek,
          startsOn: input.startsOn,
          endsOn: input.endsOn,
          isActive: input.isActive,
          actorStaffId: session.staffUserId,
        };

        const collectionId = input.collectionId
          ? (await updateCollection(tx, { ...shared, collectionId: input.collectionId }),
            input.collectionId)
          : (await createCollection(tx, shared)).id;

        await setCollectionItems(tx, {
          tenantId: session.tenantId,
          outletId: input.outletId,
          collectionId,
          menuItemIds: input.menuItemIds,
        });
      },
    );

    revalidatePath('/admin/menu/collections');
    revalidatePath('/admin/menu');
    return {
      done: input.menuItemIds.length
        ? `${input.name} saved.`
        : `${input.name} saved — with no dishes in it, a guest will not see it at all.`,
    };
  });
}

export async function removeCollection(
  _previous: CollectionActionState,
  formData: FormData,
): Promise<CollectionActionState> {
  const parsed = ArchiveForm.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    collectionId: formData.get('collectionId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('archive collection', async () => {
    const session = await requirePermission(input.propertyId, 'catalog:manage');

    const { name } = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => archiveCollection(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        outletId: input.outletId,
        collectionId: input.collectionId,
        actorStaffId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/menu/collections');
    revalidatePath('/admin/menu');
    return { done: `${name} archived. Its dishes are still on the menu.` };
  });
}
