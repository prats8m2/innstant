import { withTenant } from '@/db';
import { getProfile, listAddresses } from '@/modules/customer';
import { requireCustomerSession } from '@/lib/api-auth';
import { NotFoundError } from '@/lib/errors';
import { apiHandler, corsPreflight } from '../../_lib/handler';
import type { ApiMe } from '@/lib/api-contract';

/**
 * `GET /api/v1/auth/me` — is the stored customer token still good? D-081.
 *
 * ─── The one endpoint that needs NO context ────────────────────────────────
 *
 * Every other route on `/api/v1` requires a visit, because every other route
 * is about ordering and ordering happens somewhere. This one is about the
 * account, which exists independently of anywhere — and that is precisely the
 * state that proved identity could not live inside `guest_sessions`: somebody
 * opening the app signed in, having scanned nothing, should still see who they
 * are and what they have ordered.
 *
 * A 401 means the token lapsed, was revoked, or the account is gone. The app
 * answers all three the same way: drop it and carry on signed out, which must
 * keep working (#9).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = apiHandler('/api/v1/auth/me', async (request): Promise<ApiMe> => {
  const session = await requireCustomerSession(request);

  return withTenant({ tenantId: session.tenantId }, async (tx) => {
    const profile = await getProfile(tx, session.guestId);
    if (!profile) throw new NotFoundError('That account is no longer available.');

    return {
      customer: {
        name: profile.name,
        phone: profile.phone,
        email: profile.email,
        phoneVerified: profile.phoneVerified,
      },
      addresses: await listAddresses(tx, session.guestId),
    };
  });
});

export const OPTIONS = corsPreflight;
