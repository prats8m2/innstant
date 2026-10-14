import { z } from 'zod';
import { withTenant } from '@/db';
import { getProfile, updateProfile } from '@/modules/customer';
import { requireCustomerSession } from '@/lib/api-auth';
import { NotFoundError } from '@/lib/errors';
import { apiHandler, parseBody, corsPreflight } from '../_lib/handler';
import type { ApiCustomer, ApiUpdateProfileBody } from '@/lib/api-contract';

/**
 * `GET` and `PATCH /api/v1/profile`. D-081.
 *
 * ─── What a customer may NOT change ────────────────────────────────────────
 *
 * Their phone, and the name the front desk recorded.
 *
 * The phone is the account — changing it would be moving the account to
 * another identity, which has to go through an OTP on the new number and is
 * not a profile edit.
 *
 * `guests.full_name` is what a folio is made out to and what the desk reads on
 * /admin/guests/[guestId]. `updateProfile()` writes `display_name` instead, so
 * a recycled or mistyped number cannot rename a real guest's record — the same
 * refusal `upsertGuestByPhone()` already makes, extended to the one caller
 * that has proved a phone number and nothing else.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().max(160).nullable().optional(),
});

export const GET = apiHandler('/api/v1/profile', async (request): Promise<ApiCustomer> => {
  const session = await requireCustomerSession(request);
  const profile = await withTenant({ tenantId: session.tenantId }, (tx) =>
    getProfile(tx, session.guestId));
  if (!profile) throw new NotFoundError('That account is no longer available.');
  return {
    name: profile.name,
    phone: profile.phone,
    email: profile.email,
    phoneVerified: profile.phoneVerified,
  };
});

export const PATCH = apiHandler('/api/v1/profile', async (request): Promise<ApiCustomer> => {
  const session = await requireCustomerSession(request);
  const body: ApiUpdateProfileBody = await parseBody(
    request, Body, 'That change did not come through.',
  );

  const profile = await withTenant({ tenantId: session.tenantId }, (tx) =>
    updateProfile(tx, {
      tenantId: session.tenantId,
      guestId: session.guestId,
      name: body.name,
      email: body.email,
    }));

  return {
    name: profile.name,
    phone: profile.phone,
    email: profile.email,
    phoneVerified: profile.phoneVerified,
  };
});

export const OPTIONS = corsPreflight;
