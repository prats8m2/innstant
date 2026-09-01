import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { withTenant, recordEvent, resolveQrRouting, type Tx } from '@/db';
import { guestSessions, accessPolicies } from '@/db/schema/access';
import { NotFoundError } from '@/lib/errors';
import { issueToken, hashToken } from '@/lib/tokens';
import type { AccessTier } from './tiers';

/**
 * Guest sessions. CLAUDE.md #9 and #10, D-012.
 *
 * The single most important property of this file: **a bare scan issues a
 * working session with no verification screen.** If you find yourself adding a
 * prompt here, you are rebuilding the design D-012 removed.
 *
 * Sessions bind to `stay_id`, NEVER `room_id` (#10). Rooms are reused; a
 * session keyed on a room would show the guest who checks into 402 on Tuesday
 * the previous occupant's orders, dietary notes and folio.
 */

export const GUEST_SESSION_COOKIE = 'hgs_guest';

export interface GuestSession {
  id: string;
  tenantId: string;
  propertyId: string;
  stayId: string;
  roomId: string;
  roomNumber: string;
  accessTier: AccessTier;
  isAnonymous: boolean;
  expiresAt: Date;
  /** When the guest is due out, property-local when rendered. The room home and
   *  the checkout flow both need it, and it is already on the joined stay —
   *  fetching it here saves every screen a second query. */
  scheduledCheckoutAt: Date;
}

export interface ScanResult {
  session: GuestSession;
  /** `<tenantId>.<token>` — same reasoning as the staff cookie: the tenant id
   *  is routing information, not a credential, and RLS confines the lookup. */
  cookieValue: string;
  property: { id: string; name: string; timezone: string; currency: string };
  room: { id: string; number: string };
}

/** Raised when a code resolves to nothing a guest may use: unknown, revoked,
 *  wrong version, or a room with no one currently checked in. Deliberately one
 *  error — a scanner in a corridor learns nothing from which. */
export class QrNotUsableError extends NotFoundError {
  constructor(readonly detail: string) {
    super(`qr not usable: ${detail}`);
  }
}

/**
 * Resolve a public code and issue a session. The whole of #9 lives here.
 *
 * Note the ORDER: the session is created before anything asks who the guest
 * is, and `isAnonymous` stays true. Escalation happens later, on the first
 * action that needs it, and raises the tier on THIS row rather than issuing a
 * second session.
 */
export async function scanQrCode(
  publicCode: string,
  meta: { ipAddress?: string; userAgent?: string; version?: number } = {},
): Promise<ScanResult> {
  const routing = await resolveQrRouting(publicCode);
  if (!routing) throw new QrNotUsableError('unknown code');
  if (routing.revokedAt) throw new QrNotUsableError('revoked');
  if (meta.version !== undefined && meta.version !== routing.version) {
    throw new QrNotUsableError('version mismatch');
  }

  return withTenant({ tenantId: routing.tenantId, propertyId: routing.propertyId }, async (tx) => {
    // Raw SQL for the join across identity + stay tables: those are other
    // modules' tables and this module may not import them (D-001). A read-only
    // projection inside the tenant-scoped transaction is the narrow exception,
    // and RLS still applies to every row it touches. Parameterised via the
    // drizzle `sql` template — never interpolated, even for values that come
    // from our own database.
    const found = await tx.execute<{
      stay_id: string; room_number: string; scheduled_checkout_at: Date;
      property_name: string; timezone: string; currency: string;
    }>(sql`
      SELECT s.id AS stay_id, r.number AS room_number, s.scheduled_checkout_at,
             p.name AS property_name, p.timezone, p.currency
      FROM stays s
      JOIN rooms r      ON r.id = s.room_id
      JOIN properties p ON p.id = s.property_id
      WHERE s.room_id = ${routing.roomId}
        AND s.status = 'CHECKED_IN'
      LIMIT 1
    `);

    const row = found.rows[0];
    // No active stay: the room is empty, or between guests. Same error as an
    // unknown code — a scanner in the corridor should not learn occupancy.
    if (!row) throw new QrNotUsableError('no active stay');

    const policy = await tx.select({
      baseTier: accessPolicies.baseTier,
      graceMinutes: accessPolicies.sessionGraceMinutes,
    }).from(accessPolicies)
      .where(eq(accessPolicies.propertyId, routing.propertyId))
      .limit(1);

    const baseTier = (policy[0]?.baseTier ?? 'REQUEST') as AccessTier;
    const graceMinutes = policy[0]?.graceMinutes ?? 120;

    const { token, tokenHash } = issueToken();
    const expiresAt = new Date(
      new Date(row.scheduled_checkout_at).getTime() + graceMinutes * 60_000,
    );

    const [session] = await tx.insert(guestSessions).values({
      tenantId: routing.tenantId,
      propertyId: routing.propertyId,
      stayId: row.stay_id,
      tokenHash,
      isAnonymous: true,          // #9 — this is the point
      accessTier: baseTier,
      scannedQrCodeId: routing.qrCodeId,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt,
    }).returning({ id: guestSessions.id });

    await recordEvent(tx, {
      tenantId: routing.tenantId,
      propertyId: routing.propertyId,
      entityType: 'guest_session',
      entityId: session!.id,
      eventType: 'guest_session.issued',
      toStatus: baseTier,
      actor: { kind: 'GUEST', guestSessionId: session!.id },
      payload: { qrCodeId: routing.qrCodeId, anonymous: true },
    });

    return {
      session: {
        id: session!.id,
        tenantId: routing.tenantId,
        propertyId: routing.propertyId,
        stayId: row.stay_id,
        roomId: routing.roomId,
        roomNumber: row.room_number,
        accessTier: baseTier,
        isAnonymous: true,
        expiresAt,
        scheduledCheckoutAt: new Date(row.scheduled_checkout_at),
      },
      cookieValue: `${routing.tenantId}.${token}`,
      property: {
        id: routing.propertyId,
        name: row.property_name,
        timezone: row.timezone,
        currency: row.currency,
      },
      room: { id: routing.roomId, number: row.room_number },
    };
  });
}

function parseCookie(value: string): { tenantId: string; tokenHash: string } | null {
  const at = value.indexOf('.');
  if (at <= 0) return null;
  const tenantId = value.slice(0, at);
  const token = value.slice(at + 1);
  if (!token) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) return null;
  return { tenantId, tokenHash: hashToken(token) };
}

/** Null for anything unusable — expired, revoked, or a stay that has checked
 *  out. A stale session resolving to nothing is the #10 guarantee. */
export async function resolveGuestSession(cookieValue: string | undefined): Promise<GuestSession | null> {
  if (!cookieValue) return null;
  const parsed = parseCookie(cookieValue);
  if (!parsed) return null;

  return withTenant({ tenantId: parsed.tenantId }, async (tx) => {
    const rows = await tx.execute<{
      id: string; property_id: string; stay_id: string; room_id: string;
      room_number: string; access_tier: AccessTier; is_anonymous: boolean;
      expires_at: Date; stay_status: string; scheduled_checkout_at: Date;
    }>(sql`
      SELECT gs.id, gs.property_id, gs.stay_id, s.room_id, r.number AS room_number,
             gs.access_tier, gs.is_anonymous, gs.expires_at, s.status AS stay_status,
             s.scheduled_checkout_at
      FROM guest_sessions gs
      JOIN stays s ON s.id = gs.stay_id
      JOIN rooms r ON r.id = s.room_id
      WHERE gs.token_hash = ${parsed.tokenHash}
        AND gs.revoked_at IS NULL
        AND gs.expires_at > now()
      LIMIT 1
    `);

    const row = rows.rows[0];
    if (!row) return null;
    // Checkout revokes sessions, but belt and braces: a stay that is no longer
    // CHECKED_IN must not resolve even if a revoke was missed.
    if (row.stay_status !== 'CHECKED_IN') return null;

    return {
      id: row.id,
      tenantId: parsed.tenantId,
      propertyId: row.property_id,
      stayId: row.stay_id,
      roomId: row.room_id,
      roomNumber: row.room_number,
      accessTier: row.access_tier,
      isAnonymous: row.is_anonymous,
      expiresAt: new Date(row.expires_at),
      scheduledCheckoutAt: new Date(row.scheduled_checkout_at),
    };
  });
}

/** Raise the tier on the EXISTING session (D-012), never issue a second one. */
export async function raiseSessionTier(
  tx: Tx,
  sessionId: string,
  toTier: AccessTier,
  opts: { isAnonymous?: boolean } = {},
): Promise<void> {
  await tx.update(guestSessions)
    .set({ accessTier: toTier, isAnonymous: opts.isAnonymous ?? false })
    .where(eq(guestSessions.id, sessionId));
}

/** #10 — checkout revokes every session for that stay. */
export async function revokeSessionsForStay(tx: Tx, stayId: string): Promise<number> {
  const revoked = await tx.update(guestSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(guestSessions.stayId, stayId), isNull(guestSessions.revokedAt)))
    .returning({ id: guestSessions.id });
  return revoked.length;
}

export async function activeSessionCountForStay(tx: Tx, stayId: string): Promise<number> {
  const rows = await tx.select({ id: guestSessions.id }).from(guestSessions)
    .where(and(
      eq(guestSessions.stayId, stayId),
      isNull(guestSessions.revokedAt),
      gt(guestSessions.expiresAt, new Date()),
    ));
  return rows.length;
}
