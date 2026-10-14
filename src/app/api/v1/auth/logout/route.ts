import { withTenant } from '@/db';
import { revokeCustomerSession } from '@/modules/customer';
import { requireCustomerSession } from '@/lib/api-auth';
import { apiHandler, corsPreflight } from '../../_lib/handler';

/**
 * `POST /api/v1/auth/logout` — this device only. D-081.
 *
 * The row IS the session, so revoking is immediate and total: the token stops
 * resolving on the next request rather than at its next expiry. That is the
 * property a stateless token would have thrown away, and the reason signing
 * out means something here.
 *
 * Other devices keep working. "Sign out everywhere" is a different button and
 * a different call (`revokeAllCustomerSessions`), because somebody tapping
 * sign-out on a borrowed phone should not be logged out at home.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = apiHandler('/api/v1/auth/logout', async (request): Promise<{ ok: true }> => {
  const session = await requireCustomerSession(request);
  await withTenant({ tenantId: session.tenantId }, (tx) => revokeCustomerSession(tx, session.id));
  return { ok: true };
});

export const OPTIONS = corsPreflight;
