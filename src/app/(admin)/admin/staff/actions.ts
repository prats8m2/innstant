'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import {
  inviteStaff, reissueInvite, updateStaff, deactivateStaff, reactivateStaff,
  assignRole, revokeRole,
} from '@/modules/identity';
import { endShiftFor } from '@/modules/housekeeping';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Staff and roles. P3.5.
 *
 * Four permissions that have been declared since S5 with no caller anywhere:
 * `staff:invite`, `staff:update`, `staff:deactivate` and `role:assign`. Each
 * action below asks for exactly the one it needs, rather than gating the whole
 * screen on `staff:invite` — a duty manager who may fix a phone number is not
 * the same person as one who may hand out PROPERTY_ADMIN.
 */

export interface StaffState {
  error?: string;
  done?: string;
  /**
   * The invite link, shown once and never recoverable. It is not persisted in
   * the clear (#10), so the ONLY moment it can be copied is this response —
   * which is why it travels in the action state rather than being fetched by
   * the row that displays it.
   */
  invite?: { token: string; name: string };
}

async function guard(
  what: string,
  run: () => Promise<StaffState>,
): Promise<StaffState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AppError) {
      logger.info({ code: error.code, what }, 'staff action refused');
      return { error: publicPayloadFor(error).message };
    }
    logger.error({ err: (error as Error).message, what }, 'staff action failed');
    throw error;
  }
}

const Invite = z.object({
  propertyId: z.uuid(),
  email: z.email('That is not an email address.').max(320),
  fullName: z.string().trim().min(1, 'A name, however they give it.').max(160),
  phone: z.string().trim().max(32).optional().transform((v) => (v ? v : null)),
  roleKey: z.string().trim().min(1, 'Pick a role.').max(64),
});

export async function inviteStaffMember(
  _previous: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const parsed = Invite.safeParse({
    propertyId: formData.get('propertyId'),
    email: formData.get('email') ?? '',
    fullName: formData.get('fullName') ?? '',
    phone: formData.get('phone') ?? undefined,
    roleKey: formData.get('roleKey') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details.' };
  }
  const input = parsed.data;

  return guard('invite staff', async () => {
    const session = await requirePermission(input.propertyId, 'staff:invite');

    const issued = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => inviteStaff(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        email: input.email,
        fullName: input.fullName,
        phone: input.phone,
        roleKey: input.roleKey,
        staffUserId: session.staffUserId,
      }),
    );

    // The token is never logged. It sets a password.
    logger.info(
      { staffUserId: issued.staffUserId, rejoined: issued.rejoined },
      'staff invited',
    );

    revalidatePath('/admin/staff');

    // An already-active colleague gaining a second property gets no link —
    // they have a password and can already sign in.
    if (!issued.token) {
      return { done: `${input.fullName} works here too now. They sign in as they already do.` };
    }

    return {
      done: `${input.fullName} is invited. Send them the link — it works once, for three days.`,
      invite: { token: issued.token, name: input.fullName },
    };
  });
}

const Target = z.object({
  propertyId: z.uuid(),
  targetStaffId: z.uuid(),
});

export async function reissueInviteLink(
  _previous: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const parsed = Target.safeParse({
    propertyId: formData.get('propertyId'),
    targetStaffId: formData.get('targetStaffId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const name = String(formData.get('fullName') ?? 'They');

  return guard('reissue invite', async () => {
    const session = await requirePermission(parsed.data.propertyId, 'staff:invite');

    const issued = await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      (tx) => reissueInvite(tx, {
        tenantId: session.tenantId,
        propertyId: parsed.data.propertyId,
        targetStaffId: parsed.data.targetStaffId,
        staffUserId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/staff');
    return {
      done: 'A new link. The old one stopped working just now.',
      invite: { token: issued.token, name },
    };
  });
}

const Edit = z.object({
  propertyId: z.uuid(),
  targetStaffId: z.uuid(),
  fullName: z.string().trim().min(1, 'A name, however they give it.').max(160),
  phone: z.string().trim().max(32).optional().transform((v) => (v ? v : null)),
});

export async function editStaffMember(
  _previous: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const parsed = Edit.safeParse({
    propertyId: formData.get('propertyId'),
    targetStaffId: formData.get('targetStaffId'),
    fullName: formData.get('fullName') ?? '',
    phone: formData.get('phone') ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details.' };
  }
  const input = parsed.data;

  return guard('edit staff', async () => {
    const session = await requirePermission(input.propertyId, 'staff:update');
    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => updateStaff(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        targetStaffId: input.targetStaffId,
        fullName: input.fullName,
        phone: input.phone,
        staffUserId: session.staffUserId,
      }),
    );
    revalidatePath('/admin/staff');
    return { done: 'Saved.' };
  });
}

export async function setStaffActive(
  _previous: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const parsed = Target.safeParse({
    propertyId: formData.get('propertyId'),
    targetStaffId: formData.get('targetStaffId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const reactivate = formData.get('reactivate') === 'true';

  return guard(reactivate ? 'reactivate staff' : 'deactivate staff', async () => {
    const session = await requirePermission(parsed.data.propertyId, 'staff:deactivate');

    const done = await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      async (tx) => {
        const common = {
          tenantId: session.tenantId,
          propertyId: parsed.data.propertyId,
          targetStaffId: parsed.data.targetStaffId,
          staffUserId: session.staffUserId,
        };

        if (reactivate) {
          await reactivateStaff(tx, common);
          // Deliberately NOT straight back to their old password (D-044).
          return 'Back on. Send them a new link — they need a new password.';
        }

        const off = await deactivateStaff(tx, common);
        return `${off.fullName} is switched off. Every device they were signed in on stopped just now.`;
      },
    );

    revalidatePath('/admin/staff');
    return { done };
  });
}

const RoleChange = z.object({
  propertyId: z.uuid(),
  targetStaffId: z.uuid(),
  roleKey: z.string().trim().min(1, 'Pick a role.').max(64),
});

export async function changeRole(
  _previous: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const parsed = RoleChange.safeParse({
    propertyId: formData.get('propertyId'),
    targetStaffId: formData.get('targetStaffId'),
    roleKey: formData.get('roleKey') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Pick a role.' };
  }
  const input = parsed.data;
  const remove = formData.get('remove') === 'true';

  return guard(remove ? 'revoke role' : 'assign role', async () => {
    const session = await requirePermission(input.propertyId, 'role:assign');

    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => {
        const common = {
          tenantId: session.tenantId,
          propertyId: input.propertyId,
          targetStaffId: input.targetStaffId,
          roleKey: input.roleKey,
          staffUserId: session.staffUserId,
        };
        return remove ? revokeRole(tx, common) : assignRole(tx, common);
      },
    );

    revalidatePath('/admin/staff');
    return { done: remove ? 'Taken away.' : 'Added. It applies the next time they load a screen.' };
  });
}

/**
 * A manager closes somebody else's shift — the runner who went home without
 * tapping Clock out, and is still being routed requests (D-088).
 * `shift:manage`, which is PROPERTY_ADMIN's.
 */
export async function clockOutStaff(
  _previous: StaffState,
  formData: FormData,
): Promise<StaffState> {
  const parsed = z.object({ propertyId: z.uuid(), targetStaffId: z.uuid() }).safeParse({
    propertyId: formData.get('propertyId'),
    targetStaffId: formData.get('targetStaffId'),
  });
  if (!parsed.success) return { error: 'That did not come through. Try again.' };
  const input = parsed.data;

  return guard('clock out staff', async () => {
    const session = await requirePermission(input.propertyId, 'shift:manage');
    await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => endShiftFor(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        targetStaffId: input.targetStaffId,
        actorStaffId: session.staffUserId,
      }),
    );
    revalidatePath('/admin/staff');
    revalidatePath('/admin/floor');
    return { done: 'Clocked out. Nothing routes to them until they clock in again.' };
  });
}
