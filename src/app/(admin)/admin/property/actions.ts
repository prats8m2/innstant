'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import {
  createFloor, renameFloor, deleteFloor,
  createRoom, updateRoom, archiveRoom, restoreRoom,
} from '@/modules/identity';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The building's own settings. P3.5.
 *
 * All of it behind `room:manage`, which PROPERTY_ADMIN holds and the front desk
 * does not — a desk that can check people in has no business renumbering a wing,
 * and `permissions.ts` has kept `room:read` and `room:manage` apart since S5
 * with nothing using either.
 */

export interface PropertyState {
  error?: string;
  done?: string;
}

async function guard(
  what: string,
  run: () => Promise<PropertyState>,
): Promise<PropertyState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code, what }, 'property setup refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message, what }, 'property setup failed');
    throw error;
  }
}

/**
 * Both screens move: the desk's room list is grouped by floor and shows every
 * room, so a floor or a room added here has to appear there without a reload.
 */
function revalidateBoth(): void {
  revalidatePath('/admin/property');
  revalidatePath('/admin/rooms');
}

/* ── Floors ─────────────────────────────────────────────────────────────── */

const Floor = z.object({
  propertyId: z.uuid(),
  name: z.string().trim().min(1, 'Give the floor a name.').max(80),
  level: z.coerce.number().int()
    .min(-5, 'A level is between -5 and 200.')
    .max(200, 'A level is between -5 and 200.'),
});

export async function addFloor(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const parsed = Floor.safeParse({
    propertyId: formData.get('propertyId'),
    name: formData.get('name') ?? '',
    level: formData.get('level') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the floor.' };
  }
  const input = parsed.data;

  return guard('add floor', async () => {
    const session = await requirePermission(input.propertyId, 'room:manage');
    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => createFloor(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        name: input.name,
        level: input.level,
        staffUserId: session.staffUserId,
      }),
    );
    revalidateBoth();
    return { done: `${input.name} is open. Put some rooms on it.` };
  });
}

const RenameFloor = z.object({
  propertyId: z.uuid(),
  floorId: z.uuid(),
  name: z.string().trim().min(1, 'Give the floor a name.').max(80),
});

export async function renameFloorAction(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const parsed = RenameFloor.safeParse({
    propertyId: formData.get('propertyId'),
    floorId: formData.get('floorId'),
    name: formData.get('name') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the name.' };
  }
  const input = parsed.data;

  return guard('rename floor', async () => {
    const session = await requirePermission(input.propertyId, 'room:manage');
    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => renameFloor(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        floorId: input.floorId,
        name: input.name,
        staffUserId: session.staffUserId,
      }),
    );
    revalidateBoth();
    return { done: 'Renamed.' };
  });
}

export async function removeFloor(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const propertyId = z.uuid().safeParse(formData.get('propertyId'));
  const floorId = z.uuid().safeParse(formData.get('floorId'));
  if (!propertyId.success || !floorId.success) {
    return { error: 'That did not come through. Try again.' };
  }

  return guard('delete floor', async () => {
    const session = await requirePermission(propertyId.data, 'room:manage');
    await withTenant(
      { tenantId: session.tenantId, propertyId: propertyId.data },
      (tx) => deleteFloor(tx, {
        tenantId: session.tenantId,
        propertyId: propertyId.data,
        floorId: floorId.data,
        staffUserId: session.staffUserId,
      }),
    );
    revalidateBoth();
    return { done: 'Gone.' };
  });
}

/* ── Rooms ──────────────────────────────────────────────────────────────── */

const Room = z.object({
  propertyId: z.uuid(),
  roomId: z.uuid().optional(),
  floorId: z.uuid('Pick a floor.'),
  roomTypeId: z.uuid('Pick a room type.'),
  number: z.string().trim().min(1, 'Give the room a number.').max(16),
  notes: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
});

export async function saveRoom(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const parsed = Room.safeParse({
    propertyId: formData.get('propertyId'),
    roomId: formData.get('roomId') || undefined,
    floorId: formData.get('floorId') ?? '',
    roomTypeId: formData.get('roomTypeId') ?? '',
    number: formData.get('number') ?? '',
    notes: formData.get('notes') ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the room.' };
  }
  const input = parsed.data;

  return guard('save room', async () => {
    const session = await requirePermission(input.propertyId, 'room:manage');

    const done = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        const common = {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          floorId: input.floorId,
          roomTypeId: input.roomTypeId,
          number: input.number,
          notes: input.notes,
          staffUserId: session.staffUserId,
        };

        if (input.roomId) {
          await updateRoom(tx, { ...common, roomId: input.roomId });
          return `Room ${input.number} saved.`;
        }

        await createRoom(tx, common);
        // The QR code is the point: a room without one is invisible to the
        // whole guest surface. Say where to get it rather than printing the
        // code into a toast that vanishes.
        return `Room ${input.number} is ready. Its QR link is on the Rooms screen.`;
      },
    );

    revalidateBoth();
    return { done };
  });
}

export async function setRoomInService(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const propertyId = z.uuid().safeParse(formData.get('propertyId'));
  const roomId = z.uuid().safeParse(formData.get('roomId'));
  const restore = formData.get('restore') === 'true';
  if (!propertyId.success || !roomId.success) {
    return { error: 'That did not come through. Try again.' };
  }

  return guard(restore ? 'restore room' : 'archive room', async () => {
    const session = await requirePermission(propertyId.data, 'room:manage');

    const done = await withTenant(
      { tenantId: session.tenantId, propertyId: propertyId.data },
      async (tx) => {
        const common = {
          tenantId: session.tenantId,
          propertyId: propertyId.data,
          roomId: roomId.data,
          staffUserId: session.staffUserId,
        };

        if (restore) {
          await restoreRoom(tx, common);
          // A NEW code — the old sticker has been out of a guest's hands for
          // however long the room was shut.
          return 'Back in service, with a new QR link. The old sticker is dead.';
        }

        await archiveRoom(tx, common);
        return 'Out of service. Its QR sticker stops working now.';
      },
    );

    revalidateBoth();
    return { done };
  });
}
