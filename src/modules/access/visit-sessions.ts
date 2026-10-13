import { and, eq, isNull } from 'drizzle-orm';
import { withTenant, recordEvent, resolveVisitLink, type Tx } from '@/db';
import { guestSessions } from '@/db/schema/access';
import {
  openVisit, fulfilmentForLinkKind,
  type VisitFulfilment, type VisitLinkKind,
} from '@/modules/visit';
import { issueToken } from '@/lib/tokens';
import type { AccessTier } from './tiers';
import { QrNotUsableError, type VisitGuestSession } from './guest-sessions';

/**
 * Opening a property link. D-079, and the visit-side twin of `scanQrCode()`.
 *
 * Everything #9 says about a room sticker is true here and matters more: this
 * is a link in a bio, a tent on a table, a code beside a till. Somebody opens
 * it, sees a menu, and orders. There is no login, no signup, and no screen in
 * the way of the menu — and unlike the room flow there is not even a prompt
 * waiting further in, for the reason set out below.
 */

/**
 * ─── Why a visit session opens at CHARGE, and why that is not a hole ───────
 *
 * Read D-012 before changing this. Its prompt exists to defend ONE thing: a
 * scan alone posting ₹4,000 to room 214, which the hotel then eats because a
 * sticker is photographable from a corridor. The tier ladder is built around
 * that single fraud, and `placeOrder()` asserting CHARGE is what makes it real
 * rather than customary.
 *
 * A visit has no room. There is no folio, nothing is posted anywhere, and the
 * money moves at the counter or at the door — so the thing CHARGE defends does
 * not exist on this path. Opening below CHARGE would not make anybody safer; it
 * would put a phone-digits prompt in front of a stranger who has no stay to
 * have digits for, which is exactly the dead end `/demo` was built to avoid
 * (modules/demo) and the design D-012 removed.
 *
 * What DOES gate a visit order is `setVisitDetails()`: a name and a phone, once,
 * at checkout, because a kitchen that cannot ring when the food is ready has to
 * shout across a counter. That is an operational requirement enforced in the
 * domain, not an access control, and it is recorded as `visit.identified`
 * rather than as an escalation — the audit trail should not claim somebody
 * proved who they are when nobody asked them to.
 *
 * FULL is deliberately NOT granted. FULL opens the folio, the stay and
 * checkout; a visit has none of those, and a session that can ask for them is a
 * session that can ask for somebody else's.
 */
export const VISIT_SESSION_TIER: AccessTier = 'CHARGE';

export interface VisitScanResult {
  session: VisitGuestSession;
  /** What the link is — TABLE, COUNTER or ONLINE. The mobile app reports it;
   *  nothing decides anything on it (see `Visit.linkKind`). */
  linkKind: VisitLinkKind;
  cookieValue: string;
  /** Where to send the browser. The menu, not a home screen — a restaurant
   *  link has one thing to do and burying it behind a landing page is how a
   *  food order becomes a second tap. */
  next: string;
}

/**
 * Resolve a public link code, open a visit, and issue the session.
 *
 * Deliberately mints a NEW visit on every call. The route handler reuses a live
 * session before reaching here (exactly as `/r/{code}` does), so this runs once
 * per customer per window; a second person scanning the same table tent must
 * get their own visit, or two tables' worth of food arrives on one ticket.
 */
export async function scanVisitLink(
  publicCode: string,
  meta: { ipAddress?: string; userAgent?: string; version?: number } = {},
): Promise<VisitScanResult> {
  const routing = await resolveVisitLink(publicCode);
  // Same single error as the room path, for the same reason: somebody probing
  // codes learns nothing from which of these it was.
  if (!routing) throw new QrNotUsableError('unknown link');
  if (routing.revokedAt) throw new QrNotUsableError('revoked');
  if (meta.version !== undefined && meta.version !== routing.version) {
    throw new QrNotUsableError('version mismatch');
  }

  return withTenant({ tenantId: routing.tenantId, propertyId: routing.propertyId }, async (tx) => {
    const fulfilment: VisitFulfilment = fulfilmentForLinkKind(routing.kind);

    const visit = await openVisit(tx, {
      tenantId: routing.tenantId,
      propertyId: routing.propertyId,
      outletId: routing.outletId,
      visitLinkId: routing.visitLinkId,
      linkKind: routing.kind,
      fulfilment,
      tableLabel: routing.tableLabel,
    });

    const { token, tokenHash } = issueToken();

    const [session] = await tx.insert(guestSessions).values({
      tenantId: routing.tenantId,
      propertyId: routing.propertyId,
      // The CHECK in 0008 is what makes this safe to write as an either/or:
      // `stay_id` stays null and the database refuses a row with both or
      // neither, so there is no state where "which context is this" has two
      // answers.
      visitId: visit.id,
      tokenHash,
      // Stays TRUE. Nobody has proved anything — a customer on a pavement is
      // as anonymous as this product ever serves, and the tier above is about
      // what there is to defend, not about who they are.
      isAnonymous: true,
      accessTier: VISIT_SESSION_TIER,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt: visit.expiresAt,
    }).returning({ id: guestSessions.id });

    await recordEvent(tx, {
      tenantId: routing.tenantId,
      propertyId: routing.propertyId,
      entityType: 'guest_session',
      entityId: session!.id,
      eventType: 'guest_session.visit_opened',
      toStatus: VISIT_SESSION_TIER,
      actor: { kind: 'GUEST', guestSessionId: session!.id },
      payload: {
        visitId: visit.id,
        visitLinkId: routing.visitLinkId,
        linkKind: routing.kind,
        fulfilment,
        anonymous: true,
      },
    });

    return {
      session: {
        kind: 'VISIT',
        id: session!.id,
        tenantId: routing.tenantId,
        propertyId: routing.propertyId,
        visitId: visit.id,
        outletId: routing.outletId,
        fulfilment,
        tableLabel: visit.tableLabel,
        customerName: null,
        customerPhone: null,
        deliveryAddress: null,
        accessTier: VISIT_SESSION_TIER,
        isAnonymous: true,
        expiresAt: visit.expiresAt,
      },
      linkKind: routing.kind,
      cookieValue: `${routing.tenantId}.${token}`,
      next: `/p/${encodeURIComponent(publicCode)}/menu`,
    };
  });
}

/** Closing a visit revokes its sessions — the same rule as checkout (#10). */
export async function revokeSessionsForVisit(tx: Tx, visitId: string): Promise<number> {
  const revoked = await tx.update(guestSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(guestSessions.visitId, visitId), isNull(guestSessions.revokedAt)))
    .returning({ id: guestSessions.id });
  return revoked.length;
}
