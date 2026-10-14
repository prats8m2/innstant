import { z } from 'zod';
import { withTenant } from '@/db';
import { listAddresses, createAddress } from '@/modules/customer';
import { requireCustomerSession } from '@/lib/api-auth';
import { apiHandler, parseBody, corsPreflight } from '../_lib/handler';
import type { ApiAddress, ApiAddressBody } from '@/lib/api-contract';

/**
 * `GET` and `POST /api/v1/addresses`. D-081.
 *
 * Every statement behind these is scoped by `guest_id` as well as by id. RLS
 * confines these rows to the TENANT, and an address id travels in a URL — so
 * without that second predicate one customer could read or edit another's
 * inside the same hotel group. It is the discipline `getOrderForContext`
 * already states, and a miss is a 404 rather than a 403: a customer has no
 * business learning that somebody else's address exists.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  label: z.string().trim().min(1).max(40),
  line: z.string().trim().min(1).max(400),
  notes: z.string().trim().max(280).nullable().optional(),
  isDefault: z.boolean().optional(),
});

export const GET = apiHandler('/api/v1/addresses', async (request): Promise<ApiAddress[]> => {
  const session = await requireCustomerSession(request);
  return withTenant({ tenantId: session.tenantId }, (tx) => listAddresses(tx, session.guestId));
});

export const POST = apiHandler('/api/v1/addresses', async (request): Promise<ApiAddress> => {
  const session = await requireCustomerSession(request);
  const body: ApiAddressBody = await parseBody(
    request, Body, 'That address did not come through.',
  );

  return withTenant({ tenantId: session.tenantId }, (tx) => createAddress(tx, {
    tenantId: session.tenantId,
    guestId: session.guestId,
    label: body.label,
    line: body.line,
    notes: body.notes,
    isDefault: body.isDefault,
  }));
});

export const OPTIONS = corsPreflight;
