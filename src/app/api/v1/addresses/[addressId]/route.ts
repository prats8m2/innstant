import { z } from 'zod';
import { withTenant } from '@/db';
import { updateAddress, archiveAddress } from '@/modules/customer';
import { requireCustomerSession } from '@/lib/api-auth';
import { ValidationError } from '@/lib/errors';
import { apiHandler, parseBody, corsPreflight } from '../../_lib/handler';
import type { ApiAddress, ApiAddressBody } from '@/lib/api-contract';

/**
 * `PATCH` and `DELETE /api/v1/addresses/{addressId}`. D-081.
 *
 * Neither trusts the id. Both domain functions scope their statement by
 * `guest_id` as well, so an id belonging to another customer in the same
 * tenant is a 404 — RLS confines these rows to the tenant and the id travels
 * in a URL, which is exactly the gap that predicate closes.
 *
 * DELETE archives rather than removing: an order that went to this address
 * keeps its own `destination_label` snapshot (#6), and nothing that pointed at
 * the row breaks. It simply stops being offered.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const AddressId = z.uuid();
const Body = z.object({
  label: z.string().trim().min(1).max(40),
  line: z.string().trim().min(1).max(400),
  notes: z.string().trim().max(280).nullable().optional(),
  isDefault: z.boolean().optional(),
});

/** The id out of the path — see the note in `menu/[itemId]/route.ts`. */
function addressIdFrom(request: Request): string {
  const parsed = AddressId.safeParse(new URL(request.url).pathname.split('/').at(-1));
  if (!parsed.success) throw new ValidationError('That address is no longer saved.');
  return parsed.data;
}

export const PATCH = apiHandler(
  '/api/v1/addresses/[addressId]',
  async (request): Promise<ApiAddress> => {
    const session = await requireCustomerSession(request);
    const addressId = addressIdFrom(request);
    const body: ApiAddressBody = await parseBody(
      request, Body, 'That change did not come through.',
    );

    return withTenant({ tenantId: session.tenantId }, (tx) => updateAddress(tx, {
      tenantId: session.tenantId,
      guestId: session.guestId,
      addressId,
      label: body.label,
      line: body.line,
      notes: body.notes,
      isDefault: body.isDefault,
    }));
  },
);

export const DELETE = apiHandler(
  '/api/v1/addresses/[addressId]',
  async (request): Promise<{ ok: true }> => {
    const session = await requireCustomerSession(request);
    const addressId = addressIdFrom(request);

    await withTenant({ tenantId: session.tenantId }, (tx) =>
      archiveAddress(tx, { guestId: session.guestId, addressId }));

    return { ok: true };
  },
);

export const OPTIONS = corsPreflight;
