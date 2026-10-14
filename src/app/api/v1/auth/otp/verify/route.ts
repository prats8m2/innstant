import { z } from 'zod';
import { withTenant } from '@/db';
import { verifyCode, getProfile, listAddresses } from '@/modules/customer';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler, parseBody, corsPreflight } from '../../../_lib/handler';
import type { ApiSignedIn, ApiVerifyOtpBody } from '@/lib/api-contract';

/**
 * `POST /api/v1/auth/otp/verify` — check the code, sign in. D-081.
 *
 * Returns the customer and their addresses alongside the token, because the
 * screen that called this is about to need all three and a sign-in that cost
 * three round trips on restaurant wifi is a sign-in people abandon.
 *
 * `verifyCode()` owns its own transaction deliberately — the attempt counter
 * is a write, and throwing a refusal from inside the transaction that recorded
 * it rolls the record back. See the note on `VerifyOutcome`.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  phone: z.string().trim().min(1).max(32),
  code: z.string().trim().regex(/^\d{4,8}$/),
  name: z.string().trim().min(1).max(80).optional(),
});

export const POST = apiHandler('/api/v1/auth/otp/verify', async (request): Promise<ApiSignedIn> => {
  const session = await requireVisitSession(request);
  const body: ApiVerifyOtpBody = await parseBody(
    request,
    Body,
    'That code is not right. Check it and try again.',
  );

  const verified = await verifyCode({
    tenantId: session.tenantId,
    phone: body.phone,
    code: body.code,
    name: body.name ?? null,
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
  });

  return withTenant({ tenantId: session.tenantId }, async (tx) => {
    const profile = await getProfile(tx, verified.guestId);
    return {
      token: verified.token,
      customer: {
        name: profile!.name,
        phone: profile!.phone,
        email: profile!.email,
        phoneVerified: profile!.phoneVerified,
      },
      addresses: await listAddresses(tx, verified.guestId),
    };
  });
});

export const OPTIONS = corsPreflight;
