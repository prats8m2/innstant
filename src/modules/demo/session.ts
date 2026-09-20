import { withTenant, recordEvent } from '@/db';
import { scanQrCode, raiseSessionTier, type GuestSession } from '@/modules/access';

/**
 * Opening the demo room for somebody who came from the website.
 *
 * ─── Why this raises the tier, and why that is not a hole in D-012 ─────────
 *
 * A visitor on the marketing site has no phone number in the hotel's PMS,
 * because there is no hotel and there is no stay — The Kesari is seeded
 * fixtures. Sending them to the phone-digits prompt at the first attempt to
 * order asks a question with no answer, and the demo dead-ends on the one
 * screen it exists to show off.
 *
 * So the session is opened at FULL, and the prompt never fires — not because
 * the check was weakened, but because this session is vouched for on the way
 * in. That is D-012's own second mechanism: "reached by a STAFF VOUCH — the
 * desk saying yes, that is the guest in 214". Here the vouch is the demo
 * itself, and it is recorded as one.
 *
 * What makes it safe is where it can be reached from:
 *
 *   1. ONLY /demo/enter calls this. The sticker path — `/r/{code}` — is
 *      untouched and still mints at the property's `base_tier`.
 *   2. The room is `resolveDemoRoomCode()`'s, resolved from DEMO_TENANT_ID.
 *      A visitor cannot name the room; there is no parameter to point at a
 *      real hotel.
 *   3. It writes `guest_session.demo_opened` to `event_log` (#7) with the tier
 *      it granted, so a demo session is distinguishable from a real one
 *      forever after, in the audit trail rather than in a cookie.
 *
 * If this product ever runs a demo against a tenant with real guests in it,
 * (2) is the line that has to hold, and it holds in configuration rather than
 * in a request.
 */
export interface DemoSession {
  session: GuestSession;
  cookieValue: string;
  /** Where to send the browser next. */
  home: string;
}

export async function openDemoSession(
  publicCode: string,
  meta: { ipAddress?: string; userAgent?: string } = {},
): Promise<DemoSession> {
  const scan = await scanQrCode(publicCode, meta);

  await withTenant(
    { tenantId: scan.session.tenantId, propertyId: scan.session.propertyId },
    async (tx) => {
      // `isAnonymous` stays TRUE. Nobody proved who they are — a demo visitor
      // is the most anonymous person this product ever serves, and flipping the
      // flag would tell the desk a stranger had verified themselves.
      await raiseSessionTier(tx, scan.session.id, 'FULL', { isAnonymous: true });

      await recordEvent(tx, {
        tenantId: scan.session.tenantId,
        propertyId: scan.session.propertyId,
        entityType: 'guest_session',
        entityId: scan.session.id,
        eventType: 'guest_session.demo_opened',
        fromStatus: scan.session.accessTier,
        toStatus: 'FULL',
        actor: { kind: 'GUEST', guestSessionId: scan.session.id },
        payload: { source: 'website', method: 'DEMO_VOUCH' },
      });
    },
  );

  return {
    session: { ...scan.session, accessTier: 'FULL' },
    cookieValue: scan.cookieValue,
    home: `/r/${encodeURIComponent(publicCode)}/home`,
  };
}
