import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { withTenant } from '@/db';
import { requirePermission } from '@/lib/auth-context';
import { httpStatusFor, publicPayloadFor, ValidationError } from '@/lib/errors';
import { REQUEST_ID_HEADER, newRequestId } from '@/lib/request-id';
import { requestLogger } from '@/lib/logger';
import type { Permission } from '@/modules/identity';
import {
  prepareMedia, storeMedia, recordMedia, MEDIA_PURPOSES, type MediaPurpose,
} from '@/modules/media';

/**
 * A picture, uploaded from the console's image picker (D-093).
 *
 * A Route Handler rather than a Server Action because the picker shows a
 * progress bar, and only a plain XHR upload reports progress; and because a
 * Server Action's body is capped at 1MB, which is less than one phone photo.
 *
 * Through this server rather than straight into the bucket: every file is
 * decoded, checked to be a real picture, stripped of its location data and
 * cut to size before anything is stored — there is no window in which an
 * unchecked file sits in storage. The app is a long-lived Node process, so a
 * few megabytes through it is nothing (CLAUDE.md, Stack).
 *
 * Returns the PATH to save, not a URL; the form that asked for the picture
 * saves it like any other field, and the save checks it belongs to this
 * property.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The permission that guards wherever the picture is going. */
const PERMISSION_FOR: Record<MediaPurpose, Permission> = {
  dish: 'catalog:manage',
  logo: 'property:branding',
  cover: 'property:branding',
};

const Fields = z.object({
  propertyId: z.uuid(),
  purpose: z.enum(MEDIA_PURPOSES),
});

export async function POST(request: NextRequest): Promise<Response> {
  const reqId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
  const log = requestLogger(reqId, { route: '/api/admin/media' });

  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ValidationError('That upload did not come through. Try again.');
    }

    const fields = Fields.safeParse({ propertyId: form.get('propertyId'), purpose: form.get('purpose') });
    if (!fields.success) throw new ValidationError('That upload did not say what it was for.');
    const { propertyId, purpose } = fields.data;

    const session = await requirePermission(propertyId, PERMISSION_FOR[purpose]);

    const file = form.get('file');
    if (!(file instanceof File)) throw new ValidationError('Choose a picture to upload.');

    const prepared = await prepareMedia(Buffer.from(await file.arrayBuffer()), purpose);
    await storeMedia(prepared);
    const saved = await withTenant(
      { tenantId: session.tenantId, propertyId },
      (tx) => recordMedia(tx, {
        tenantId: session.tenantId, propertyId, staffUserId: session.staffUserId, prepared,
      }),
    );

    log.info({ purpose, id: saved.id, bytesIn: file.size, bytesOut: prepared.bytes }, 'media uploaded');
    return Response.json(
      { path: saved.path, id: saved.id, width: prepared.width, height: prepared.height },
      { status: 201, headers: { [REQUEST_ID_HEADER]: reqId } },
    );
  } catch (error) {
    const status = httpStatusFor(error);
    if (status >= 500) log.error({ err: (error as Error).message }, 'media upload failed');
    else log.info({ code: publicPayloadFor(error).code }, 'media upload refused');
    return Response.json(publicPayloadFor(error), { status, headers: { [REQUEST_ID_HEADER]: reqId } });
  }
}
