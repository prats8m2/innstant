import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { withTenant, recordEvent, resolveQrRouting, type Tx } from '@/db';
import { guestSessions, accessPolicies } from '@/db/schema/access';
import { NotFoundError } from '@/lib/errors';
import { issueToken, hashToken } from '@/lib/tokens';
import type { AccessTier } from './tiers';
import { firstNameOf } from './guest-name';

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

/**
 * Everything both kinds of session carry. D-079.
 *
 * Tenant, property, tier, expiry — the things every caller needs and neither
 * kind can be without. What differs is what the session is BOUND to, and that
 * is the discriminated half below.
 */
export interface GuestSessionBase {
  id: string;
  tenantId: string;
  propertyId: string;
  accessTier: AccessTier;
  isAnonymous: boolean;
  expiresAt: Date;
}

/**
 * A guest on a stay — the session a room sticker mints. Unchanged from P1 in
 * every respect except the `kind` tag.
 */
export interface StayGuestSession extends GuestSessionBase {
  kind: 'STAY';
  stayId: string;
  roomId: string;
  roomNumber: string;
  /** When the guest is due out, property-local when rendered. The room home and
   *  the checkout flow both need it, and it is already on the joined stay —
   *  fetching it here saves every screen a second query. */
  scheduledCheckoutAt: Date;
  /**
   * What to call them — the FIRST name only, and null when the stay has no
   * usable one.
   *
   * The session stays anonymous in every sense that matters (#9): this is read
   * from the stay the sticker is bound to, it grants nothing, and it changes no
   * tier. It exists because a hotel greeting somebody by name is the difference
   * between a screen and a welcome, and the export asks for it.
   *
   * First name only, deliberately. "Good evening, Anjali" is a greeting;
   * "Good evening, Anjali Menon" is a boarding pass.
   */
  guestFirstName: string | null;
}

/**
 * Somebody who opened a property link — a table, a counter, a delivery. No
 * stay, no room, and nothing to charge to one.
 *
 * ─── Why this is a discriminated union and not two nullable fields ─────────
 *
 * `stayId: string | null` would compile at every one of the ~20 call sites that
 * read it today and fail at exactly one of them, at runtime, on a screen a
 * guest is looking at. The union makes each of those a compile error that has
 * to be answered, and `resolveStaySession()` / `resolveVisitSession()` below
 * mean the answer is one line per screen rather than a guard in every function.
 */
export interface VisitGuestSession extends GuestSessionBase {
  kind: 'VISIT';
  visitId: string;
  outletId: string;
  fulfilment: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  tableLabel: string | null;
  /** What they typed at checkout, once they have. Null until then — #9 applies
   *  on a pavement exactly as it does in a corridor. */
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
}

export type GuestSession = StayGuestSession | VisitGuestSession;

export interface ScanResult {
  session: StayGuestSession;
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
      guest_name: string | null;
    }>(sql`
      SELECT s.id AS stay_id, r.number AS room_number, s.scheduled_checkout_at,
             p.name AS property_name, p.timezone, p.currency,
             g.full_name AS guest_name
      FROM stays s
      JOIN rooms r      ON r.id = s.room_id
      JOIN properties p ON p.id = s.property_id
      JOIN guests g     ON g.id = s.guest_id
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

    /**
     * A stay that is past its checkout plus the grace window is over, whatever
     * `stays.status` still says.
     *
     * Without this the scan SUCCEEDS and mints a session whose cookie is
     * already expired. The browser discards it on arrival, `/home` finds no
     * session and redirects back to `/r/{code}`, which scans again — an
     * infinite redirect loop behind a blank white screen, on the one screen a
     * guest reaches by pointing their phone at a sticker.
     *
     * It is the same refusal as "no active stay" above, and deliberately the
     * same error: a scanner in a corridor learns nothing from which of the two
     * it was. It is reached whenever a checkout has not been processed — a
     * front desk that went home without closing the day, a PMS import that
     * stalled — which is a normal Tuesday, not an edge case.
     */
    if (expiresAt <= new Date()) throw new QrNotUsableError('stay is past checkout');

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
        kind: 'STAY',
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
        guestFirstName: firstNameOf(row.guest_name),
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

/**
 * The cookie, resolved to whichever kind of session it is. D-079.
 *
 * Null for anything unusable — expired, revoked, a stay that has checked out,
 * or a visit that has closed. A stale session resolving to nothing is the #10
 * guarantee, and it holds for both kinds.
 *
 * ─── One query, two LEFT JOINs ─────────────────────────────────────────────
 *
 * The obvious shape is to try the stay query, and on a miss try the visit
 * query. It is also two round-trips on every single render of every guest
 * screen, for a branch the row itself already answers: `guest_sessions` carries
 * exactly one of the two ids (the CHECK in 0008 guarantees it), so LEFT JOINing
 * both resolves in one pass and the non-null id says which arm to build.
 *
 * `JOIN` became `LEFT JOIN` on the stay side, and that is the load-bearing
 * change: an inner join against `stays` silently returns nothing for every
 * visit session, which would have read as "cookie expired" on a screen with a
 * perfectly good cookie.
 */
export async function resolveGuestSession(cookieValue: string | undefined): Promise<GuestSession | null> {
  if (!cookieValue) return null;
  const parsed = parseCookie(cookieValue);
  if (!parsed) return null;

  return withTenant({ tenantId: parsed.tenantId }, async (tx) => {
    const rows = await tx.execute<{
      id: string; property_id: string; access_tier: AccessTier;
      is_anonymous: boolean; expires_at: Date;
      stay_id: string | null; room_id: string | null; room_number: string | null;
      stay_status: string | null; scheduled_checkout_at: Date | null;
      guest_name: string | null;
      visit_id: string | null; outlet_id: string | null;
      visit_status: string | null; fulfilment: VisitGuestSession['fulfilment'] | null;
      table_label: string | null; customer_name: string | null;
      customer_phone: string | null; delivery_address: string | null;
      visit_expires_at: Date | null;
    }>(sql`
      SELECT gs.id, gs.property_id, gs.access_tier, gs.is_anonymous, gs.expires_at,
             gs.stay_id, s.room_id, r.number AS room_number,
             s.status AS stay_status, s.scheduled_checkout_at,
             g.full_name AS guest_name,
             gs.visit_id, v.outlet_id, v.status AS visit_status, v.fulfilment,
             v.table_label, v.customer_name, v.customer_phone,
             v.delivery_address, v.expires_at AS visit_expires_at
      FROM guest_sessions gs
      LEFT JOIN stays s  ON s.id = gs.stay_id
      LEFT JOIN rooms r  ON r.id = s.room_id
      LEFT JOIN guests g ON g.id = s.guest_id
      LEFT JOIN visits v ON v.id = gs.visit_id
      WHERE gs.token_hash = ${parsed.tokenHash}
        AND gs.revoked_at IS NULL
        AND gs.expires_at > now()
      LIMIT 1
    `);

    const row = rows.rows[0];
    if (!row) return null;

    if (row.visit_id) {
      // Belt and braces, exactly as below: a closed visit must not resolve even
      // if whatever closed it missed the session revoke.
      if (row.visit_status !== 'OPEN') return null;
      return {
        kind: 'VISIT',
        id: row.id,
        tenantId: parsed.tenantId,
        propertyId: row.property_id,
        visitId: row.visit_id,
        outletId: row.outlet_id!,
        fulfilment: row.fulfilment!,
        tableLabel: row.table_label,
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        deliveryAddress: row.delivery_address,
        accessTier: row.access_tier,
        isAnonymous: row.is_anonymous,
        expiresAt: new Date(row.expires_at),
      };
    }

    if (!row.stay_id) return null;
    // Checkout revokes sessions, but belt and braces: a stay that is no longer
    // CHECKED_IN must not resolve even if a revoke was missed.
    if (row.stay_status !== 'CHECKED_IN') return null;

    return {
      kind: 'STAY',
      id: row.id,
      tenantId: parsed.tenantId,
      propertyId: row.property_id,
      stayId: row.stay_id,
      roomId: row.room_id!,
      roomNumber: row.room_number!,
      accessTier: row.access_tier,
      isAnonymous: row.is_anonymous,
      expiresAt: new Date(row.expires_at),
      scheduledCheckoutAt: new Date(row.scheduled_checkout_at!),
      guestFirstName: firstNameOf(row.guest_name),
    };
  });
}

/**
 * The same cookie, narrowed to one kind — and the reason every `/r/*` screen
 * changed by one line rather than by a guard in every function.
 *
 * A screen under `/r/{code}` is a ROOM screen: it reads a room number, a
 * checkout date and a folio, none of which a visit has. A screen under
 * `/p/{code}` is the mirror image. Asking for the kind you can render, and
 * treating the other as no session at all, is both the correct behaviour — the
 * redirect sends them back through their own link — and the thing that makes
 * the union free at the call site.
 */
export async function resolveStaySession(
  cookieValue: string | undefined,
): Promise<StayGuestSession | null> {
  const session = await resolveGuestSession(cookieValue);
  return session?.kind === 'STAY' ? session : null;
}

export async function resolveVisitSession(
  cookieValue: string | undefined,
): Promise<VisitGuestSession | null> {
  const session = await resolveGuestSession(cookieValue);
  return session?.kind === 'VISIT' ? session : null;
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

/**
 * The stay's checkout moved, so the sessions on it have to move with it.
 *
 * A session expires at `scheduled_checkout_at + grace` (see `scanQrCode`), which
 * is set once when the session is minted. Approve a 6pm late checkout at 10am
 * and every phone in the room would still stop working at 1pm — the guest would
 * have paid for the room and lost the app that orders lunch to it.
 *
 * The grace is re-read from the property's policy rather than passed in, so
 * there is one place that knows how the expiry is computed and it is the same
 * place that computed it the first time.
 *
 * Only live sessions: a revoked one stays revoked, and an already-expired one
 * is not resurrected by a later checkout. A guest whose session lapsed rescans,
 * which is one tap and mints a session with the new expiry anyway.
 */
export async function refreshSessionExpiryForStay(
  tx: Tx,
  input: { propertyId: string; stayId: string; scheduledCheckoutAt: Date },
): Promise<number> {
  const policy = await tx.select({ graceMinutes: accessPolicies.sessionGraceMinutes })
    .from(accessPolicies)
    .where(eq(accessPolicies.propertyId, input.propertyId))
    .limit(1);

  const graceMinutes = policy[0]?.graceMinutes ?? 120;
  const expiresAt = new Date(input.scheduledCheckoutAt.getTime() + graceMinutes * 60_000);

  const updated = await tx.update(guestSessions)
    .set({ expiresAt })
    .where(and(
      eq(guestSessions.stayId, input.stayId),
      isNull(guestSessions.revokedAt),
      gt(guestSessions.expiresAt, new Date()),
    ))
    .returning({ id: guestSessions.id });

  return updated.length;
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
