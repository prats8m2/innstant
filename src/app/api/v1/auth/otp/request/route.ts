import { z } from 'zod';
import { requestCode } from '@/modules/customer';
import { requireVisitSession } from '@/lib/api-auth';
import { apiHandler, parseBody, corsPreflight } from '../../../_lib/handler';
import type { ApiRequestOtpBody, ApiRequestOtpResult } from '@/lib/api-contract';

/**
 * `POST /api/v1/auth/otp/request` — send a code. D-081.
 *
 * ─── Why this needs a CONTEXT session ──────────────────────────────────────
 *
 * Not as a permission — as the only way to know which tenant is asking. OTP
 * challenges are tenant-scoped and this request arrives with no account yet,
 * so without the context token there would be nothing to derive a tenant from
 * and the endpoint would need its own pre-tenant SECURITY DEFINER lookup, like
 * `resolve_qr_routing`. The app always has a context: it boots into its
 * default link before anything else happens.
 *
 * ─── One answer for every dialable number ──────────────────────────────────
 *
 * It does not say whether a message was sent. A throttled number, a number
 * that has never ordered here, and a regular all get `{ sent: true }`. The
 * alternative is an endpoint that tells anybody who asks whether a given
 * person is a customer of this hotel group — unauthenticated, at whatever rate
 * it allows.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ phone: z.string().trim().min(1).max(32) });

export const POST = apiHandler('/api/v1/auth/otp/request', async (request): Promise<ApiRequestOtpResult> => {
  const session = await requireVisitSession(request);
  const body: ApiRequestOtpBody = await parseBody(
    request,
    Body,
    'We need a phone number to send a code to.',
  );

  await requestCode({
    tenantId: session.tenantId,
    phone: body.phone,
    // The per-IP throttle's input. Behind Railway's proxy the socket address
    // is the proxy, so the forwarded header is the only real one — the same
    // reason `scanVisitLink` reads it.
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request.headers.get('user-agent'),
  });

  return { sent: true, expiresInMinutes: 10 };
});

export const OPTIONS = corsPreflight;
