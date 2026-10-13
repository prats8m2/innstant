'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import {
  createVisitLink, regenerateVisitLink, revokeVisitLink,
} from '@/modules/visit';
import { AppError, publicPayloadFor } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Minting, reprinting and revoking a property link. D-079.
 *
 * `catalog:manage` rather than `room:manage`, deliberately. A property link
 * points at an OUTLET and decides who can order from its menu — it is a thing
 * the F&B manager owns, not the person who renumbers a wing. The room sticker's
 * equivalent sits under `room:manage` for the mirror-image reason.
 */

export interface LinkState {
  error?: string;
  done?: string;
  /** The code a just-created link carries, so the page can show it without a
   *  round trip. The LINK is a capability, so this is the one place it crosses
   *  back — it is never written to the audit trail (see modules/visit/links). */
  publicCode?: string;
}

const Create = z.object({
  propertyId: z.uuid(),
  outletId: z.uuid(),
  kind: z.enum(['TABLE', 'COUNTER', 'ONLINE']),
  label: z.string().trim().min(1, 'Give it a name staff will recognise.').max(60),
  tableLabel: z.string().trim().max(40).optional().transform((v) => (v ? v : null)),
});

export async function createLink(
  _previous: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const parsed = Create.safeParse({
    propertyId: formData.get('propertyId'),
    outletId: formData.get('outletId'),
    kind: formData.get('kind'),
    label: formData.get('label') ?? '',
    tableLabel: formData.get('tableLabel') ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the details.' };
  }
  const input = parsed.data;

  try {
    const session = await requirePermission(input.propertyId, 'catalog:manage');

    const created = await withTenant(
      { tenantId: session.tenantId, propertyId: input.propertyId },
      (tx) => createVisitLink(tx, {
        tenantId: session.tenantId,
        propertyId: input.propertyId,
        outletId: input.outletId,
        kind: input.kind,
        label: input.label,
        tableLabel: input.tableLabel,
        staffUserId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/links');
    return { done: `${input.label} is live.`, publicCode: created.publicCode };
  } catch (error) {
    return handle(error, 'create visit link');
  }
}

const Target = z.object({
  propertyId: z.uuid(),
  visitLinkId: z.uuid(),
});

/**
 * A new code on the same link. The old URL stops working the instant this
 * commits — which is the point, and why the form around it says so.
 */
export async function reprintLink(
  _previous: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const parsed = Target.safeParse({
    propertyId: formData.get('propertyId'),
    visitLinkId: formData.get('visitLinkId'),
  });
  if (!parsed.success) return { error: 'That link could not be identified.' };

  try {
    const session = await requirePermission(parsed.data.propertyId, 'catalog:manage');

    const next = await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      (tx) => regenerateVisitLink(tx, {
        tenantId: session.tenantId,
        propertyId: parsed.data.propertyId,
        visitLinkId: parsed.data.visitLinkId,
        staffUserId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/links');
    return { done: `New code issued — version ${next.version}.`, publicCode: next.publicCode };
  } catch (error) {
    return handle(error, 'reprint visit link');
  }
}

export async function revokeLink(
  _previous: LinkState,
  formData: FormData,
): Promise<LinkState> {
  const parsed = Target.safeParse({
    propertyId: formData.get('propertyId'),
    visitLinkId: formData.get('visitLinkId'),
  });
  if (!parsed.success) return { error: 'That link could not be identified.' };

  try {
    const session = await requirePermission(parsed.data.propertyId, 'catalog:manage');

    await withTenant(
      { tenantId: session.tenantId, propertyId: parsed.data.propertyId },
      (tx) => revokeVisitLink(tx, {
        tenantId: session.tenantId,
        propertyId: parsed.data.propertyId,
        visitLinkId: parsed.data.visitLinkId,
        staffUserId: session.staffUserId,
      }),
    );

    revalidatePath('/admin/links');
    return { done: 'That link no longer opens.' };
  } catch (error) {
    return handle(error, 'revoke visit link');
  }
}

function handle(error: unknown, what: string): LinkState {
  if (error instanceof AppError) {
    logger.info({ code: error.code, ...error.context }, `${what} refused`);
    return { error: publicPayloadFor(error).message };
  }
  logger.error({ err: (error as Error).message }, `${what} failed`);
  return { error: 'That did not go through. Try again.' };
}
