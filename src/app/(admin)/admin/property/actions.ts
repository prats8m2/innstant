'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import {
  createFloor, renameFloor, deleteFloor,
  createRoom, updateRoom, archiveRoom, restoreRoom,
  createRoomType, updateRoomType, archiveRoomType, restoreRoomType,
  updatePropertySettings, updateGuestInfo, updateBranding,
} from '@/modules/identity';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * The property: what the hotel is called, what a room can be, and what it is
 * made of. P3.5.
 *
 * The building half is behind `room:manage`, which PROPERTY_ADMIN holds and the
 * front desk does not — a desk that can check people in has no business
 * renumbering a wing, and `permissions.ts` has kept `room:read` and
 * `room:manage` apart since S5 with nothing using either. The hotel's own name,
 * clock and currency are behind `property:update`, which is narrower still: the
 * desk holds `property:read` and not this.
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

/* ── The hotel itself ───────────────────────────────────────────────────── */

/**
 * `property:update`, which is PROPERTY_ADMIN's alone — the front desk holds
 * `property:read` and not this. Renaming the hotel or moving its clock is not a
 * shift-level act.
 */
const Settings = z.object({
  propertyId: z.uuid(),
  name: z.string().trim().min(1, 'Give the property a name.').max(120),
  timezone: z.string().trim().min(1, 'Pick a timezone.').max(64),
  currency: z.string().trim().length(3, 'A currency is three letters, like INR.'),
});

export async function savePropertySettings(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const parsed = Settings.safeParse({
    propertyId: formData.get('propertyId'),
    name: formData.get('name') ?? '',
    timezone: formData.get('timezone') ?? '',
    currency: formData.get('currency') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the settings.' };
  }
  const input = parsed.data;

  return guard('save property settings', async () => {
    const session = await requirePermission(input.propertyId, 'property:update');
    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => updatePropertySettings(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        name: input.name,
        timezone: input.timezone,
        currency: input.currency,
        staffUserId: session.staffUserId,
      }),
    );

    /**
     * Everything, not just these two screens. The property name is in the admin
     * bar on every page, and the timezone decides what "today" means on the
     * kitchen's hours, the desk's due-out column and every time a guest reads.
     */
    revalidatePath('/', 'layout');
    return { done: 'Saved. Every screen reads the new clock from here.' };
  });
}

/* ── What a guest reads, and what it looks like (D-087) ──────────────────── */

const GuestInfoForm = z.object({
  propertyId: z.uuid(),
  contactPhone: z.string().max(40),
  contactWhatsapp: z.string().max(40),
  contactEmail: z.string().max(200),
  addressLine: z.string().max(200),
  city: z.string().max(80),
  checkInTime: z.string().max(5),
  checkOutTime: z.string().max(5),
  wifiNetwork: z.string().max(64),
  wifiPassword: z.string().max(128),
});

/**
 * `property:update`, like the hotel's name: the desk's number and the wifi are
 * the hotel speaking to every guest, not a shift-level setting. The domain
 * (`cleanGuestInfo`) owns what a valid phone number is; this only checks the
 * form arrived in one piece.
 */
export async function saveGuestInfo(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const field = (name: string) => String(formData.get(name) ?? '');
  const parsed = GuestInfoForm.safeParse({
    propertyId: formData.get('propertyId'),
    contactPhone: field('contactPhone'),
    contactWhatsapp: field('contactWhatsapp'),
    contactEmail: field('contactEmail'),
    addressLine: field('addressLine'),
    city: field('city'),
    checkInTime: field('checkInTime'),
    checkOutTime: field('checkOutTime'),
    wifiNetwork: field('wifiNetwork'),
    wifiPassword: field('wifiPassword'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details.' };
  }
  const { propertyId, ...info } = parsed.data;

  return guard('save guest info', async () => {
    const session = await requirePermission(propertyId, 'property:update');
    await withTenant(
      { tenantId: session.tenantId, propertyId },
      (tx) => updateGuestInfo(tx, {
        tenantId: session.tenantId,
        propertyId,
        staffUserId: session.staffUserId,
        info: {
          contactPhone: info.contactPhone,
          contactWhatsapp: info.contactWhatsapp,
          contactEmail: info.contactEmail,
          addressLine: info.addressLine,
          city: info.city,
          checkInTime: info.checkInTime,
          checkOutTime: info.checkOutTime,
          wifiNetwork: info.wifiNetwork,
          wifiPassword: info.wifiPassword,
        },
      }),
    );
    revalidatePath('/admin/property');
    return { done: 'Saved. Guests see it on their Stay screen now.' };
  });
}

const BrandingForm = z.object({
  propertyId: z.uuid(),
  accent: z.string().max(7),
  logoUrl: z.string().max(500),
  coverUrl: z.string().max(500),
});

/** `property:branding` — PROPERTY_ADMIN's alone, as it has been since S5. */
export async function saveBranding(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const parsed = BrandingForm.safeParse({
    propertyId: formData.get('propertyId'),
    accent: String(formData.get('accent') ?? ''),
    logoUrl: String(formData.get('logoUrl') ?? ''),
    coverUrl: String(formData.get('coverUrl') ?? ''),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the branding.' };
  }
  const { propertyId, ...branding } = parsed.data;

  return guard('save branding', async () => {
    const session = await requirePermission(propertyId, 'property:branding');
    await withTenant(
      { tenantId: session.tenantId, propertyId },
      (tx) => updateBranding(tx, {
        tenantId: session.tenantId,
        propertyId,
        staffUserId: session.staffUserId,
        branding,
      }),
    );
    // Every guest screen reads it, through the brand scope in their layouts.
    revalidatePath('/', 'layout');
    return { done: 'Saved. Every guest screen wears it from the next tap.' };
  });
}

/* ── Room types ─────────────────────────────────────────────────────────── */

/**
 * #11, at the boundary. There is no price field on this form and no `feeMinor`
 * in this schema, because a price belongs to a rate plan for a type on a DATE —
 * `rate_plans` and `rate_calendar` are reserved names (#12) and this is the
 * table they will attach to.
 */
const RoomType = z.object({
  propertyId: z.uuid(),
  roomTypeId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Give the room type a name.').max(80),
  code: z.string().trim().min(1, 'Give it a short code.').max(12),
  maxOccupancy: z.coerce.number().int()
    .min(1, 'Occupancy is between 1 and 20.')
    .max(20, 'Occupancy is between 1 and 20.'),
});

export async function saveRoomType(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const parsed = RoomType.safeParse({
    propertyId: formData.get('propertyId'),
    roomTypeId: formData.get('roomTypeId') || undefined,
    name: formData.get('name') ?? '',
    code: formData.get('code') ?? '',
    maxOccupancy: formData.get('maxOccupancy') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the room type.' };
  }
  const input = parsed.data;

  return guard('save room type', async () => {
    const session = await requirePermission(input.propertyId, 'room:manage');

    const done = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      async (tx) => {
        const common = {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          name: input.name,
          code: input.code,
          maxOccupancy: input.maxOccupancy,
          staffUserId: session.staffUserId,
        };

        if (input.roomTypeId) {
          await updateRoomType(tx, { ...common, roomTypeId: input.roomTypeId });
          return `${input.name} saved.`;
        }

        await createRoomType(tx, common);
        return `${input.name} is a room type now. Rooms can be one.`;
      },
    );

    revalidateBoth();
    return { done };
  });
}

export async function setRoomTypeInUse(
  _previous: PropertyState,
  formData: FormData,
): Promise<PropertyState> {
  const propertyId = z.uuid().safeParse(formData.get('propertyId'));
  const roomTypeId = z.uuid().safeParse(formData.get('roomTypeId'));
  const restore = formData.get('restore') === 'true';
  if (!propertyId.success || !roomTypeId.success) {
    return { error: 'That did not come through. Try again.' };
  }

  return guard(restore ? 'restore room type' : 'retire room type', async () => {
    const session = await requirePermission(propertyId.data, 'room:manage');

    const done = await withTenant(
      { tenantId: session.tenantId, propertyId: propertyId.data },
      async (tx) => {
        const common = {
          tenantId: session.tenantId,
          propertyId: propertyId.data,
          roomTypeId: roomTypeId.data,
          staffUserId: session.staffUserId,
        };

        if (restore) {
          await restoreRoomType(tx, common);
          return 'Back. Rooms can be this again.';
        }

        await archiveRoomType(tx, common);
        // It keeps its code — `room_types_property_code_uq` has no partial
        // predicate — and a guest's old stay still reads the right name.
        return 'Retired. It keeps its code, and past stays still read it.';
      },
    );

    revalidateBoth();
    return { done };
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
